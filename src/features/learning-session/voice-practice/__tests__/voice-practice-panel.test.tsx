import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { expect, jest, test } from '@jest/globals';

import { VoicePracticePanel, type VoiceControllerFactory } from '../voice-practice-panel';
import { initialVoiceSessionState, type VoiceSessionState } from '@/features/speak/model/reducer';
import type { VoiceSessionAdmission, VoiceSessionEvent } from '@/features/speak/model/voice-session';

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('@/components/ui/glide-switch', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    GlideSwitch: ({
      accessibilityLabel,
      onValueChange,
      value,
    }: {
      accessibilityLabel: string;
      onValueChange: (next: boolean) => void;
      value: boolean;
    }) =>
      React.createElement(Pressable, {
        accessibilityLabel,
        accessibilityRole: 'switch',
        accessibilityState: { checked: value },
        onPress: () => onValueChange(!value),
      }),
  };
});

const ADMISSION: VoiceSessionAdmission = {
  session_id: '00000000-0000-4000-8000-000000000001',
  lifecycle: 'connecting',
  expires_at: '2026-09-04T12:05:00Z',
  spec: {
    course_id: 'el-from-zero',
    course_version: 'greek-foundations-v1',
    scenario_id: 'el-letters-1-voice-v1',
    scenario_version: '1.0.0',
    conversation_mode: 'guided',
    source_locale: 'en',
    target_locale: 'el-GR',
    persona_id: 'greek-sound-guide-v1',
    voice_id: 'configured-voice',
    learner_level: 'A0-A1',
    capability_ids: ['el-script-vowels-a-e-i'],
    correction_policy_version: 'gentle-pronunciation-recast-v1',
    evidence_policy_version: 'voice-practice-no-credit-v1',
    maximum_duration_seconds: 300,
  },
  connection: { type: 'openai-webrtc-sdp', answer_sdp: 'v=0\r\na=answer' },
};

const baseProps = {
  courseId: 'el-from-zero',
  lessonTitle: 'The sound of Greek',
  onClose: jest.fn(),
  scenarioId: 'el-letters-1-voice-v1',
  runtimeAvailability: 'available' as const,
};

function activeState(captionsEnabled: boolean, events: VoiceSessionEvent[] = []): VoiceSessionState {
  return {
    ...initialVoiceSessionState(captionsEnabled),
    lifecycle: 'active',
    events,
    lastSequence: events.at(-1)?.sequence ?? 0,
  };
}

function successfulFactory(events: VoiceSessionEvent[] = []) {
  const requests: unknown[] = [];
  const muted: boolean[] = [];
  const factory: VoiceControllerFactory = (onState, captionsEnabled) => {
    let state = initialVoiceSessionState(captionsEnabled);
    return {
      get snapshot() {
        return state;
      },
      async start(request) {
        requests.push(request);
        state = activeState(captionsEnabled, events);
        onState(state);
        return ADMISSION;
      },
      async reconnect() {},
      setMuted(value) {
        muted.push(value);
        state = { ...state, muted: value };
        onState(state);
      },
      async end() {
        state = { ...state, lifecycle: 'ended', muted: true };
        onState(state);
        return null;
      },
    };
  };
  return { factory, muted, requests };
}

test('keeps captions configurable before consent and exposes active and ended states', async () => {
  const voice = successfulFactory();
  const screen = await render(<VoicePracticePanel {...baseProps} controllerFactory={voice.factory} />);

  expect(screen.getByText('Your browser will ask before using the microphone.', { exact: false })).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Live captions'));
  await waitFor(() =>
    expect(screen.getByLabelText('Live captions').props.accessibilityState.checked).toBe(false),
  );
  fireEvent.press(screen.getByText('Start voice practice'));

  await waitFor(() => expect(screen.getByText('Connected. Your microphone starts muted.')).toBeTruthy());
  expect(voice.requests[0]).toMatchObject({
    course_id: 'el-from-zero',
    scenario_id: 'el-letters-1-voice-v1',
    captions_enabled: false,
    retain_transcript: false,
  });
  expect(screen.getByText('Captions off · Microphone muted')).toBeTruthy();

  fireEvent.press(screen.getByText('Start talking'));
  expect(voice.muted).toEqual([false]);
  await waitFor(() => expect(screen.getByText('Captions off · Listening')).toBeTruthy());

  fireEvent.press(screen.getByText('End voice practice'));
  await waitFor(() =>
    expect(screen.getByText('Voice practice ended. This did not change lesson progress.')).toBeTruthy(),
  );
  expect(screen.getByText('Practice again')).toBeTruthy();
  await screen.unmount();
});

test('shows bounded live captions with speaker labels', async () => {
  const events = Array.from({ length: 12 }, (_, index): VoiceSessionEvent => ({
    event_id: `caption_${String(index).padStart(2, '0')}`,
    session_id: ADMISSION.session_id,
    sequence: index + 1,
    occurred_at: `2026-09-04T12:00:${String(index).padStart(2, '0')}Z`,
    type: 'transcript.final',
    speaker: index % 2 === 0 ? 'learner' : 'coach',
    text: `line ${index}`,
  }));
  const voice = successfulFactory(events);
  const screen = await render(<VoicePracticePanel {...baseProps} controllerFactory={voice.factory} />);

  fireEvent.press(screen.getByText('Start voice practice'));
  await waitFor(() => expect(screen.getByText('Coach: line 11')).toBeTruthy());
  expect(screen.queryByText('You: line 0')).toBeNull();
  expect(screen.getByLabelText('Live voice captions')).toBeTruthy();
  await screen.unmount();
});

test('renders a retry after failure and creates a fresh controller for the retry', async () => {
  let attempts = 0;
  const cleanup = jest.fn(async () => null);
  const factory: VoiceControllerFactory = (onState, captionsEnabled) => {
    let state = initialVoiceSessionState(captionsEnabled);
    return {
      get snapshot() {
        return state;
      },
      async start() {
        attempts += 1;
        state = attempts === 1
          ? { ...state, lifecycle: 'failed', failureCode: 'start_failed' }
          : activeState(captionsEnabled);
        onState(state);
        return ADMISSION;
      },
      async reconnect() {},
      setMuted() {},
      end: cleanup,
    };
  };
  const screen = await render(<VoicePracticePanel {...baseProps} controllerFactory={factory} />);

  fireEvent.press(screen.getByText('Start voice practice'));
  await waitFor(() => expect(screen.getByText('Retry voice practice')).toBeTruthy());
  expect(
    screen.getByText('Voice practice could not continue. Your lesson progress is unchanged.'),
  ).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByText('Retry voice practice'));
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByText('Connected. Your microphone starts muted.')).toBeTruthy());
  expect(attempts).toBe(2);
  expect(cleanup).toHaveBeenCalledWith('failed');
  await screen.unmount();
});

test('offers a bounded reconnect action after connection loss', async () => {
  const reconnect = jest.fn(async () => undefined);
  const factory: VoiceControllerFactory = (onState, captionsEnabled) => {
    let state = initialVoiceSessionState(captionsEnabled);
    return {
      get snapshot() {
        return state;
      },
      async start() {
        state = { ...state, lifecycle: 'reconnecting', muted: true };
        onState(state);
        return ADMISSION;
      },
      async reconnect() {
        void reconnect();
        state = activeState(captionsEnabled);
        onState(state);
      },
      setMuted() {},
      async end() {
        return null;
      },
    };
  };
  const screen = await render(<VoicePracticePanel {...baseProps} controllerFactory={factory} />);

  fireEvent.press(screen.getByText('Start voice practice'));
  await waitFor(() => expect(screen.getByText('Retry connection')).toBeTruthy());
  fireEvent.press(screen.getByText('Retry connection'));
  await waitFor(() => expect(screen.getByText('Connected. Your microphone starts muted.')).toBeTruthy());
  expect(reconnect).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

test('desktop and native states never create a microphone controller', async () => {
  const controllerFactory = jest.fn() as unknown as VoiceControllerFactory;
  const desktop = await render(
    <VoicePracticePanel
      {...baseProps}
      controllerFactory={controllerFactory}
      runtimeAvailability="desktop-unavailable"
    />,
  );

  expect(desktop.getByText('Voice stays off on this platform.')).toBeTruthy();
  expect(desktop.getByText('desktop app yet', { exact: false })).toBeTruthy();
  expect(controllerFactory).not.toHaveBeenCalled();
  await desktop.unmount();

  const native = await render(
    <VoicePracticePanel
      {...baseProps}
      controllerFactory={controllerFactory}
      runtimeAvailability="native-unavailable"
    />,
  );
  expect(native.getByText('iOS or Android yet', { exact: false })).toBeTruthy();
  expect(controllerFactory).not.toHaveBeenCalled();
  await native.unmount();
});

test('unmount ends an active voice session without waiting on UI state', async () => {
  const end = jest.fn(async () => null);
  const factory: VoiceControllerFactory = (onState, captionsEnabled) => {
    let state = initialVoiceSessionState(captionsEnabled);
    return {
      get snapshot() {
        return state;
      },
      async start() {
        state = activeState(captionsEnabled);
        onState(state);
        return ADMISSION;
      },
      async reconnect() {},
      setMuted() {},
      end,
    };
  };
  const screen = await render(<VoicePracticePanel {...baseProps} controllerFactory={factory} />);
  fireEvent.press(screen.getByText('Start voice practice'));
  await waitFor(() => expect(screen.getByText('Connected. Your microphone starts muted.')).toBeTruthy());

  await screen.unmount();
  expect(end).toHaveBeenCalledWith('cancelled');
});
