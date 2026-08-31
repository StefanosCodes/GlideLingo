import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { LearningProvider, useLearning } from '@/providers/learning-provider';
import { LEGACY_IMPORT_OWNER_KEY, learningStorageKey } from '@/providers/learning-storage';

const storage = new Map<string, string>();
let getItem: jest.MockedFunction<(key: string) => string | null>;
let setItem: jest.MockedFunction<(key: string, value: string) => void>;
const storageListeners = new Set<(event: StorageEvent) => void>();
const legacyImporters = new Map<string, () => void>();
const failingSetKeys = new Set<string>();

beforeEach(() => {
  storage.clear();
  getItem = jest.fn((key: string) => storage.get(key) ?? null);
  setItem = jest.fn((key: string, value: string) => {
    if (failingSetKeys.has(key)) throw new Error(`setItem failed for ${key}`);
    storage.set(key, value);
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem, removeItem: jest.fn((key: string) => storage.delete(key)), setItem },
  });
  storageListeners.clear();
  legacyImporters.clear();
  failingSetKeys.clear();
  Object.defineProperties(window, {
    addEventListener: {
      configurable: true,
      value: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === 'storage') storageListeners.add(listener);
      },
    },
    removeEventListener: {
      configurable: true,
      value: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === 'storage') storageListeners.delete(listener);
      },
    },
  });
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 31, 12));
});

afterEach(() => {
  jest.useRealTimers();
});

function completion(correctOnFirstTry = true) {
  return {
    lessonId: 'el-letters-1',
    mode: 'learn' as const,
    capability: {
      id: 'el-script-vowels-a-e-i',
      canDo: 'I can recognize Greek vowels.',
      mode: 'reading' as const,
    },
    introducedModes: ['reading' as const],
    checks: [
      {
        beatIndex: 1,
        capabilityId: 'el-script-vowels-a-e-i',
        level: 'checkpoint' as const,
        attempts: correctOnFirstTry ? 1 : 2,
        correct: true,
        correctOnFirstTry,
      },
    ],
  };
}

function Probe() {
  const { completeLesson, legacyProgressAvailable, rhythmSummary, setWeeklyPracticeGoal } = useLearning();
  return (
    <>
      <Text testID="days">{rhythmSummary.practiceDaysThisWeek}</Text>
      <Text testID="legacy">{legacyProgressAvailable ? 'available' : 'hidden'}</Text>
      <Pressable accessibilityLabel="Set two-day rhythm" onPress={() => setWeeklyPracticeGoal(2)} />
      <Pressable accessibilityLabel="Complete lesson" onPress={() => completeLesson(completion())} />
    </>
  );
}

test('provider records at most one meaningful day per local date in the scoped V2 store', async () => {
  const screen = await render(
    <LearningProvider storageScope="user-a">
      <Probe />
    </LearningProvider>,
  );

  await fireEvent.press(screen.getByLabelText('Set two-day rhythm'));
  await fireEvent.press(screen.getByLabelText('Complete lesson'));
  await fireEvent.press(screen.getByLabelText('Complete lesson'));

  expect(screen.getByTestId('days').props.children).toBe(1);
  await waitFor(() => expect(storage.get(learningStorageKey('user-a'))).toContain('2026-08-31'));
});

test('account switching never hydrates one account from another account scope', async () => {
  storage.set(
    learningStorageKey('user-a'),
    JSON.stringify({
      version: 2,
      languageId: 'el',
      enrolledByLanguage: {},
      completedLessonIds: [],
      lessonEvidence: [],
      practiceDayKeys: ['2026-08-31'],
      weeklyGoalChanges: [{ effectiveWeekKey: '2026-08-31', goal: 2 }],
    }),
  );

  const accountA = await render(
    <LearningProvider key="user-a" storageScope="user-a">
      <Probe />
    </LearningProvider>,
  );
  expect(accountA.getByTestId('days').props.children).toBe(1);
  await accountA.unmount();

  const accountB = await render(
    <LearningProvider key="user-b" storageScope="user-b">
      <Probe />
    </LearningProvider>,
  );
  expect(accountB.getByTestId('days').props.children).toBe(0);
  expect(storage.get(learningStorageKey('user-a'))).toContain('2026-08-31');
  expect(storage.get(learningStorageKey('user-b')) ?? '').not.toContain('2026-08-31');
});

test('corrupt account storage is not replaced by an empty autosave', async () => {
  const key = learningStorageKey('user-a');
  storage.set(key, '{');

  await render(
    <LearningProvider storageScope="user-a">
      <Probe />
    </LearningProvider>,
  );

  expect(storage.get(key)).toBe('{');
  expect(setItem).not.toHaveBeenCalledWith(key, expect.any(String));
});

test('an incomplete imported-source cleanup remains retryable after restart', async () => {
  storage.set('glidelingo-learning:legacy-decision:user-a', 'imported');
  storage.set(
    'glidelingo-learning',
    JSON.stringify({
      version: 2,
      languageId: 'el',
      enrolledByLanguage: {},
      completedLessonIds: ['lesson-1'],
      lessonEvidence: [],
      practiceDayKeys: [],
      weeklyGoalChanges: [],
    }),
  );

  const screen = await render(
    <LearningProvider storageScope="user-a">
      <Probe />
    </LearningProvider>,
  );

  expect(screen.getByTestId('legacy').props.children).toBe('available');
});

function ImportProbe({ account }: { account: string }) {
  const { importLegacyProgress, legacyProgressAvailable, legacyProgressError } = useLearning();
  legacyImporters.set(account, importLegacyProgress);
  return (
    <>
      <Text testID={`${account}-legacy`}>{legacyProgressAvailable ? 'available' : 'hidden'}</Text>
      <Text testID={`${account}-error`}>{legacyProgressError ?? ''}</Text>
      <Pressable accessibilityLabel={`${account} import legacy`} onPress={importLegacyProgress} />
    </>
  );
}

function seedLegacyProgress() {
  storage.set(
    'glidelingo-learning',
    JSON.stringify({
      version: 2,
      languageId: 'el',
      enrolledByLanguage: {},
      completedLessonIds: ['legacy-lesson'],
      lessonEvidence: [],
      practiceDayKeys: ['2026-08-31'],
      weeklyGoalChanges: [],
      fieldWrites: {},
    }),
  );
}

test('concurrent accounts serialize the shared legacy source so at most one destination imports it', async () => {
  seedLegacyProgress();
  const screen = await render(
    <>
      <LearningProvider storageScope="account-a">
        <ImportProbe account="account-a" />
      </LearningProvider>
      <LearningProvider storageScope="account-b">
        <ImportProbe account="account-b" />
      </LearningProvider>
    </>,
  );

  await act(async () => {
    legacyImporters.get('account-a')?.();
    legacyImporters.get('account-b')?.();
    await Promise.resolve();
  });

  await waitFor(() =>
    expect(['account-a', 'account-b'].filter((account) => storage.has(learningStorageKey(account)))).toHaveLength(1),
  );
  const destinations = ['account-a', 'account-b'].filter((account) => storage.has(learningStorageKey(account)));
  const winner = destinations[0];
  const loser = winner === 'account-a' ? 'account-b' : 'account-a';
  expect(JSON.parse(storage.get(learningStorageKey(winner)) ?? '{}').completedLessonIds).toContain('legacy-lesson');
  expect(storage.has(learningStorageKey(loser))).toBe(false);
  expect(storage.has('glidelingo-learning')).toBe(false);
  await waitFor(() =>
    expect(screen.getByTestId(`${loser}-error`).props.children).toBe(
      'The earlier progress is no longer available.',
    ),
  );
  expect(screen.getByTestId(`${winner}-legacy`).props.children).toBe('hidden');
});

test('a failed shared owner claim creates no destination and leaves the source available', async () => {
  seedLegacyProgress();
  const screen = await render(
    <LearningProvider storageScope="account-a">
      <ImportProbe account="account-a" />
    </LearningProvider>,
  );
  failingSetKeys.add(LEGACY_IMPORT_OWNER_KEY);

  await act(async () => {
    legacyImporters.get('account-a')?.();
    await Promise.resolve();
  });

  await waitFor(() =>
    expect(screen.getByTestId('account-a-error').props.children).toBe(
      'Progress could not be saved on this device. The earlier progress is still available.',
    ),
  );
  expect(storage.has(learningStorageKey('account-a'))).toBe(false);
  expect(storage.has(LEGACY_IMPORT_OWNER_KEY)).toBe(false);
  expect(storage.has('glidelingo-learning')).toBe(true);
  expect(screen.getByTestId('account-a-legacy').props.children).toBe('available');
});

test('a destination failure retains the owner claim, blocks other accounts, and permits owner retry', async () => {
  seedLegacyProgress();
  const screen = await render(
    <>
      <LearningProvider storageScope="account-a">
        <ImportProbe account="account-a" />
      </LearningProvider>
      <LearningProvider storageScope="account-b">
        <ImportProbe account="account-b" />
      </LearningProvider>
    </>,
  );
  const accountAKey = learningStorageKey('account-a');
  const accountBKey = learningStorageKey('account-b');
  failingSetKeys.add(accountAKey);

  await act(async () => {
    legacyImporters.get('account-a')?.();
    await Promise.resolve();
  });
  await waitFor(() => expect(storage.get(LEGACY_IMPORT_OWNER_KEY)).toBe('account-a'));
  expect(storage.has(accountAKey)).toBe(false);
  expect(storage.has('glidelingo-learning')).toBe(true);

  await act(async () => {
    legacyImporters.get('account-b')?.();
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(screen.getByTestId('account-b-error').props.children).toBe(
      'The earlier progress is no longer available.',
    ),
  );
  expect(storage.has(accountBKey)).toBe(false);

  failingSetKeys.delete(accountAKey);
  await act(async () => {
    legacyImporters.get('account-a')?.();
    await Promise.resolve();
  });
  await waitFor(() => expect(storage.has(accountAKey)).toBe(true));
  expect(JSON.parse(storage.get(accountAKey) ?? '{}').completedLessonIds).toContain('legacy-lesson');
  expect(storage.has('glidelingo-learning')).toBe(false);
  expect(storage.has(LEGACY_IMPORT_OWNER_KEY)).toBe(false);
  expect(screen.getByTestId('account-a-legacy').props.children).toBe('hidden');
});

test('completion returns the actual merged evidence after a weaker replay', async () => {
  let replayState = '';
  function ResultProbe() {
    const { completeLesson } = useLearning();
    return (
      <>
        <Pressable accessibilityLabel="Demonstrate" onPress={() => completeLesson(completion(true))} />
        <Pressable
          accessibilityLabel="Replay with recovery"
          onPress={() => {
            replayState = completeLesson(completion(false)).evidence.state;
          }}
        />
      </>
    );
  }
  const screen = await render(
    <LearningProvider storageScope="user-a">
      <ResultProbe />
    </LearningProvider>,
  );
  await fireEvent.press(screen.getByLabelText('Demonstrate'));
  await fireEvent.press(screen.getByLabelText('Replay with recovery'));

  expect(replayState).toBe('demonstrated');
});

function TabProbe({ tab }: { tab: string }) {
  const { completeLesson, languageId, setLanguage } = useLearning();
  return (
    <>
      <Text testID={`${tab}-language`}>{languageId}</Text>
      <Pressable accessibilityLabel={`${tab} complete lesson`} onPress={() => completeLesson(completion())} />
      <Pressable accessibilityLabel={`${tab} choose Spanish`} onPress={() => setLanguage('es')} />
    </>
  );
}

test('a stale second provider cannot erase another tab lesson evidence or practice with a later scalar update', async () => {
  const screen = await render(
    <>
      <LearningProvider storageScope="shared-user">
        <TabProbe tab="tab-a" />
      </LearningProvider>
      <LearningProvider storageScope="shared-user">
        <TabProbe tab="tab-b" />
      </LearningProvider>
    </>,
  );
  const key = learningStorageKey('shared-user');

  await fireEvent.press(screen.getByLabelText('tab-a complete lesson'));
  await waitFor(() => {
    const durable = JSON.parse(storage.get(key) ?? '{}');
    expect(durable.completedLessonIds).toEqual(['el-letters-1']);
    expect(durable.lessonEvidence).toHaveLength(1);
    expect(durable.practiceDayKeys).toEqual(['2026-08-31']);
  });

  await fireEvent.press(screen.getByLabelText('tab-b choose Spanish'));
  await waitFor(() => {
    const durable = JSON.parse(storage.get(key) ?? '{}');
    expect(durable.languageId).toBe('es');
    expect(durable.completedLessonIds).toEqual(['el-letters-1']);
    expect(durable.lessonEvidence).toHaveLength(1);
    expect(durable.practiceDayKeys).toEqual(['2026-08-31']);
  });

  const event = { key, newValue: storage.get(key) } as StorageEvent;
  await act(async () => {
    for (const listener of storageListeners) listener(event);
  });
  await waitFor(() => expect(screen.getByTestId('tab-a-language').props.children).toBe('es'));
});
