import { expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import { ModuleTree } from '@/components/module-tree';

const mockSelectLesson = jest.fn();

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('@/providers/learning-provider', () => ({
  useLearning: () => ({
    activeLessonId: null,
    completedLessonIds: [],
    currentModule: { id: 'unit-one' },
    enrolledCourse: {
      id: 'course',
      modules: [
        {
          id: 'unit-one',
          title: 'First unit',
          canDo: 'I can begin.',
          lessons: [{ id: 'lesson-one', title: 'Available lesson', durationMin: 8 }],
        },
        {
          id: 'unit-two',
          title: 'Later unit',
          canDo: 'I can continue.',
          lessons: [{ id: 'lesson-two', title: 'Locked lesson', durationMin: 8 }],
        },
        {
          id: 'unit-three',
          title: 'Unauthored unit',
          canDo: 'I can continue later.',
          lessons: [{ id: 'lesson-three', title: 'Placeholder lesson', durationMin: 8, contentStatus: 'placeholder' }],
        },
      ],
    },
    nextLesson: { lesson: { id: 'lesson-one' }, module: { id: 'unit-one' } },
  }),
}));

test('marks future lessons locked and prevents opening them', async () => {
  mockSelectLesson.mockClear();
  const screen = await render(<ModuleTree density="page" onSelectLesson={mockSelectLesson} />);

  await fireEvent.press(screen.getByLabelText('Later unit. Upcoming'));
  const locked = screen.getByLabelText('Locked lesson. Locked');

  expect(locked.props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(locked);
  expect(mockSelectLesson).not.toHaveBeenCalled();
});

test('marks placeholder lessons unavailable and prevents opening them', async () => {
  mockSelectLesson.mockClear();
  const screen = await render(<ModuleTree density="page" onSelectLesson={mockSelectLesson} />);

  await fireEvent.press(screen.getByLabelText('Unauthored unit. Not available'));
  const unavailable = screen.getByLabelText('Placeholder lesson. Not available');

  expect(unavailable.props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(unavailable);
  expect(mockSelectLesson).not.toHaveBeenCalled();
});
