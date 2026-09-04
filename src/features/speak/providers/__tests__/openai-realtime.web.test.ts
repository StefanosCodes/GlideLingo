import { afterEach, expect, jest, test } from '@jest/globals';

import type { VoiceSessionAdmission } from '../../model/voice-session';
import { connectOpenAIRealtime } from '../openai-realtime.web';

type Listener = (event: { data?: string }) => void;

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: { data?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeDataChannel extends FakeEventTarget {
  readyState: RTCDataChannelState = 'connecting';
  readonly close = jest.fn(() => {
    this.readyState = 'closed';
    this.emit('close');
  });
  readonly send = jest.fn();

  open() {
    this.readyState = 'open';
    this.emit('open');
  }

  failAfterOpen(type: 'close' | 'error') {
    if (type === 'close') this.readyState = 'closed';
    this.emit(type);
  }
}

class FakePeer extends FakeEventTarget {
  connectionState: RTCPeerConnectionState = 'new';
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  readonly close = jest.fn(() => {
    this.connectionState = 'closed';
  });
  readonly setRemoteDescription = jest.fn(async () => {
    this.connectionState = 'connected';
    this.channel.open();
  });

  constructor(readonly channel: FakeDataChannel) {
    super();
  }
}

const ADMISSION: VoiceSessionAdmission = {
  session_id: '00000000-0000-4000-8000-000000000001',
  lifecycle: 'connecting',
  expires_at: '2026-09-04T12:05:00Z',
  connection: { type: 'openai-webrtc-sdp', answer_sdp: 'v=0\r\na=fake-answer' },
  spec: {
    course_id: 'en-el-GR',
    course_version: '1.0.0',
    course_content_hash: `sha256:${'a'.repeat(64)}`,
    scenario_id: 'el-letters-1-voice-v1',
    scenario_version: '1.0.0',
    conversation_mode: 'guided',
    source_locale: 'en',
    target_locale: 'el-GR',
    persona_id: 'glide-coach-v1',
    voice_id: 'configured-voice',
    learner_level: 'beginner',
    capability_ids: ['el-script-vowels-a-e-i'],
    correction_policy_version: 'voice-correction-v1',
    evidence_policy_version: 'voice-practice-no-credit-v1',
    maximum_duration_seconds: 180,
  },
};

const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
});

function connectionFakes() {
  const channel = new FakeDataChannel();
  const peer = new FakePeer(channel);
  const track = { enabled: false, stop: jest.fn() };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  const audio = {
    autoplay: false,
    pause: jest.fn(),
    play: jest.fn(async () => undefined),
    setAttribute: jest.fn(),
    srcObject: null,
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: jest.fn(() => audio) },
  });
  return { audio, channel, peer, stream, track };
}

test.each(['close', 'error'] as const)(
  'post-open data-channel %s reports connection loss once and tears down safely',
  async (failure) => {
    const fake = connectionFakes();
    const onConnected = jest.fn();
    const onConnectionLost = jest.fn();
    const onEvent = jest.fn();
    const transport = await connectOpenAIRealtime({
      admission: ADMISSION,
      prepared: {
        dataChannel: fake.channel as unknown as RTCDataChannel,
        microphoneStream: fake.stream,
        offerSdp: 'v=0\r\na=fake-offer',
        peer: fake.peer as unknown as RTCPeerConnection,
      },
      onConnected,
      onConnectionLost,
      onEvent,
    });

    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(transport.interrupt()).toBe(true);
    expect(fake.channel.send.mock.calls.map(([value]) => JSON.parse(value as string).type)).toEqual([
      'response.cancel',
      'output_audio_buffer.clear',
    ]);
    transport.setMuted(false);
    expect(fake.track.enabled).toBe(true);

    fake.channel.emit('message', { data: JSON.stringify({ type: 'response.done' }) });
    expect(onEvent).toHaveBeenCalledWith({ type: 'response.done' });
    fake.channel.failAfterOpen(failure);
    fake.channel.failAfterOpen(failure);
    fake.peer.connectionState = 'failed';
    fake.peer.emit('connectionstatechange');
    expect(onConnectionLost).toHaveBeenCalledTimes(1);

    transport.close();
    transport.close();
    expect(fake.channel.close).toHaveBeenCalledTimes(1);
    expect(fake.peer.close).toHaveBeenCalledTimes(1);
    expect(fake.track.stop).toHaveBeenCalledTimes(1);
    expect(fake.audio.pause).toHaveBeenCalledTimes(1);
    expect(onConnectionLost).toHaveBeenCalledTimes(1);
  },
);

test('remote-description failure releases the channel, peer, and microphone', async () => {
  const fake = connectionFakes();
  fake.peer.setRemoteDescription.mockImplementationOnce(async () => {
    throw new Error('bad answer');
  });

  await expect(
    connectOpenAIRealtime({
      admission: ADMISSION,
      prepared: {
        dataChannel: fake.channel as unknown as RTCDataChannel,
        microphoneStream: fake.stream,
        offerSdp: 'v=0\r\na=fake-offer',
        peer: fake.peer as unknown as RTCPeerConnection,
      },
      onConnected: jest.fn(),
      onConnectionLost: jest.fn(),
      onEvent: jest.fn(),
    }),
  ).rejects.toThrow('bad answer');

  expect(fake.channel.close).toHaveBeenCalledTimes(1);
  expect(fake.peer.close).toHaveBeenCalledTimes(1);
  expect(fake.track.stop).toHaveBeenCalledTimes(1);
});
