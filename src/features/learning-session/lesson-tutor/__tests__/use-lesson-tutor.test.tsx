import { expect, jest, test } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { type LessonTutorResponse } from '@/features/learning-session/lesson-tutor/api';
import {
  isLessonTutorEnabled,
  useLessonTutor,
} from '@/features/learning-session/lesson-tutor/use-lesson-tutor';

const response: LessonTutorResponse = {
  reply: 'It is close to the ee in see.',
  prompt_version: 'lesson-tutor-v1',
};

test('selected check choice reaches the tutor request', async () => {
  const client = jest.fn(async () => response);
  const { result } = await renderHook(() =>
    useLessonTutor(
      'el-letters-1',
      {
        lesson_id: 'el-letters-1',
        selected_choice: 'ε',
        visible_step_index: 5,
      },
      client,
    ),
  );

  await act(() => {
    expect(result.current.send('Why was that wrong?')).toBe(true);
  });

  await waitFor(() => expect(result.current.state.messages).toHaveLength(2));
  expect(client).toHaveBeenCalledWith(
    expect.objectContaining({
      lesson_id: 'el-letters-1',
      message: 'Why was that wrong?',
      selected_choice: 'ε',
      visible_step_index: 5,
    }),
    expect.any(AbortSignal),
  );
});

test('active request prevents duplicate sends', async () => {
  const client = jest.fn(() => new Promise<LessonTutorResponse>(() => undefined));
  const { result, unmount } = await renderHook(() =>
    useLessonTutor(
      'el-letters-1',
      { lesson_id: 'el-letters-1', selected_choice: null, visible_step_index: 0 },
      client,
    ),
  );

  await act(() => {
    expect(result.current.send('First')).toBe(true);
    expect(result.current.send('Duplicate')).toBe(false);
  });
  expect(client).toHaveBeenCalledTimes(1);
  await unmount();
});

test('step changes cancel and discard a stale tutor reply', async () => {
  let resolveTurn: ((value: LessonTutorResponse) => void) | undefined;
  const client = jest.fn(
    (_turn: unknown, _signal?: AbortSignal) =>
      new Promise<LessonTutorResponse>((resolve) => {
        resolveTurn = resolve;
      }),
  );
  const { result, rerender } = await renderHook<
    ReturnType<typeof useLessonTutor>,
    { step: number }
  >(
    ({ step }: { step: number }) =>
      useLessonTutor(
        'el-letters-1',
        { lesson_id: 'el-letters-1', selected_choice: null, visible_step_index: step },
        client,
      ),
    { initialProps: { step: 0 } },
  );

  await act(() => {
    expect(result.current.send('Explain this step')).toBe(true);
  });
  const signal = client.mock.calls[0][1];

  await rerender({ step: 1 });
  expect(signal?.aborted).toBe(true);
  expect(result.current.state.messages).toEqual([]);
  expect(result.current.state.status).toBe('idle');

  await act(() => {
    resolveTurn?.(response);
  });
  expect(result.current.state.messages).toEqual([]);
});

test('feature flag is disabled unless explicitly true', () => {
  const previous = process.env.EXPO_PUBLIC_LESSON_TUTOR_ENABLED;
  delete process.env.EXPO_PUBLIC_LESSON_TUTOR_ENABLED;
  expect(isLessonTutorEnabled()).toBe(false);
  process.env.EXPO_PUBLIC_LESSON_TUTOR_ENABLED = 'true';
  expect(isLessonTutorEnabled()).toBe(true);
  if (previous === undefined) delete process.env.EXPO_PUBLIC_LESSON_TUTOR_ENABLED;
  else process.env.EXPO_PUBLIC_LESSON_TUTOR_ENABLED = previous;
});
