import { expect, test } from '@jest/globals';

import {
  historyBefore,
  initialLessonTutorState,
  lessonTutorReducer,
  type TutorMessage,
} from '@/features/learning-session/lesson-tutor/reducer';

const userMessage: TutorMessage = { id: 'user-1', role: 'user', content: 'Why this sound?' };

test('send, success, and reset form one lesson-scoped conversation', () => {
  const initial = initialLessonTutorState('conversation-1');
  const working = lessonTutorReducer(initial, { type: 'send', message: userMessage });
  const complete = lessonTutorReducer(working, {
    type: 'succeed',
    messageId: userMessage.id,
    reply: { id: 'assistant-1', role: 'assistant', content: 'Compare it with ee in see.' },
  });

  expect(working.status).toBe('working');
  expect(complete.messages).toHaveLength(2);
  expect(lessonTutorReducer(complete, { type: 'reset', conversationId: 'conversation-2' })).toEqual(
    initialLessonTutorState('conversation-2'),
  );
});

test('failure keeps the sent message and retry does not duplicate it', () => {
  const working = lessonTutorReducer(initialLessonTutorState('conversation-1'), {
    type: 'send',
    message: userMessage,
  });
  const failed = lessonTutorReducer(working, {
    type: 'fail',
    messageId: userMessage.id,
    retryable: true,
  });
  const retried = lessonTutorReducer(failed, { type: 'retry', messageId: userMessage.id });

  expect(failed.error).toBe('retryable');
  expect(retried.messages).toEqual([userMessage]);
  expect(retried.pendingUserMessageId).toBe(userMessage.id);
  expect(retried.status).toBe('working');
});

test('stale completion after a lesson reset is ignored', () => {
  const working = lessonTutorReducer(initialLessonTutorState('conversation-1'), {
    type: 'send',
    message: userMessage,
  });
  const reset = lessonTutorReducer(working, { type: 'reset', conversationId: 'conversation-2' });
  const stale = lessonTutorReducer(reset, {
    type: 'succeed',
    messageId: userMessage.id,
    reply: { id: 'assistant-1', role: 'assistant', content: 'Late reply' },
  });

  expect(stale).toBe(reset);
  expect(stale.messages).toEqual([]);
});

test('history is bounded to eight messages before the pending user line', () => {
  const messages: TutorMessage[] = Array.from({ length: 10 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${index}`,
  }));
  const pending: TutorMessage = { id: 'pending', role: 'user', content: 'Now answer' };

  const history = historyBefore([...messages, pending], pending.id);

  expect(history).toHaveLength(8);
  expect(history[0]?.content).toBe('Message 2');
  expect(history.at(-1)?.content).toBe('Message 9');
});
