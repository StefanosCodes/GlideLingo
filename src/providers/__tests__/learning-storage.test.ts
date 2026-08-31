import { describe, expect, it, jest } from '@jest/globals';

import {
  emptyStoredLearning,
  LEARNING_STORAGE_KEY,
  parseStoredLearning,
  readStoredLearning,
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

  it('filters malformed v2 data and deduplicates practice days', () => {
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

  it('falls back safely when stored JSON or storage access fails', () => {
    expect(parseStoredLearning('{')).toEqual(emptyStoredLearning());

    const unavailable = readStoredLearning({
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: jest.fn(),
    });
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.value).toEqual(emptyStoredLearning());
  });

  it('writes a versioned payload and reports write failures', () => {
    const setItem = jest.fn();
    expect(writeStoredLearning(emptyStoredLearning(), { getItem: jest.fn(() => null), setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledWith(LEARNING_STORAGE_KEY, JSON.stringify(emptyStoredLearning()));

    expect(
      writeStoredLearning(emptyStoredLearning(), {
        getItem: jest.fn(() => null),
        setItem: () => {
          throw new Error('full');
        },
      }),
    ).toBe(false);
  });
});
