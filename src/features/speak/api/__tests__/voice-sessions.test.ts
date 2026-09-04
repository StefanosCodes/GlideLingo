import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';

import { setApiAccessTokenProvider } from '@/api/auth-token';
import {
  createVoiceSession,
  endVoiceSession,
} from '../voice-sessions';

const SPEC = {
  course_id: 'el-from-zero',
  course_version: 'greek-foundations-v1',
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
};

let cleanupTokenProvider: () => void = () => {};

beforeEach(() => {
  cleanupTokenProvider = setApiAccessTokenProvider(async () => 'clerk-token');
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
  jest.spyOn(global, 'fetch').mockImplementation(async () => new Response());
});

afterEach(() => {
  cleanupTokenProvider();
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
  jest.restoreAllMocks();
});

test('creates an authenticated SDP session with an idempotency key', async () => {
  jest.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        session_id: '00000000-0000-4000-8000-000000000001',
        lifecycle: 'connecting',
        expires_at: '2026-09-02T00:05:00Z',
        spec: SPEC,
        connection: { type: 'openai-webrtc-sdp', answer_sdp: 'v=0\r\na=answer-data-for-test' },
      }),
      { status: 200 },
    ),
  );

  const result = await createVoiceSession(
    {
      course_id: 'el-from-zero',
      scenario_id: 'el-greeting-introduction-v1',
      conversation_mode: 'guided',
      source_locale: 'en',
      target_locale: 'el-GR',
      captions_enabled: true,
      retain_transcript: false,
      offer_sdp: 'v=0\r\na=offer-data-for-test',
      client_capabilities: ['audio', 'captions', 'interrupt', 'reconnect'],
    },
    'voice-start-idempotency-0001',
  );

  expect(result.spec.voice_id).toBe('configured-voice');
  expect(fetch).toHaveBeenCalledWith(
    'https://api.example.test/v1/voice-sessions',
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer clerk-token',
        'Idempotency-Key': 'voice-start-idempotency-0001',
      }),
    }),
  );
});

test('rejects malformed recap events instead of trusting the server payload', async () => {
  jest.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        session_id: '00000000-0000-4000-8000-000000000001',
        lifecycle: 'ended',
        end_reason: 'cancelled',
        scenario_completed: false,
        transcript: [{ type: 'made-up-event' }],
        evidence: { applied: false, reason: 'authored_scenario_evidence_not_integrated' },
      }),
      { status: 200 },
    ),
  );

  await expect(
    endVoiceSession(
      '00000000-0000-4000-8000-000000000001',
      { reason: 'cancelled', events: [] },
      'voice-end-idempotency-0001',
    ),
  ).rejects.toMatchObject({ code: 'invalid-response' });
});

test('maps server authorization failures to a non-retryable safe error', async () => {
  jest.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ error: { code: 'pro_required' } }), { status: 403 }),
  );

  await expect(
    createVoiceSession({} as never, 'voice-start-idempotency-0002'),
  ).rejects.toMatchObject({
    code: 'pro_required',
    retryable: false,
  });
});
