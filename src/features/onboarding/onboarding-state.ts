export const ONBOARDING_VERSION = 1;

export const ONBOARDING_STEPS = ['welcome', 'goal', 'rhythm', 'plan', 'sample', 'result', 'paywall'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingGoal = 'travel' | 'family' | 'conversation' | 'foundation';
export type OnboardingRhythm = 'three' | 'five' | 'daily' | 'flexible';
export type OnboardingAccess = 'free' | 'pro';

export type OnboardingState = {
  version: typeof ONBOARDING_VERSION;
  completed: boolean;
  step: OnboardingStep;
  goal: OnboardingGoal | null;
  rhythm: OnboardingRhythm | null;
  sampleCompleted: boolean;
  access: OnboardingAccess | null;
};

const goals = new Set<OnboardingGoal>(['travel', 'family', 'conversation', 'foundation']);
const rhythms = new Set<OnboardingRhythm>(['three', 'five', 'daily', 'flexible']);
const steps = new Set<OnboardingStep>(ONBOARDING_STEPS);

export function createOnboardingState(): OnboardingState {
  return {
    version: ONBOARDING_VERSION,
    completed: false,
    step: 'welcome',
    goal: null,
    rhythm: null,
    sampleCompleted: false,
    access: null,
  };
}

export function parseOnboardingState(raw: string | null): OnboardingState {
  if (!raw) return createOnboardingState();

  try {
    const value = JSON.parse(raw) as Partial<OnboardingState>;
    if (value.version !== ONBOARDING_VERSION) return createOnboardingState();

    const goal = value.goal && goals.has(value.goal) ? value.goal : null;
    const rhythm = value.rhythm && rhythms.has(value.rhythm) ? value.rhythm : null;
    const access = value.access === 'free' || value.access === 'pro' ? value.access : null;
    const completed = value.completed === true && access !== null;

    return {
      version: ONBOARDING_VERSION,
      completed,
      step: value.step && steps.has(value.step) ? value.step : 'welcome',
      goal,
      rhythm,
      sampleCompleted: value.sampleCompleted === true,
      access: completed ? access : null,
    };
  } catch {
    return createOnboardingState();
  }
}

export function onboardingStorageKey(storageScope: string) {
  const safeScope = storageScope.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeScope) throw new Error('Onboarding storage requires an authenticated user scope.');
  return `glidelingo.onboarding.${safeScope}`;
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  return index > 0 ? ONBOARDING_STEPS[index - 1] : null;
}

export function onboardingProgress(step: OnboardingStep) {
  const index = ONBOARDING_STEPS.indexOf(step);
  return Math.max(0, index) / (ONBOARDING_STEPS.length - 1);
}
