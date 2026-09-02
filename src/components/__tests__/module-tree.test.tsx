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
