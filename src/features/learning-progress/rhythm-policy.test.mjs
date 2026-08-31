import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addLocalDays,
  calendarGridForMonth,
  goalForWeek,
  isWeeklyGoalChange,
  localWeekKey,
  normalizeGoalChanges,
  normalizePracticeDayKeys,
  recordMeaningfulPractice,
  setGoalForCurrentWeek,
  summarizeRhythm,
} from './rhythm-policy.ts';

const monday = new Date(2026, 7, 31, 12);

test('local weeks start on Monday across month and year boundaries', () => {
  assert.equal(localWeekKey(new Date(2026, 7, 31, 8)), '2026-08-31');
  assert.equal(localWeekKey(new Date(2026, 8, 6, 20)), '2026-08-31');
  assert.equal(localWeekKey(new Date(2027, 0, 1, 12)), '2026-12-28');
});

test('local day arithmetic crosses leap days and daylight-saving boundaries', () => {
  assert.equal(addLocalDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addLocalDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addLocalDays('2026-03-08', 1), '2026-03-09');
});

test('practice dates are validated, deduplicated, and sorted', () => {
  assert.deepEqual(normalizePracticeDayKeys(['2026-09-02', 'bad', '2026-08-31', '2026-09-02']), [
    '2026-08-31',
    '2026-09-02',
  ]);
});

test('goal changes apply immediately without rewriting earlier weeks', () => {
  const original = [{ effectiveWeekKey: '2026-08-24', goal: 5 }];
  const changed = setGoalForCurrentWeek(original, 2, monday);

  assert.equal(goalForWeek(changed, '2026-08-24'), 5);
  assert.equal(goalForWeek(changed, '2026-08-31'), 2);
  assert.equal(goalForWeek(changed, '2026-09-07'), 2);
});

test('normalization rejects malformed changes and keeps the last change for a week', () => {
  const changes = normalizeGoalChanges([
    { effectiveWeekKey: '2026-08-31', goal: 3 },
    { effectiveWeekKey: '2026-08-31', goal: 5 },
    { effectiveWeekKey: '2026-09-01', goal: 2 },
  ]);

  assert.deepEqual(changes, [{ effectiveWeekKey: '2026-08-31', goal: 5 }]);
  assert.equal(isWeeklyGoalChange({ effectiveWeekKey: '2026-09-01', goal: 2 }), false);
});

test('an unfinished current week preserves the streak from completed weeks', () => {
  const changes = [{ effectiveWeekKey: '2026-08-17', goal: 2 }];
  const days = ['2026-08-17', '2026-08-19', '2026-08-24', '2026-08-26', '2026-08-31'];
  const summary = summarizeRhythm(days, changes, monday);

  assert.equal(summary.currentWeekMet, false);
  assert.equal(summary.currentStreakWeeks, 2);
  assert.equal(summary.bestStreakWeeks, 2);
  assert.equal(summary.practiceDaysThisWeek, 1);
});

test('meeting the current goal extends the streak and identifies milestones', () => {
  const changes = [{ effectiveWeekKey: '2026-08-10', goal: 2 }];
  const existing = [
    '2026-08-10',
    '2026-08-12',
    '2026-08-17',
    '2026-08-19',
    '2026-08-24',
    '2026-08-26',
    '2026-08-31',
  ];
  const completion = recordMeaningfulPractice(existing, changes, new Date(2026, 8, 2, 12));

  assert.equal(completion.result.weeklyGoalReachedNow, true);
  assert.equal(completion.result.summary.currentStreakWeeks, 4);
  assert.equal(completion.result.milestone, 4);
});

test('same-day repeats do not add practice or repeat a celebration', () => {
  const changes = [{ effectiveWeekKey: '2026-08-31', goal: 2 }];
  const first = recordMeaningfulPractice(['2026-08-31'], changes, new Date(2026, 8, 2, 12));
  const repeat = recordMeaningfulPractice(first.practiceDayKeys, changes, new Date(2026, 8, 2, 19));

  assert.equal(first.result.weeklyGoalReachedNow, true);
  assert.equal(repeat.result.dayWasNew, false);
  assert.equal(repeat.result.weeklyGoalReachedNow, false);
  assert.equal(repeat.practiceDayKeys.length, 2);
});

test('a missed finished week breaks the current streak but preserves the best', () => {
  const changes = [{ effectiveWeekKey: '2026-08-10', goal: 2 }];
  const days = ['2026-08-10', '2026-08-12', '2026-08-17', '2026-08-19', '2026-08-31'];
  const summary = summarizeRhythm(days, changes, monday);

  assert.equal(summary.currentStreakWeeks, 0);
  assert.equal(summary.bestStreakWeeks, 2);
  assert.equal(summary.hasLapsed, true);
});

test('disabling a goal creates a boundary without removing the best streak', () => {
  const changes = [
    { effectiveWeekKey: '2026-08-17', goal: 2 },
    { effectiveWeekKey: '2026-08-31', goal: null },
  ];
  const days = ['2026-08-17', '2026-08-19', '2026-08-24', '2026-08-26', '2026-08-31'];
  const summary = summarizeRhythm(days, changes, monday);

  assert.equal(summary.activeGoal, null);
  assert.equal(summary.currentStreakWeeks, 0);
  assert.equal(summary.bestStreakWeeks, 2);
});

test('practice before the first goal stays visible but cannot backfill a streak', () => {
  const changes = [{ effectiveWeekKey: '2026-08-31', goal: 2 }];
  const days = ['2026-08-17', '2026-08-19', '2026-08-31', '2026-09-02'];
  const summary = summarizeRhythm(days, changes, monday);

  assert.equal(summary.totalPracticeDays, 4);
  assert.equal(summary.currentStreakWeeks, 1);
  assert.equal(summary.bestStreakWeeks, 1);
});

test('calendar grids are Monday-first and include practiced and future states', () => {
  const grid = calendarGridForMonth(new Date(2026, 8, 1), ['2026-08-31', '2026-09-02'], monday);

  assert.equal(grid.length, 42);
  assert.equal(grid[0].dayKey, '2026-08-31');
  assert.equal(grid[0].inMonth, false);
  assert.equal(grid[0].practiced, true);
  assert.equal(grid[2].dayKey, '2026-09-02');
  assert.equal(grid[2].future, true);
});
