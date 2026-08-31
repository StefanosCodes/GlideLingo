import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import { LessonAskDrawer } from '@/features/learning-session/lesson-tutor/lesson-ask-drawer';
import { initialLessonTutorState } from '@/features/learning-session/lesson-tutor/reducer';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
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
    error: 'retryable' as const,
    messages: [{ id: 'user-1', role: 'user' as const, content: 'Why ee?' }],
  };
  const screen = await render(<LessonAskDrawer {...baseProps} state={state} />);

  expect(screen.getByText('Why ee?')).toBeTruthy();
  expect(
    screen.getByText(
      'The tutor didn’t return an answer. Retry safely checks the same request and won’t send it twice.',
    ),
  ).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Retry tutor message'));
  expect(baseProps.onRetry).toHaveBeenCalledTimes(1);
});

test('terminal ambiguity asks for a new question without offering retry', async () => {
  const state = {
    ...initialLessonTutorState('conversation-1'),
    error: 'terminal' as const,
    messages: [{ id: 'user-1', role: 'user' as const, content: 'Why ee?' }],
  };
  const screen = await render(<LessonAskDrawer {...baseProps} state={state} />);

  expect(screen.getByText('We couldn’t safely retry that turn. Ask again as a new question.')).toBeTruthy();
  expect(screen.queryByLabelText('Retry tutor message')).toBeNull();
});

test('missing Pro offers subscription plans instead of a retry loop', async () => {
  const state = {
    ...initialLessonTutorState('conversation-1'),
    error: 'requires-pro' as const,
    messages: [{ id: 'user-1', role: 'user' as const, content: 'Can you explain this?' }],
  };
  const screen = await render(<LessonAskDrawer {...baseProps} state={state} />);

  expect(screen.getByText('Lesson tutor assistance is included with GlideLingo Pro.')).toBeTruthy();
  expect(screen.queryByLabelText('Retry tutor message')).toBeNull();
  fireEvent.press(screen.getByLabelText('View Pro plans'));
  expect(mockPush).toHaveBeenCalledWith('/subscription');
});

test('billing dependency failure is distinct and remains safely retryable', async () => {
  const state = {
    ...initialLessonTutorState('conversation-1'),
    error: 'billing-unavailable' as const,
    messages: [{ id: 'user-1', role: 'user' as const, content: 'Can you explain this?' }],
  };
  const screen = await render(<LessonAskDrawer {...baseProps} state={state} />);

  expect(screen.getByText('We couldn’t verify Pro access right now. Your subscription has not changed.')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Retry tutor message'));
  expect(baseProps.onRetry).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('View Pro plans')).toBeNull();
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
