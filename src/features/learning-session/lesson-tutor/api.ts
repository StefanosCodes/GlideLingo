import { ApiClientError, postJson } from '@/api/client';

export type LessonTutorHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type LessonTutorTurn = {
  conversation_id: string;
  lesson_id: string;
  visible_step_index: number;
  selected_choice: string | null;
  message: string;
  history: LessonTutorHistoryMessage[];
};

export type LessonTutorResponse = {
  reply: string;
  prompt_version: 'lesson-tutor-v1';
};

export type LessonTutorFailureReason = 'requires-pro' | 'billing-unavailable' | 'other';

export class LessonTutorRequestError extends Error {
  readonly cancelled: boolean;
  readonly reason: LessonTutorFailureReason;
  readonly retryable: boolean;

  constructor(cancelled = false, retryable = true, reason: LessonTutorFailureReason = 'other') {
    super('The lesson tutor request did not complete.');
    this.name = 'LessonTutorRequestError';
    this.cancelled = cancelled;
    this.reason = reason;
    this.retryable = retryable;
  }
}

export async function createLessonTutorTurn(
  turn: LessonTutorTurn,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<LessonTutorResponse> {
  try {
    const response = await postJson({
      body: turn,
      idempotencyKey,
      parse: parseLessonTutorResponse,
      path: '/v1/lesson-tutor/turns',
      signal,
      timeoutMs: 12_000,
    });
    return response.data;
  } catch (error) {
    const cancelled = error instanceof ApiClientError && error.kind === 'cancelled';
    const errorCode = error instanceof ApiClientError ? structuredApiErrorCode(error.body) : null;
    const requiresPro =
      error instanceof ApiClientError &&
      error.kind === 'http' &&
      error.status === 403 &&
      errorCode === 'pro_required';
    const billingUnavailable =
      error instanceof ApiClientError &&
      error.kind === 'http' &&
      error.status === 503 &&
      (errorCode === 'billing_unavailable' || errorCode === 'dependency_unavailable');
    const retryable = !(
      requiresPro ||
      error instanceof ApiClientError &&
      error.kind === 'http' &&
      (error.status === 404 || error.status === 409)
    );
    throw new LessonTutorRequestError(
      cancelled,
      retryable,
      requiresPro ? 'requires-pro' : billingUnavailable ? 'billing-unavailable' : 'other',
    );
  }
}

function structuredApiErrorCode(value: unknown) {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  return typeof value.error.code === 'string' ? value.error.code : null;
}

function parseLessonTutorResponse(value: unknown): LessonTutorResponse | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.reply !== 'string' ||
    value.reply.trim().length === 0 ||
    value.prompt_version !== 'lesson-tutor-v1'
  ) {
    return null;
  }
  return { reply: value.reply, prompt_version: value.prompt_version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
