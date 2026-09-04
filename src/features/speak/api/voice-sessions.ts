import { ApiClientError, getJson, postJson } from '@/api/client';
import type {
  VoiceSessionAdmission,
  VoiceSessionEvent,
  VoiceSessionRecap,
  VoiceSessionSpec,
} from '../model/voice-session';
import { isRecord, isVoiceEndReason, parseVoiceSessionEvent } from '../model/voice-session';

export type StartVoiceSession = {
  course_id: string;
  scenario_id: string;
  conversation_mode: 'guided';
  source_locale: 'en';
  target_locale: 'el-GR';
  captions_enabled: boolean;
  retain_transcript: false;
  offer_sdp: string;
  client_capabilities: ('audio' | 'captions' | 'interrupt' | 'reconnect')[];
};

export type EndVoiceSession = {
  reason: VoiceSessionRecap['end_reason'];
  events: VoiceSessionEvent[];
};

export class VoiceSessionRequestError extends Error {
  readonly cancelled: boolean;
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean, cancelled = false) {
    super('The voice session request did not complete.');
    this.name = 'VoiceSessionRequestError';
    this.code = code;
    this.retryable = retryable;
    this.cancelled = cancelled;
  }
}

export async function createVoiceSession(
  request: StartVoiceSession,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<VoiceSessionAdmission> {
  return requestVoice(() =>
    postJson({
      path: '/v1/voice-sessions',
      body: request,
      idempotencyKey,
      parse: parseAdmission,
      signal,
      timeoutMs: 15_000,
    }),
  );
}

export async function reconnectVoiceSession(
  sessionId: string,
  offerSdp: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<VoiceSessionAdmission> {
  return requestVoice(() =>
    postJson({
      path: `/v1/voice-sessions/${sessionId}/reconnect`,
      body: { offer_sdp: offerSdp },
      idempotencyKey,
      parse: parseAdmission,
      signal,
      timeoutMs: 15_000,
    }),
  );
}

export async function endVoiceSession(
  sessionId: string,
  request: EndVoiceSession,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<VoiceSessionRecap> {
  return requestVoice(() =>
    postJson({
      path: `/v1/voice-sessions/${sessionId}/end`,
      body: request,
      idempotencyKey,
      parse: parseRecap,
      signal,
      timeoutMs: 12_000,
    }),
  );
}

export async function getVoiceSessionRecap(
  sessionId: string,
  signal?: AbortSignal,
): Promise<VoiceSessionRecap> {
  return requestVoice(() =>
    getJson({
      path: `/v1/voice-sessions/${sessionId}/recap`,
      parse: parseRecap,
      signal,
    }),
  );
}

async function requestVoice<T>(request: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await request()).data;
  } catch (error) {
    if (error instanceof ApiClientError) {
      const code = structuredErrorCode(error.body) ?? error.kind;
      const retryable = !(
        error.status === 401 ||
        error.status === 403 ||
        error.status === 404 ||
        error.status === 409 ||
        error.status === 422
      );
      throw new VoiceSessionRequestError(code, retryable, error.kind === 'cancelled');
    }
    throw new VoiceSessionRequestError('unknown', true);
  }
}

function parseAdmission(value: unknown): VoiceSessionAdmission | null {
  if (!isRecord(value) || !isRecord(value.spec) || !isRecord(value.connection)) return null;
  if (
    typeof value.session_id !== 'string' ||
    value.lifecycle !== 'connecting' ||
    typeof value.expires_at !== 'string' ||
    Number.isNaN(Date.parse(value.expires_at)) ||
    value.connection.type !== 'openai-webrtc-sdp' ||
    typeof value.connection.answer_sdp !== 'string' ||
    !value.connection.answer_sdp.startsWith('v=0') ||
    value.connection.answer_sdp.length > 65_536
  ) {
    return null;
  }
  const spec = parseSpec(value.spec);
  if (!spec) return null;
  return { ...value, spec } as VoiceSessionAdmission;
}

function parseSpec(value: Record<string, unknown>): VoiceSessionSpec | null {
  const strings = [
    'course_id',
    'course_version',
    'scenario_id',
    'scenario_version',
    'source_locale',
    'target_locale',
    'persona_id',
    'voice_id',
    'learner_level',
    'correction_policy_version',
    'evidence_policy_version',
  ];
  if (strings.some((key) => typeof value[key] !== 'string')) return null;
  if (value.conversation_mode !== 'guided') return null;
  if (
    !Array.isArray(value.capability_ids) ||
    value.capability_ids.length < 1 ||
    value.capability_ids.length > 8 ||
    value.capability_ids.some((item) => typeof item !== 'string')
  ) {
    return null;
  }
  if (
    typeof value.maximum_duration_seconds !== 'number' ||
    !Number.isInteger(value.maximum_duration_seconds) ||
    value.maximum_duration_seconds < 60 ||
    value.maximum_duration_seconds > 600
  ) {
    return null;
  }
  return value as VoiceSessionSpec;
}

function parseRecap(value: unknown): VoiceSessionRecap | null {
  if (!isRecord(value) || !isRecord(value.evidence) || !Array.isArray(value.transcript)) return null;
  const transcript = value.transcript.map(parseVoiceSessionEvent);
  if (
    typeof value.session_id !== 'string' ||
    value.lifecycle !== 'ended' ||
    !isVoiceEndReason(value.end_reason) ||
    value.scenario_completed !== false ||
    value.evidence.applied !== false ||
    typeof value.evidence.reason !== 'string' ||
    transcript.some((event) => event === null)
  ) {
    return null;
  }
  const parsedTranscript = transcript as VoiceSessionEvent[];
  if (
    parsedTranscript.some((event) => event.session_id !== value.session_id) ||
    parsedTranscript.some((event, index) => index > 0 && event.sequence <= parsedTranscript[index - 1].sequence) ||
    new Set(parsedTranscript.map((event) => event.event_id)).size !== parsedTranscript.length
  ) {
    return null;
  }
  return { ...value, transcript: parsedTranscript } as VoiceSessionRecap;
}

function structuredErrorCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  return typeof value.error.code === 'string' ? value.error.code : null;
}
