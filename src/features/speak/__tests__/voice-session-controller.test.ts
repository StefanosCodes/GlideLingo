import { expect, jest, test } from '@jest/globals';

import { VoiceSessionController } from '../voice-session-controller';
import { VoiceSessionRequestError } from '../api/voice-sessions';
import type { ConnectRealtimeOptions } from '../providers/openai-realtime.types';
import type { VoiceSessionAdmission, VoiceSessionEvent } from '../model/voice-session';

const ADMISSION: VoiceSessionAdmission = {
  session_id: '00000000-0000-4000-8000-000000000001',
  lifecycle: 'connecting',
  expires_at: '2026-09-02T00:05:00Z',
  spec: {
    course_id: 'el-from-zero',
    course_version: 'greek-foundations-v1',
    course_content_hash: `sha256:${'a'.repeat(64)}`,
    scenario_id: 'el-greeting-introduction-v1',
    scenario_version: '1.0.0',
    conversation_mode: 'guided',
    source_locale: 'en',
    target_locale: 'el-GR',
    persona_id: 'greek-guide-v1',
    voice_id: 'configured-voice',
    learner_level: 'A0-A1',
    capability_ids: ['el-introduce-self'],
    correction_policy_version: 'gentle-recast-v1',
    evidence_policy_version: 'conversation-observation-v1',
    maximum_duration_seconds: 300,
  },
  connection: { type: 'openai-webrtc-sdp', answer_sdp: 'v=0\r\na=answer' },
};

const REQUEST = {
  course_id: 'el-from-zero',
  scenario_id: 'el-greeting-introduction-v1',
  conversation_mode: 'guided' as const,
  source_locale: 'en' as const,
  target_locale: 'el-GR' as const,
  captions_enabled: true,
  retain_transcript: false as const,
  client_capabilities: ['audio', 'captions', 'interrupt', 'reconnect'] as const,
};

function mediaFakes() {
  const stop = jest.fn();
  const stream = { getTracks: () => [{ stop }], getAudioTracks: () => [{ stop }] } as unknown as MediaStream;
  const closeChannel = jest.fn();
  const closePeer = jest.fn();
  const prepared = {
    dataChannel: { close: closeChannel } as unknown as RTCDataChannel,
    microphoneStream: stream,
    offerSdp: 'v=0\r\na=offer',
    peer: { close: closePeer } as unknown as RTCPeerConnection,
  };
  return { closeChannel, closePeer, prepared, stop, stream };
}

test('failed admission cancels prepared media and enters a safe terminal state', async () => {
  const media = mediaFakes();
  const controller = new VoiceSessionController(
    jest.fn(),
    true,
    {
      requestMicrophone: jest.fn(async () => media.stream),
      prepare: jest.fn(async () => media.prepared),
      create: jest.fn(async () => {
        throw new Error('admission failed');
      }),
      connect: jest.fn(),
      reconnect: jest.fn(),
      end: jest.fn(),
    } as never,
  );

  await expect(controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] })).rejects.toThrow(
    'admission failed',
  );
  expect(media.closeChannel).toHaveBeenCalledTimes(1);
  expect(media.closePeer).toHaveBeenCalledTimes(1);
  expect(media.stop).toHaveBeenCalledTimes(1);
  expect(controller.snapshot).toMatchObject({ lifecycle: 'failed', failureCode: 'start_failed' });
});

test('a total connection deadline bounds microphone acquisition and disposes a late stream', async () => {
  const media = mediaFakes();
  let releaseMicrophone: ((stream: MediaStream) => void) | undefined;
  const microphone = new Promise<MediaStream>((resolve) => {
    releaseMicrophone = resolve;
  });
  const controller = new VoiceSessionController(
    jest.fn(),
    true,
    {
      requestMicrophone: jest.fn(() => microphone),
      prepare: jest.fn(),
      create: jest.fn(),
      connect: jest.fn(),
      reconnect: jest.fn(),
      end: jest.fn(),
    } as never,
    5,
  );

  await expect(
    controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] }),
  ).rejects.toThrow('deadline elapsed');
  releaseMicrophone?.(media.stream);
  await Promise.resolve();

  expect(media.stop).toHaveBeenCalledTimes(1);
  expect(controller.snapshot).toMatchObject({ lifecycle: 'failed', failureCode: 'start_failed' });
});

test('end cancels an in-flight admission and releases prepared media', async () => {
  const media = mediaFakes();
  let admissionStarted: (() => void) | undefined;
  const enteredAdmission = new Promise<void>((resolve) => {
    admissionStarted = resolve;
  });
  const create = jest.fn(
    async (_request: unknown, _key: string, signal?: AbortSignal): Promise<VoiceSessionAdmission> => {
      admissionStarted?.();
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    },
  );
  const end = jest.fn();
  const controller = new VoiceSessionController(jest.fn(), true, {
    requestMicrophone: jest.fn(async () => media.stream),
    prepare: jest.fn(async () => media.prepared),
    create,
    connect: jest.fn(),
    reconnect: jest.fn(),
    end,
  } as never);

  const started = controller.start({
    ...REQUEST,
    client_capabilities: [...REQUEST.client_capabilities],
  });
  const rejected = expect(started).rejects.toThrow('cancelled');
  await enteredAdmission;
  await controller.end('cancelled');
  await rejected;

  expect(media.closeChannel).toHaveBeenCalledTimes(1);
  expect(media.closePeer).toHaveBeenCalledTimes(1);
  expect(media.stop).toHaveBeenCalledTimes(1);
  expect(end).not.toHaveBeenCalled();
  expect(controller.snapshot.lifecycle).toBe('ended');
});

test('a failed connection stops the admitted provider session', async () => {
  const media = mediaFakes();
  const end = jest.fn(async () => ({
    session_id: ADMISSION.session_id,
    lifecycle: 'ended' as const,
    end_reason: 'failed' as const,
    scenario_completed: false as const,
    transcript: [],
    evidence: { applied: false as const, reason: 'authored_scenario_evidence_not_integrated' },
  }));
  const controller = new VoiceSessionController(jest.fn(), true, {
    requestMicrophone: jest.fn(async () => media.stream),
    prepare: jest.fn(async () => media.prepared),
    create: jest.fn(async () => ADMISSION),
    connect: jest.fn(async () => {
      throw new Error('connection failed');
    }),
    reconnect: jest.fn(),
    end,
  } as never);

  await expect(
    controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] }),
  ).rejects.toThrow('connection failed');

  expect(end).toHaveBeenCalledWith(
    ADMISSION.session_id,
    { reason: 'failed', events: [] },
    expect.stringMatching(/^voice-cleanup:/),
  );
  expect(controller.snapshot).toMatchObject({ lifecycle: 'failed', failureCode: 'start_failed' });
});

test('an ambiguous admission failure retries once with the same key and SDP', async () => {
  const media = mediaFakes();
  let createAttempts = 0;
  const create = jest.fn(
    async (
      _request: unknown,
      _idempotencyKey: string,
      _signal?: AbortSignal,
    ): Promise<VoiceSessionAdmission> => {
      createAttempts += 1;
      if (createAttempts === 1) throw new VoiceSessionRequestError('network', true);
      return ADMISSION;
    },
  );
  const controller = new VoiceSessionController(jest.fn(), true, {
    requestMicrophone: jest.fn(async () => media.stream),
    prepare: jest.fn(async () => media.prepared),
    create,
    connect: jest.fn(async () => ({
      admission: ADMISSION,
      close: jest.fn(),
      interrupt: jest.fn(() => false),
      setMuted: jest.fn(),
    })),
    reconnect: jest.fn(),
    end: jest.fn(),
  } as never);

  await controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] });

  expect(create).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[0]?.[0]).toEqual(create.mock.calls[1]?.[0]);
  expect(create.mock.calls[0]?.[1]).toBe(create.mock.calls[1]?.[1]);
});

test('connection loss mutes immediately and reconnect failure closes both transports', async () => {
  const firstMedia = mediaFakes();
  const replacementMedia = mediaFakes();
  let connectionLost: (() => void) | undefined;
  const oldClose = jest.fn();
  const oldSetMuted = jest.fn();
  let microphoneRequests = 0;
  let preparations = 0;
  const controller = new VoiceSessionController(jest.fn(), true, {
    requestMicrophone: jest.fn(async () => {
      microphoneRequests += 1;
      return microphoneRequests === 1 ? firstMedia.stream : replacementMedia.stream;
    }),
    prepare: jest.fn(async () => {
      preparations += 1;
      return preparations === 1 ? firstMedia.prepared : replacementMedia.prepared;
    }),
    create: jest.fn(async () => ADMISSION),
    connect: jest.fn(async (options: ConnectRealtimeOptions) => {
      connectionLost = options.onConnectionLost;
      options.onConnected();
      return {
        admission: ADMISSION,
        close: oldClose,
        interrupt: jest.fn(() => false),
        setMuted: oldSetMuted,
      };
    }),
    reconnect: jest.fn(async () => {
      throw new Error('reconnect failed');
    }),
    end: jest.fn(),
  } as never);

  await controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] });
  controller.setMuted(false);
  connectionLost?.();
  expect(oldSetMuted).toHaveBeenLastCalledWith(true, false);
  expect(oldClose).toHaveBeenCalledTimes(1);
  expect(controller.snapshot).toMatchObject({ lifecycle: 'reconnecting', muted: true });

  await expect(controller.reconnect()).rejects.toThrow('reconnect failed');
  expect(oldClose).toHaveBeenCalledTimes(1);
  expect(replacementMedia.closeChannel).toHaveBeenCalledTimes(1);
  expect(replacementMedia.closePeer).toHaveBeenCalledTimes(1);
  expect(replacementMedia.stop).toHaveBeenCalledTimes(1);
});

test('connection loss closes the old transport immediately and ignores its later events', async () => {
  const media = mediaFakes();
  let connectionLost: (() => void) | undefined;
  let rawEvent: ((event: unknown) => void) | undefined;
  const close = jest.fn();
  const controller = new VoiceSessionController(jest.fn(), true, {
    requestMicrophone: jest.fn(async () => media.stream),
    prepare: jest.fn(async () => media.prepared),
    create: jest.fn(async () => ADMISSION),
    connect: jest.fn(async (options: ConnectRealtimeOptions) => {
      connectionLost = options.onConnectionLost;
      rawEvent = options.onEvent;
      options.onConnected();
      return {
        admission: ADMISSION,
        close,
        interrupt: jest.fn(() => false),
        setMuted: jest.fn(),
      };
    }),
    reconnect: jest.fn(),
    end: jest.fn(),
  } as never);

  await controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] });
  connectionLost?.();
  rawEvent?.({ type: 'response.created', event_id: 'evt_after_disconnect' });

  expect(close).toHaveBeenCalledTimes(1);
  expect(controller.snapshot.lifecycle).toBe('reconnecting');
  expect(controller.snapshot.events).toEqual([]);
});

test('a replacement admission is stopped when local reconnect attachment fails', async () => {
  const firstMedia = mediaFakes();
  const replacementMedia = mediaFakes();
  const replacement = {
    ...ADMISSION,
    connection: { ...ADMISSION.connection, answer_sdp: 'v=0\r\na=replacement-answer' },
  };
  let connectionLost: (() => void) | undefined;
  let microphoneRequests = 0;
  let preparations = 0;
  let connections = 0;
  const end = jest.fn(async () => ({
    session_id: ADMISSION.session_id,
    lifecycle: 'ended' as const,
    end_reason: 'failed' as const,
    scenario_completed: false as const,
    transcript: [],
    evidence: { applied: false as const, reason: 'authored_scenario_evidence_not_integrated' },
  }));
  const controller = new VoiceSessionController(jest.fn(), true, {
    requestMicrophone: jest.fn(async () => {
      microphoneRequests += 1;
      return microphoneRequests === 1 ? firstMedia.stream : replacementMedia.stream;
    }),
    prepare: jest.fn(async () => {
      preparations += 1;
      return preparations === 1 ? firstMedia.prepared : replacementMedia.prepared;
    }),
    create: jest.fn(async () => ADMISSION),
    connect: jest.fn(async (options: ConnectRealtimeOptions) => {
      connections += 1;
      if (connections === 2) throw new Error('replacement attachment failed');
      connectionLost = options.onConnectionLost;
      options.onConnected();
      return {
        admission: ADMISSION,
        close: jest.fn(),
        interrupt: jest.fn(() => false),
        setMuted: jest.fn(),
      };
    }),
    reconnect: jest.fn(async () => replacement),
    end,
  } as never);

  await controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] });
  connectionLost?.();
  await expect(controller.reconnect()).rejects.toThrow('replacement attachment failed');

  expect(end).toHaveBeenCalledWith(
    replacement.session_id,
    { reason: 'failed', events: [] },
    expect.stringMatching(/^voice-cleanup:/),
  );
  expect(replacementMedia.closeChannel).toHaveBeenCalledTimes(1);
  expect(replacementMedia.closePeer).toHaveBeenCalledTimes(1);
  expect(replacementMedia.stop).toHaveBeenCalledTimes(1);
});

test('a terminal provider error closes media and requests server cleanup', async () => {
  const media = mediaFakes();
  let rawEvent: ((event: unknown) => void) | undefined;
  const close = jest.fn();
  const setMuted = jest.fn();
  const end = jest.fn(async () => ({
    session_id: ADMISSION.session_id,
    lifecycle: 'ended' as const,
    end_reason: 'failed' as const,
    scenario_completed: false as const,
    transcript: [],
    evidence: { applied: false as const, reason: 'authored_scenario_evidence_not_integrated' },
  }));
  const controller = new VoiceSessionController(jest.fn(), true, {
    requestMicrophone: jest.fn(async () => media.stream),
    prepare: jest.fn(async () => media.prepared),
    create: jest.fn(async () => ADMISSION),
    connect: jest.fn(async (options: ConnectRealtimeOptions) => {
      rawEvent = options.onEvent;
      options.onConnected();
      return { admission: ADMISSION, close, setMuted, interrupt: jest.fn(() => false) };
    }),
    reconnect: jest.fn(),
    end,
  } as never);

  await controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] });
  rawEvent?.({ type: 'error', event_id: 'evt_provider_error', error: { code: 'server_error' } });
  await Promise.resolve();

  expect(setMuted).toHaveBeenCalledWith(true, false);
  expect(close).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledTimes(1);
  expect(controller.snapshot).toMatchObject({ lifecycle: 'failed', failureCode: 'provider_failed' });
});

test('interrupt, mute, event normalization, and end cleanup stay independently observable', async () => {
  const media = mediaFakes();
  let connected: (() => void) | undefined;
  let rawEvent: ((event: unknown) => void) | undefined;
  const close = jest.fn();
  const setMuted = jest.fn();
  const interrupt = jest.fn(() => true);
  const end = jest.fn(async (_sessionId: string, _request: { events: VoiceSessionEvent[] }) => ({
    session_id: ADMISSION.session_id,
    lifecycle: 'ended' as const,
    end_reason: 'cancelled' as const,
    scenario_completed: false as const,
    transcript: [],
    evidence: { applied: false as const, reason: 'authored_scenario_evidence_not_integrated' },
  }));
  const controller = new VoiceSessionController(
    jest.fn(),
    true,
    {
      requestMicrophone: jest.fn(async () => media.stream),
      prepare: jest.fn(async () => media.prepared),
      create: jest.fn(async () => ADMISSION),
      connect: jest.fn(async (options: ConnectRealtimeOptions) => {
        connected = options.onConnected;
        rawEvent = options.onEvent;
        return { admission: ADMISSION, close, setMuted, interrupt };
      }),
      reconnect: jest.fn(),
      end,
    } as never,
  );

  await controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] });
  connected?.();
  rawEvent?.({ type: 'response.output_audio_transcript.done', event_id: 'evt_1', transcript: 'Γεια!' });
  controller.setMuted(true);
  expect(controller.interrupt()).toBe(true);
  await controller.end('cancelled');

  expect(setMuted).toHaveBeenCalledWith(true);
  expect(close).toHaveBeenCalledTimes(1);
  const endEvents = end.mock.calls[0]?.[1].events ?? [];
  expect(endEvents.map((event) => event.type)).toEqual(['transcript.final']);
  expect(controller.snapshot.lifecycle).toBe('ended');
});

test('end drops partial transcripts and sends at most 256 final events', async () => {
  const media = mediaFakes();
  let rawEvent: ((event: unknown) => void) | undefined;
  const end = jest.fn(async (_sessionId: string, request: { events: VoiceSessionEvent[] }) => ({
    session_id: ADMISSION.session_id,
    lifecycle: 'ended' as const,
    end_reason: 'cancelled' as const,
    scenario_completed: false as const,
    transcript: request.events,
    evidence: { applied: false as const, reason: 'authored_scenario_evidence_not_integrated' },
  }));
  const controller = new VoiceSessionController(jest.fn(), true, {
    requestMicrophone: jest.fn(async () => media.stream),
    prepare: jest.fn(async () => media.prepared),
    create: jest.fn(async () => ADMISSION),
    connect: jest.fn(async (options: ConnectRealtimeOptions) => {
      rawEvent = options.onEvent;
      options.onConnected();
      return {
        admission: ADMISSION,
        close: jest.fn(),
        interrupt: jest.fn(() => false),
        setMuted: jest.fn(),
      };
    }),
    reconnect: jest.fn(),
    end,
  } as never);

  await controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] });
  for (let index = 0; index < 300; index += 1) {
    rawEvent?.({
      type: 'conversation.item.input_audio_transcription.delta',
      event_id: `evt_partial_${index}`,
      delta: 'γ',
    });
  }
  for (let index = 0; index < 300; index += 1) {
    rawEvent?.({
      type: 'conversation.item.input_audio_transcription.completed',
      event_id: `evt_final_${index}`,
      transcript: `τελικό ${index}`,
    });
  }
  await controller.end('cancelled');

  const sent = end.mock.calls[0]?.[1].events ?? [];
  expect(sent).toHaveLength(256);
  expect(sent.every((event) => event.type === 'transcript.final')).toBe(true);
  expect(sent[0]?.text).toBe('τελικό 44');
});

test('untrusted provider event volume cannot exceed the server sequence bound or block cleanup', async () => {
  const media = mediaFakes();
  let rawEvent: ((event: unknown) => void) | undefined;
  const close = jest.fn();
  const setMuted = jest.fn();
  const end = jest.fn(async (_sessionId: string, request: { events: VoiceSessionEvent[] }) => ({
    session_id: ADMISSION.session_id,
    lifecycle: 'ended' as const,
    end_reason: 'failed' as const,
    scenario_completed: false as const,
    transcript: request.events,
    evidence: { applied: false as const, reason: 'authored_scenario_evidence_not_integrated' },
  }));
  const controller = new VoiceSessionController(jest.fn(), true, {
    requestMicrophone: jest.fn(async () => media.stream),
    prepare: jest.fn(async () => media.prepared),
    create: jest.fn(async () => ADMISSION),
    connect: jest.fn(async (options: ConnectRealtimeOptions) => {
      rawEvent = options.onEvent;
      options.onConnected();
      return { admission: ADMISSION, close, interrupt: jest.fn(() => false), setMuted };
    }),
    reconnect: jest.fn(),
    end,
  } as never);

  await controller.start({ ...REQUEST, client_capabilities: [...REQUEST.client_capabilities] });
  for (let index = 0; index <= 10_000; index += 1) {
    rawEvent?.({
      type: 'conversation.item.input_audio_transcription.completed',
      event_id: `evt_bounded_${index}`,
      transcript: `bounded ${index}`,
    });
  }
  await Promise.resolve();

  expect(controller.snapshot).toMatchObject({
    lifecycle: 'failed',
    failureCode: 'provider_event_limit',
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(setMuted).toHaveBeenCalledWith(true, false);
  expect(end).toHaveBeenCalledTimes(1);
  const sent = end.mock.calls[0]?.[1].events ?? [];
  expect(Math.max(...sent.map((event) => event.sequence))).toBe(10_000);
});
