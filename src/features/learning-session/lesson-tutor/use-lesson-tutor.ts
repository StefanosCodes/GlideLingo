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
  const lessonRef = useRef(lessonId);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    contextRef.current = pageContext;
  }, [pageContext]);

  const cancel = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);

  useEffect(() => {
    if (lessonRef.current !== lessonId) {
      cancel();
      lessonRef.current = lessonId;
      dispatch({ type: 'reset', conversationId: createConversationId() });
    }
    return cancel;
  }, [cancel, lessonId]);

  const runTurn = useCallback(
    async (userMessage: TutorMessage) => {
      const requestState = stateRef.current;
      const requestLesson = lessonRef.current;
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
          controller.signal,
        );
        if (controller.signal.aborted || lessonRef.current !== requestLesson) return;
        dispatch({
          type: 'succeed',
          messageId: userMessage.id,
          reply: { id: createId('assistant'), role: 'assistant', content: result.reply },
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          lessonRef.current !== requestLesson ||
          (error instanceof LessonTutorRequestError && error.cancelled)
        ) {
          return;
        }
        dispatch({ type: 'fail', messageId: userMessage.id });
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
      void runTurn(message);
      return true;
    },
    [runTurn],
  );

  const retry = useCallback(() => {
    if (!stateRef.current.error || stateRef.current.status === 'working') return;
    const message = [...stateRef.current.messages].reverse().find((item) => item.role === 'user');
    if (!message) return;
    dispatch({ type: 'retry', messageId: message.id });
    stateRef.current = lessonTutorReducer(stateRef.current, {
      type: 'retry',
      messageId: message.id,
    });
    void runTurn(message);
  }, [runTurn]);

  return { cancel, retry, send, state };
}

export function isLessonTutorEnabled(): boolean {
  return process.env.EXPO_PUBLIC_LESSON_TUTOR_ENABLED === 'true';
}
