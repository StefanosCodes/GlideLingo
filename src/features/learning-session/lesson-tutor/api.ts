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

export class LessonTutorRequestError extends Error {
  readonly cancelled: boolean;

  constructor(cancelled = false) {
    super('The lesson tutor request did not complete.');
    this.name = 'LessonTutorRequestError';
    this.cancelled = cancelled;
  }
}

export async function createLessonTutorTurn(
  turn: LessonTutorTurn,
  signal?: AbortSignal,
): Promise<LessonTutorResponse> {
  try {
    const response = await postJson({
      body: turn,
      parse: parseLessonTutorResponse,
      path: '/v1/lesson-tutor/turns',
      signal,
      timeoutMs: 25_000,
    });
    return response.data;
  } catch (error) {
    throw new LessonTutorRequestError(error instanceof ApiClientError && error.kind === 'cancelled');
  }
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
