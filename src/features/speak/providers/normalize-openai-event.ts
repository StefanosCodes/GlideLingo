import type { VoiceSessionEvent, VoiceSessionEventType } from '../model/voice-session';
import { isRecord } from '../model/voice-session';

const EVENT_MAP: Record<string, VoiceSessionEventType> = {
  'conversation.item.input_audio_transcription.delta': 'transcript.partial',
  'conversation.item.input_audio_transcription.completed': 'transcript.final',
  'response.output_audio_transcript.delta': 'transcript.partial',
  'response.output_audio_transcript.done': 'transcript.final',
  'response.created': 'response.started',
  'output_audio_buffer.started': 'audio.started',
  'output_audio_buffer.stopped': 'audio.stopped',
  error: 'session.failed',
};

export function normalizeOpenAIRealtimeEvent(
  raw: unknown,
  context: { sessionId: string; sequence: number; occurredAt?: string },
): VoiceSessionEvent | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  let type = EVENT_MAP[raw.type];
  let responseCode: string | undefined;
  if (raw.type === 'response.done') {
    const status = isRecord(raw.response) ? raw.response.status : undefined;
    if (status === 'completed') type = 'response.completed';
    else if (status === 'cancelled') type = 'response.interrupted';
    else if (status === 'failed') {
      type = 'session.failed';
      responseCode = 'response_failed';
    } else if (status === 'incomplete') {
      type = 'session.failed';
      responseCode = 'response_incomplete';
    } else {
      type = 'session.failed';
      responseCode = 'response_status_invalid';
    }
  }
  if (!type) return null;
  const rawEventId = typeof raw.event_id === 'string' ? raw.event_id : '';
  const sanitizedEventId = rawEventId.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 116);
  const providerEventId = sanitizedEventId || `unidentified:${context.sequence}`;
  const itemId =
    typeof raw.item_id === 'string' && raw.item_id.length > 0 && raw.item_id.length <= 120
      ? raw.item_id
      : undefined;
  const textValue = typeof raw.delta === 'string' ? raw.delta : typeof raw.transcript === 'string' ? raw.transcript : undefined;
  const transcript = type === 'transcript.partial' || type === 'transcript.final';
  if (transcript && textValue === undefined) return null;
  const boundedText = textValue?.slice(0, 4000);
  const coach = raw.type.startsWith('response.output_audio_transcript.');
  const error =
    responseCode ??
    (isRecord(raw.error) && typeof raw.error.code === 'string'
      ? raw.error.code.slice(0, 100)
      : undefined);
  return {
    event_id: `oai:${providerEventId}`,
    session_id: context.sessionId,
    turn_id: itemId,
    sequence: context.sequence,
    occurred_at: context.occurredAt ?? new Date().toISOString(),
    type,
    ...(transcript
      ? { speaker: coach ? ('coach' as const) : ('learner' as const), text: boundedText }
      : {}),
    ...(error ? { code: error } : {}),
  };
}
