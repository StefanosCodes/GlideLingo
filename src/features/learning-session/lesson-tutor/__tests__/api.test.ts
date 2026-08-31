import { afterEach, expect, jest, test } from '@jest/globals';

import {
  createLessonTutorTurn,
  LessonTutorRequestError,
} from '@/features/learning-session/lesson-tutor/api';

const fetchMock = jest.spyOn(global, 'fetch');

afterEach(() => {
  fetchMock.mockReset();
});

test('a permanent 409 ambiguity is not exposed as retryable', async () => {
  fetchMock.mockImplementation(async () =>
    ({
      headers: { get: () => 'req_conflict' },
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({
          error: {
            code: 'lesson_tutor_conflict',
            message: 'This tutor turn conflicts with an earlier request.',
            request_id: 'req_conflict',
          },
        }),
    }) as unknown as Response,
  );

  await expect(
    createLessonTutorTurn(
      {
        conversation_id: '00000000-0000-4000-8000-000000000001',
        history: [],
        lesson_id: 'el-letters-1',
        message: 'Why does this sound like ee?',
        selected_choice: null,
        visible_step_index: 2,
      },
      'client-turn-key-0001',
    ),
  ).rejects.toMatchObject({
    cancelled: false,
    retryable: false,
  } satisfies Partial<LessonTutorRequestError>);
});
