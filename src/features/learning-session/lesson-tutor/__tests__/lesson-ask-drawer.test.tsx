import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import { LessonAskDrawer } from '@/features/learning-session/lesson-tutor/lesson-ask-drawer';
import { initialLessonTutorState } from '@/features/learning-session/lesson-tutor/reducer';

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));

const baseProps = {
  lessonTitle: 'The Greek sound map',
  onClose: jest.fn(),
  onRetry: jest.fn(),
  onSend: jest.fn(() => true),
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders the accessible empty state and close action', async () => {
  const screen = await render(
    <LessonAskDrawer {...baseProps} state={initialLessonTutorState('conversation-1')} />,
  );

  expect(screen.getByText('Ask about what you’re seeing. I’ll keep the lesson in view.')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Close lesson tutor'));
  expect(baseProps.onClose).toHaveBeenCalledTimes(1);
});

test('working state announces status and disables composing', async () => {
  const state = {
    ...initialLessonTutorState('conversation-1'),
    messages: [{ id: 'user-1', role: 'user' as const, content: 'Why ee?' }],
    pendingUserMessageId: 'user-1',
    status: 'working' as const,
  };
  const screen = await render(<LessonAskDrawer {...baseProps} state={state} />);

  expect(screen.getByLabelText('Looking at this step')).toBeTruthy();
  expect(screen.getByLabelText('Send prompt').props.accessibilityState.disabled).toBe(true);
});

test('error state keeps the message and exposes retry', async () => {
  const state = {
    ...initialLessonTutorState('conversation-1'),
    error: true,
    messages: [{ id: 'user-1', role: 'user' as const, content: 'Why ee?' }],
  };
  const screen = await render(<LessonAskDrawer {...baseProps} state={state} />);

  expect(screen.getByText('Why ee?')).toBeTruthy();
  expect(
    screen.getByText('The tutor isn’t available right now. Your lesson is still here.'),
  ).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Retry tutor message'));
  expect(baseProps.onRetry).toHaveBeenCalledTimes(1);
});

test('reopening with the same lesson state preserves conversation', async () => {
  const state = {
    ...initialLessonTutorState('conversation-1'),
    messages: [
      { id: 'user-1', role: 'user' as const, content: 'What letter is this?' },
      { id: 'assistant-1', role: 'assistant' as const, content: 'That is ι, called iota.' },
    ],
  };
  const screen = await render(<LessonAskDrawer {...baseProps} state={state} />);
  await screen.unmount();
  const reopened = await render(<LessonAskDrawer {...baseProps} state={state} />);

  expect(reopened.getByText('What letter is this?')).toBeTruthy();
  expect(reopened.getByText('That is ι, called iota.')).toBeTruthy();
});
