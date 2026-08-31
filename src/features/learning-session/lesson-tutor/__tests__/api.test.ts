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

test('structured 403 pro_required becomes a non-retryable subscription requirement', async () => {
  fetchMock.mockImplementation(async () =>
    ({
      headers: { get: () => 'req_pro' },
      ok: false,
      status: 403,
      text: async () => JSON.stringify({
        error: {
          code: 'pro_required',
          message: 'An active Pro subscription is required.',
          request_id: 'req_pro',
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
        message: 'Can you explain this?',
        selected_choice: null,
        visible_step_index: 2,
      },
      'client-turn-key-pro',
    ),
  ).rejects.toMatchObject({
    reason: 'requires-pro',
    retryable: false,
  } satisfies Partial<LessonTutorRequestError>);
});

test('structured 503 billing failure remains retryable but is not presented as missing Pro', async () => {
  fetchMock.mockImplementation(async () =>
    ({
      headers: { get: () => 'req_billing' },
      ok: false,
      status: 503,
      text: async () => JSON.stringify({
        error: {
          code: 'billing_unavailable',
          message: 'Subscription verification is unavailable.',
          request_id: 'req_billing',
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
        message: 'Can you explain this?',
        selected_choice: null,
        visible_step_index: 2,
      },
      'client-turn-key-billing',
    ),
  ).rejects.toMatchObject({
    reason: 'billing-unavailable',
    retryable: true,
  } satisfies Partial<LessonTutorRequestError>);
});
