import { expect, test } from '@jest/globals';

import { initialVoiceSessionState, voiceSessionReducer } from '../reducer';
import type { VoiceSessionEvent } from '../voice-session';

function event(sequence: number, type: VoiceSessionEvent['type']): VoiceSessionEvent {
  return {
    event_id: `event:test:${sequence}`,
    session_id: '00000000-0000-4000-8000-000000000001',
    sequence,
    occurred_at: '2026-09-02T00:00:00Z',
    type,
  };
}

test('keeps lifecycle, turn, and presentation state independent', () => {
  let state = initialVoiceSessionState();
  expect(state.muted).toBe(true);
  state = voiceSessionReducer(state, { type: 'admitted' });
  state = voiceSessionReducer(state, { type: 'connected' });
  state = voiceSessionReducer(state, { type: 'provider-event', event: event(1, 'audio.started') });

  expect(state.lifecycle).toBe('active');
  expect(state.turn).toBe('speaking');
  expect(state.presentation).toBe('voice-only');

  state = voiceSessionReducer(state, { type: 'connection-lost' });
  expect(state.lifecycle).toBe('reconnecting');
  expect(state.turn).toBe('ready');
  expect(state.muted).toBe(true);
});

test('rejects replayed and out-of-order normalized events', () => {
  let state = voiceSessionReducer(initialVoiceSessionState(), { type: 'admitted' });
  state = voiceSessionReducer(state, { type: 'connected' });
  state = voiceSessionReducer(state, { type: 'provider-event', event: event(2, 'response.started') });
  const unchanged = voiceSessionReducer(state, {
    type: 'provider-event',
    event: { ...event(1, 'audio.started'), event_id: 'event:late:1' },
  });
  const duplicate = voiceSessionReducer(state, {
    type: 'provider-event',
    event: { ...event(3, 'audio.started'), event_id: state.events[0].event_id },
  });

  expect(unchanged).toBe(state);
  expect(duplicate).toBe(state);
});

test('terminal lifecycle states ignore later transitions and controls', () => {
  let state = voiceSessionReducer(initialVoiceSessionState(), { type: 'admitted' });
  state = voiceSessionReducer(state, { type: 'end-requested' });
  state = voiceSessionReducer(state, { type: 'ended' });

  expect(voiceSessionReducer(state, { type: 'connected' })).toBe(state);
  expect(voiceSessionReducer(state, { type: 'muted', muted: true })).toBe(state);
});

test('push-to-talk updates turn state independently from lifecycle', () => {
  let state = voiceSessionReducer(initialVoiceSessionState(), { type: 'admitted' });
  state = voiceSessionReducer(state, { type: 'connected' });
  state = voiceSessionReducer(state, { type: 'muted', muted: false });
  expect(state).toMatchObject({ lifecycle: 'active', muted: false, turn: 'listening' });
  state = voiceSessionReducer(state, { type: 'muted', muted: true });
  expect(state).toMatchObject({ lifecycle: 'active', muted: true, turn: 'thinking' });
});

test('a terminal provider event ends active state without flattening its event', () => {
  let state = voiceSessionReducer(initialVoiceSessionState(), { type: 'admitted' });
  state = voiceSessionReducer(state, { type: 'connected' });
  state = voiceSessionReducer(state, { type: 'provider-event', event: event(1, 'session.failed') });
  expect(state).toMatchObject({ lifecycle: 'failed', muted: true, failureCode: 'provider_failed' });
  expect(state.events).toHaveLength(1);
});
