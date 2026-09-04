import { expect, test } from '@jest/globals';

import { normalizeOpenAIRealtimeEvent } from '../normalize-openai-event';

const context = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  sequence: 1,
  occurredAt: '2026-09-02T00:00:00Z',
};

test('normalizes coach transcript events without retaining arbitrary provider fields', () => {
  expect(
    normalizeOpenAIRealtimeEvent(
      {
        type: 'response.output_audio_transcript.done',
        event_id: 'evt_1',
        transcript: 'Γεια σου!',
        secret_like_field: 'must-not-propagate',
      },
      context,
    ),
  ).toEqual({
    event_id: 'oai:evt_1',
    session_id: context.sessionId,
    sequence: 1,
    occurred_at: context.occurredAt,
    type: 'transcript.final',
    speaker: 'coach',
    text: 'Γεια σου!',
    turn_id: undefined,
  });
});

test.each([null, 'bad', {}, { type: 'unknown' }, { type: 'response.output_audio_transcript.done' }])(
  'rejects malformed or unsupported provider events: %p',
  (value: unknown) => {
    expect(normalizeOpenAIRealtimeEvent(value, context)).toBeNull();
  },
);

test('normalizes provider errors to a safe code without its message', () => {
  expect(
    normalizeOpenAIRealtimeEvent(
      { type: 'error', event_id: 'evt_err', error: { code: 'rate_limit', message: 'raw detail' } },
      context,
    ),
  ).toMatchObject({ type: 'session.failed', code: 'rate_limit' });
});

test('sanitizes malformed provider IDs before emitting the normalized contract', () => {
  expect(
    normalizeOpenAIRealtimeEvent(
      { type: 'response.created', event_id: 'event id/with unsafe characters' },
      context,
    )?.event_id,
  ).toBe('oai:event_id_with_unsafe_characters');
});

test('keeps a provider event ID stable when the same event is replayed', () => {
  const raw = { type: 'response.created', event_id: 'evt_replayed' };
  expect(normalizeOpenAIRealtimeEvent(raw, context)?.event_id).toBe(
    normalizeOpenAIRealtimeEvent(raw, { ...context, sequence: 9 })?.event_id,
  );
});
