import { useCallback, useEffect, useReducer, useRef } from 'react';

import {
  createLessonTutorTurn,
  LessonTutorRequestError,
  type LessonTutorTurn,
} from '@/features/learning-session/lesson-tutor/api';
import {
  historyBefore,
  initialLessonTutorState,
  lessonTutorReducer,
  type TutorMessage,
} from '@/features/learning-session/lesson-tutor/reducer';

type TutorPageContext = Pick<
  LessonTutorTurn,
  'lesson_id' | 'selected_choice' | 'visible_step_index'
>;

type TurnClient = typeof createLessonTutorTurn;

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createConversationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function useLessonTutor(
  lessonId: string,
  pageContext: TutorPageContext,
  turnClient: TurnClient = createLessonTutorTurn,
) {
  const [state, dispatch] = useReducer(
    lessonTutorReducer,
    undefined,
    () => initialLessonTutorState(createConversationId()),
  );
  const stateRef = useRef(state);
  const contextRef = useRef(pageContext);
  const activeRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const pageKey = `${lessonId}:${pageContext.visible_step_index}:${pageContext.selected_choice ?? ''}`;
  const pageKeyRef = useRef(pageKey);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const cancel = useCallback(() => {
    requestGeneration.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);

  useEffect(() => {
    contextRef.current = pageContext;
    if (pageKeyRef.current !== pageKey) {
      cancel();
      pageKeyRef.current = pageKey;
      const resetAction = { type: 'reset', conversationId: createConversationId() } as const;
      dispatch(resetAction);
      stateRef.current = lessonTutorReducer(stateRef.current, resetAction);
    }
  }, [cancel, pageContext, pageKey]);

  useEffect(() => cancel, [cancel]);

  const runTurn = useCallback(
    async (userMessage: TutorMessage, idempotencyKey: string) => {
      const requestState = stateRef.current;
      const generation = requestGeneration.current;
      const controller = new AbortController();
      activeRequest.current = controller;
      try {
        const result = await turnClient(
          {
            ...contextRef.current,
            conversation_id: requestState.conversationId,
            history: historyBefore(requestState.messages, userMessage.id),
            message: userMessage.content,
          },
          idempotencyKey,
          controller.signal,
        );
        if (controller.signal.aborted || requestGeneration.current !== generation) return;
        dispatch({
          type: 'succeed',
          messageId: userMessage.id,
          reply: { id: createId('assistant'), role: 'assistant', content: result.reply },
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestGeneration.current !== generation ||
          (error instanceof LessonTutorRequestError && error.cancelled)
        ) {
          return;
        }
        dispatch({
          type: 'fail',
          error:
            error instanceof LessonTutorRequestError && error.reason === 'requires-pro'
              ? 'requires-pro'
              : error instanceof LessonTutorRequestError && error.reason === 'billing-unavailable'
                ? 'billing-unavailable'
                : error instanceof LessonTutorRequestError && !error.retryable
                  ? 'terminal'
                  : 'retryable',
          messageId: userMessage.id,
        });
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null;
      }
    },
    [turnClient],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || stateRef.current.status === 'working') return false;
      const message: TutorMessage = { id: createId('user'), role: 'user', content: trimmed };
      dispatch({ type: 'send', message });
      stateRef.current = lessonTutorReducer(stateRef.current, { type: 'send', message });
      void runTurn(message, message.id);
      return true;
    },
    [runTurn],
  );

  const retry = useCallback(() => {
    if (
      (stateRef.current.error !== 'retryable' && stateRef.current.error !== 'billing-unavailable') ||
      stateRef.current.status === 'working'
    ) return;
    const message = [...stateRef.current.messages].reverse().find((item) => item.role === 'user');
    if (!message) return;
    dispatch({ type: 'retry', messageId: message.id });
    stateRef.current = lessonTutorReducer(stateRef.current, {
      type: 'retry',
      messageId: message.id,
    });
    // Reuse the operation key so a lost completed response replays and an ambiguous outcome
    // fails closed instead of invoking the provider twice.
    void runTurn(message, message.id);
  }, [runTurn]);

  return { cancel, retry, send, state };
}

export function isLessonTutorEnabled(): boolean {
  return process.env.EXPO_PUBLIC_LESSON_TUTOR_ENABLED === 'true';
}
