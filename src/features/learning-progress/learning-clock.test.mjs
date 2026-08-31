import assert from 'node:assert/strict';
import test from 'node:test';

import { nextLearningRefreshAt, nextLocalMidnight } from './learning-clock-policy.ts';

test('the clock refreshes at the next local midnight across spring DST', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const now = new Date(2026, 2, 8, 0, 0, 0);
    assert.equal(nextLocalMidnight(now) - now.getTime(), 23 * 60 * 60 * 1_000);
  } finally {
    process.env.TZ = previousTimezone;
  }
});

test('the clock refreshes at the next local midnight across fall DST', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const now = new Date(2026, 10, 1, 0, 0, 0);
    assert.equal(nextLocalMidnight(now) - now.getTime(), 25 * 60 * 60 * 1_000);
  } finally {
    process.env.TZ = previousTimezone;
  }
});

test('an earlier review due time wins over midnight', () => {
  const now = new Date(2026, 7, 31, 12).getTime();
  const dueAt = now + 30_000;
  const record = {
    lessonId: 'lesson-1',
    capability: { id: 'capability-1', canDo: 'I can read it.', mode: 'reading' },
    state: 'demonstrated',
    evidenceAt: dueAt - 24 * 60 * 60 * 1_000,
    lastPracticedAt: dueAt - 24 * 60 * 60 * 1_000,
    lastMode: 'learn',
    lastCheckpoint: 'first-try',
    introducedModes: ['reading'],
    checkCount: 1,
    firstTryCorrectCount: 1,
    recoveredCheckCount: 0,
    completionCount: 1,
  };

  assert.equal(nextLearningRefreshAt([record], now), dueAt);
});

test('the next boundary follows the current timezone after a timezone change', () => {
  const previousTimezone = process.env.TZ;
  const now = Date.UTC(2026, 7, 31, 20);
  try {
    process.env.TZ = 'UTC';
    const utcMidnight = nextLocalMidnight(now);
    process.env.TZ = 'America/Los_Angeles';
    const losAngelesMidnight = nextLocalMidnight(now);
    assert.notEqual(losAngelesMidnight, utcMidnight);
  } finally {
    process.env.TZ = previousTimezone;
  }
});
