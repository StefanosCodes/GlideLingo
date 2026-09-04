export type VoiceSessionLifecycle =
  | 'creating'
  | 'connecting'
  | 'active'
  | 'reconnecting'
  | 'ending'
  | 'ended'
  | 'failed';

export type VoiceTurnState =
  | 'ready'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted';

export type VoicePresentationState = 'voice-only';

export type VoiceSessionSpec = {
  course_id: string;
  course_version: string;
  scenario_id: string;
  scenario_version: string;
  conversation_mode: 'guided';
  source_locale: string;
  target_locale: string;
  persona_id: string;
  voice_id: string;
  learner_level: string;
  capability_ids: string[];
  correction_policy_version: string;
  evidence_policy_version: string;
  maximum_duration_seconds: number;
  presentation: { show_tutor: false };
};

export type VoiceSessionEventType =
  | 'transcript.partial'
  | 'transcript.final'
  | 'response.started'
  | 'response.completed'
  | 'audio.started'
  | 'audio.stopped'
  | 'response.interrupted'
  | 'session.warning'
  | 'session.failed';

export type VoiceSessionEvent = {
  event_id: string;
  session_id: string;
  turn_id?: string;
  sequence: number;
  occurred_at: string;
  type: VoiceSessionEventType;
  speaker?: 'learner' | 'coach';
  text?: string;
  code?: string;
};

export type VoiceConnection = {
  type: 'openai-webrtc-sdp';
  answer_sdp: string;
};

export type VoiceSessionAdmission = {
  session_id: string;
  lifecycle: 'connecting';
  expires_at: string;
  spec: VoiceSessionSpec;
  connection: VoiceConnection;
};

export type VoiceSessionRecap = {
  session_id: string;
  lifecycle: 'ended';
  end_reason: 'completed' | 'cancelled' | 'timeout' | 'connection_lost' | 'failed';
  scenario_completed: boolean;
  transcript: VoiceSessionEvent[];
  evidence: { applied: false; reason: string };
};

const END_REASONS = new Set<VoiceSessionRecap['end_reason']>([
  'completed',
  'cancelled',
  'timeout',
  'connection_lost',
  'failed',
]);

const EVENT_TYPES = new Set<VoiceSessionEventType>([
  'transcript.partial',
  'transcript.final',
  'response.started',
  'response.completed',
  'audio.started',
  'audio.stopped',
  'response.interrupted',
  'session.warning',
  'session.failed',
]);

export function parseVoiceSessionEvent(value: unknown): VoiceSessionEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.event_id !== 'string' ||
    !/^[A-Za-z0-9._:-]{8,120}$/.test(value.event_id) ||
    typeof value.session_id !== 'string' ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    value.sequence > 10_000 ||
    typeof value.occurred_at !== 'string' ||
    Number.isNaN(Date.parse(value.occurred_at)) ||
    typeof value.type !== 'string' ||
    !EVENT_TYPES.has(value.type as VoiceSessionEventType)
  ) {
    return null;
  }
  if (
    value.turn_id !== undefined &&
    (typeof value.turn_id !== 'string' || value.turn_id.length < 1 || value.turn_id.length > 120)
  ) {
    return null;
  }
  if (value.speaker !== undefined && value.speaker !== 'learner' && value.speaker !== 'coach') {
    return null;
  }
  const transcript = value.type === 'transcript.partial' || value.type === 'transcript.final';
  if (
    (transcript &&
      (value.speaker === undefined || typeof value.text !== 'string' || value.text.length > 4_000)) ||
    (!transcript && value.text !== undefined)
  ) {
    return null;
  }
  if (value.code !== undefined && (typeof value.code !== 'string' || value.code.length > 100)) {
    return null;
  }
  return value as VoiceSessionEvent;
}

export function isVoiceEndReason(value: unknown): value is VoiceSessionRecap['end_reason'] {
  return typeof value === 'string' && END_REASONS.has(value as VoiceSessionRecap['end_reason']);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
