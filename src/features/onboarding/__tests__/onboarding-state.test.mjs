import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOnboardingState,
  onboardingProgress,
  onboardingStorageKey,
  parseOnboardingState,
  previousOnboardingStep,
  weeklyPracticeGoalForRhythm,
} from '../onboarding-state.ts';

test('creates a truthful incomplete onboarding state', () => {
  assert.deepEqual(createOnboardingState(), {
    version: 1,
    completed: false,
    step: 'welcome',
    goal: null,
    rhythm: null,
    sampleCompleted: false,
    access: null,
  });
});

test('restores a valid completed state', () => {
  const restored = parseOnboardingState(
    JSON.stringify({
      version: 1,
      completed: true,
      step: 'paywall',
      goal: 'travel',
      rhythm: 'three',
      sampleCompleted: true,
      access: 'pro',
    }),
  );

  assert.equal(restored.completed, true);
  assert.equal(restored.goal, 'travel');
  assert.equal(restored.access, 'pro');
});

test('does not restore completion without an explicit access choice', () => {
  const restored = parseOnboardingState(JSON.stringify({ version: 1, completed: true, step: 'paywall' }));
  assert.equal(restored.completed, false);
  assert.equal(restored.access, null);
});

test('rejects malformed, unknown-version, and invalid option state', () => {
  assert.deepEqual(parseOnboardingState('not-json'), createOnboardingState());
  assert.deepEqual(parseOnboardingState(JSON.stringify({ version: 999, completed: true })), createOnboardingState());

  const restored = parseOnboardingState(
    JSON.stringify({ version: 1, step: 'unknown', goal: 'unknown', rhythm: 'unknown' }),
  );
  assert.equal(restored.step, 'welcome');
  assert.equal(restored.goal, null);
  assert.equal(restored.rhythm, null);
});

test('scopes storage to a sanitized authenticated user ID', () => {
  assert.equal(onboardingStorageKey('user_123'), 'glidelingo.onboarding.user_123');
  assert.equal(onboardingStorageKey(' user:abc '), 'glidelingo.onboarding.user_abc');
  assert.throws(() => onboardingStorageKey('   '), /authenticated user scope/);
});

test('models bounded back navigation and progress', () => {
  assert.equal(previousOnboardingStep('welcome'), null);
  assert.equal(previousOnboardingStep('plan'), 'rhythm');
  assert.equal(onboardingProgress('welcome'), 0);
  assert.equal(onboardingProgress('paywall'), 1);
});

test('maps every onboarding rhythm to the durable weekly target contract', () => {
  assert.equal(weeklyPracticeGoalForRhythm('three'), 3);
  assert.equal(weeklyPracticeGoalForRhythm('five'), 5);
  assert.equal(weeklyPracticeGoalForRhythm('daily'), 7);
  assert.equal(weeklyPracticeGoalForRhythm('flexible'), null);
});
