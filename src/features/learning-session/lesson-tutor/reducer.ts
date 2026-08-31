export type TutorMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export type LessonTutorError = 'retryable' | 'terminal' | 'requires-pro' | 'billing-unavailable';

export type LessonTutorState = {
  conversationId: string;
  error: LessonTutorError | null;
  messages: TutorMessage[];
  pendingUserMessageId: string | null;
  status: 'idle' | 'working';
};

export type LessonTutorAction =
  | { type: 'send'; message: TutorMessage }
  | { type: 'retry'; messageId: string }
  | { type: 'succeed'; messageId: string; reply: TutorMessage }
  | { type: 'fail'; error: LessonTutorError; messageId: string }
  | { type: 'reset'; conversationId: string };

export function initialLessonTutorState(conversationId: string): LessonTutorState {
  return {
    conversationId,
    error: null,
    messages: [],
    pendingUserMessageId: null,
    status: 'idle',
  };
}

export function lessonTutorReducer(
  state: LessonTutorState,
  action: LessonTutorAction,
): LessonTutorState {
  switch (action.type) {
    case 'send':
      if (state.status === 'working') return state;
      return {
        ...state,
        error: null,
        messages: [...state.messages, action.message],
        pendingUserMessageId: action.message.id,
        status: 'working',
      };
    case 'retry':
      if (state.status === 'working' || !state.messages.some((item) => item.id === action.messageId)) {
        return state;
      }
      return {
        ...state,
        error: null,
        pendingUserMessageId: action.messageId,
        status: 'working',
      };
    case 'succeed':
      if (state.pendingUserMessageId !== action.messageId) return state;
      return {
        ...state,
        error: null,
        messages: [...state.messages, action.reply],
        pendingUserMessageId: null,
        status: 'idle',
      };
    case 'fail':
      if (state.pendingUserMessageId !== action.messageId) return state;
      return {
        ...state,
        error: action.error,
        pendingUserMessageId: null,
        status: 'idle',
      };
    case 'reset':
      return initialLessonTutorState(action.conversationId);
  }
}

export function historyBefore(
  messages: TutorMessage[],
  userMessageId: string,
): { role: 'user' | 'assistant'; content: string }[] {
  const messageIndex = messages.findIndex((item) => item.id === userMessageId);
  const history = messageIndex < 0 ? messages : messages.slice(0, messageIndex);
  return history.slice(-8).map(({ role, content }) => ({ role, content }));
}
