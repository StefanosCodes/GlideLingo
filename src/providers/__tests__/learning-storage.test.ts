import { describe, expect, it, jest } from '@jest/globals';

import {
  emptyStoredLearning,
  getLearningStorage,
  learningStorageKey,
  parseStoredLearning,
  readStoredLearning,
  withLearningStorageLock,
  writeStoredLearning,
} from '@/providers/learning-storage';

const now = new Date(2026, 7, 31, 12);

describe('learning storage', () => {
  it('migrates the previous weekly goal into the current week without backfilling history', () => {
    const value = parseStoredLearning(
      JSON.stringify({
        languageId: 'el',
        enrolledByLanguage: { el: 'greek-foundations' },
        completedLessonIds: ['lesson-1'],
        lessonEvidence: [],
        practiceDayKeys: ['2026-08-24', '2026-08-31'],
        weeklyPracticeGoal: 3,
      }),
      now,
    );

    expect(value.version).toBe(2);
    expect(value.weeklyGoalChanges).toEqual([{ effectiveWeekKey: '2026-08-31', goal: 3 }]);
    expect(value.practiceDayKeys).toEqual(['2026-08-24', '2026-08-31']);
  });

  it('filters malformed v2 fields and deduplicates practice days', () => {
    const value = parseStoredLearning(
      JSON.stringify({
        version: 2,
        languageId: 'unknown',
        enrolledByLanguage: { el: 'greek-foundations', es: 42 },
        completedLessonIds: ['lesson-1', 42, 'lesson-1'],
        lessonEvidence: [true],
        practiceDayKeys: ['2026-08-31', '2026-08-31', 'not-a-date'],
        weeklyGoalChanges: [
          { effectiveWeekKey: '2026-08-31', goal: 2 },
          { effectiveWeekKey: '2026-09-01', goal: 5 },
        ],
      }),
      now,
    );

    expect(value.languageId).toBe('el');
    expect(value.enrolledByLanguage).toEqual({ el: 'greek-foundations' });
    expect(value.completedLessonIds).toEqual(['lesson-1']);
    expect(value.lessonEvidence).toEqual([]);
    expect(value.practiceDayKeys).toEqual(['2026-08-31']);
    expect(value.weeklyGoalChanges).toEqual([{ effectiveWeekKey: '2026-08-31', goal: 2 }]);
  });

  it('distinguishes missing, corrupt, and failed reads', () => {
    const missing = readStoredLearning('scoped', {
      getItem: jest.fn(() => null),
      removeItem: jest.fn(),
      setItem: jest.fn(),
    });
    const corrupt = readStoredLearning('scoped', {
      getItem: jest.fn(() => '{'),
      removeItem: jest.fn(),
      setItem: jest.fn(),
    });
    const failed = readStoredLearning('scoped', {
      getItem: () => {
        throw new Error('unavailable');
      },
      removeItem: jest.fn(),
      setItem: jest.fn(),
    });

    expect(missing.kind).toBe('missing');
    expect(corrupt.kind).toBe('corrupt');
    expect(failed.kind).toBe('read-error');
    expect(failed.value).toEqual(emptyStoredLearning());
  });

  it('guards localStorage acquisition when the host getter throws', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      expect(getLearningStorage()).toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('writes a versioned account-scoped payload and reports write failures', () => {
    const setItem = jest.fn();
    const key = learningStorageKey('user-a');
    expect(
      writeStoredLearning(key, emptyStoredLearning(), {
        getItem: jest.fn(() => null),
        removeItem: jest.fn(),
        setItem,
      }),
    ).toBe(true);
    expect(setItem).toHaveBeenCalledWith(key, JSON.stringify(emptyStoredLearning()));

    expect(
      writeStoredLearning(key, emptyStoredLearning(), {
        getItem: jest.fn(() => null),
        removeItem: jest.fn(),
        setItem: () => {
          throw new Error('full');
        },
      }),
    ).toBe(false);
  });

  it('fails closed when browser-safe cross-tab locking is required but unavailable', async () => {
    const work = jest.fn(() => 'unsafe-write');

    await expect(
      withLearningStorageLock('scoped', work, {
        lockManager: null,
        requireBrowserLock: true,
      }),
    ).rejects.toThrow('Cross-tab learning storage locking is unavailable');
    expect(work).not.toHaveBeenCalled();
  });

  it('serializes read-merge-write work for the same account key', async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = withLearningStorageLock('same-account', async () => {
      order.push('first-start');
      markFirstStarted?.();
      await firstGate;
      order.push('first-end');
    });
    const second = withLearningStorageLock('same-account', () => {
      order.push('second');
    });

    await firstStarted;
    expect(order).toEqual(['first-start']);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });
});
