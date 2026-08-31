export type WeeklyPracticeGoal = 2 | 3 | 5;

export type WeeklyGoalChange = {
  effectiveWeekKey: string;
  goal: WeeklyPracticeGoal | null;
};

export type RhythmMilestone = 1 | 4 | 12 | 52;

export type RhythmSummary = {
  currentWeekKey: string;
  activeGoal: WeeklyPracticeGoal | null;
  practiceDaysThisWeek: number;
  daysRemaining: number;
  currentWeekMet: boolean;
  currentStreakWeeks: number;
  bestStreakWeeks: number;
  totalPracticeDays: number;
  hasLapsed: boolean;
};

export type PracticeCompletionResult = {
  dayWasNew: boolean;
  weeklyGoalReachedNow: boolean;
  milestone: RhythmMilestone | null;
  summary: RhythmSummary;
};

export type CalendarDayCell = {
  dayKey: string;
  dayNumber: number;
  inMonth: boolean;
  practiced: boolean;
  today: boolean;
  future: boolean;
};

const MILESTONES = new Set<RhythmMilestone>([1, 4, 12, 52]);

export function localDayKey(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateAtNoon(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function dateFromDayKey(dayKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return localDayKey(date) === dayKey ? date : null;
}

export function isLocalDayKey(value: unknown): value is string {
  return typeof value === 'string' && dateFromDayKey(value) !== null;
}

export function addLocalDays(dayKey: string, amount: number) {
  const date = dateFromDayKey(dayKey);
  if (!date) throw new Error(`Invalid local day key: ${dayKey}`);
  date.setDate(date.getDate() + amount);
  return localDayKey(date);
}

export function localWeekKey(value: Date | number) {
  const monday = dateAtNoon(value);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return localDayKey(monday);
}

export function weekKeyForDayKey(dayKey: string) {
  const date = dateFromDayKey(dayKey);
  if (!date) throw new Error(`Invalid local day key: ${dayKey}`);
  return localWeekKey(date);
}

export function isWeeklyGoalChange(value: unknown): value is WeeklyGoalChange {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WeeklyGoalChange>;
  return (
    isLocalDayKey(candidate.effectiveWeekKey) &&
    candidate.effectiveWeekKey === weekKeyForDayKey(candidate.effectiveWeekKey) &&
    (candidate.goal === null || candidate.goal === 2 || candidate.goal === 3 || candidate.goal === 5)
  );
}

export function normalizeGoalChanges(changes: WeeklyGoalChange[]) {
  const byWeek = new Map<string, WeeklyGoalChange>();
  for (const change of changes) {
    if (isWeeklyGoalChange(change)) byWeek.set(change.effectiveWeekKey, change);
  }
  return [...byWeek.values()].sort((left, right) => left.effectiveWeekKey.localeCompare(right.effectiveWeekKey));
}

export function goalForWeek(changes: WeeklyGoalChange[], weekKey: string) {
  let goal: WeeklyPracticeGoal | null = null;
  let found = false;
  for (const change of normalizeGoalChanges(changes)) {
    if (change.effectiveWeekKey > weekKey) break;
    goal = change.goal;
    found = true;
  }
  return found ? goal : null;
}

export function setGoalForCurrentWeek(
  changes: WeeklyGoalChange[],
  goal: WeeklyPracticeGoal | null,
  now: Date | number = new Date(),
) {
  const effectiveWeekKey = localWeekKey(now);
  return normalizeGoalChanges([
    ...changes.filter((change) => change.effectiveWeekKey !== effectiveWeekKey),
    { effectiveWeekKey, goal },
  ]);
}

export function normalizePracticeDayKeys(dayKeys: string[]) {
  return [...new Set(dayKeys.filter(isLocalDayKey))].sort();
}

export function practiceDaysForWeek(dayKeys: string[], weekKey: string) {
  const weekEnd = addLocalDays(weekKey, 6);
  return normalizePracticeDayKeys(dayKeys).filter((dayKey) => dayKey >= weekKey && dayKey <= weekEnd).length;
}

function weekMet(dayKeys: string[], changes: WeeklyGoalChange[], weekKey: string) {
  const goal = goalForWeek(changes, weekKey);
  return Boolean(goal && practiceDaysForWeek(dayKeys, weekKey) >= goal);
}

export function summarizeRhythm(
  dayKeys: string[],
  changes: WeeklyGoalChange[],
  now: Date | number = new Date(),
): RhythmSummary {
  const practiceDays = normalizePracticeDayKeys(dayKeys);
  const goalChanges = normalizeGoalChanges(changes);
  const currentWeekKey = localWeekKey(now);
  const activeGoal = goalForWeek(goalChanges, currentWeekKey);
  const practiceDaysThisWeek = practiceDaysForWeek(practiceDays, currentWeekKey);
  const currentWeekMet = Boolean(activeGoal && practiceDaysThisWeek >= activeGoal);

  let currentStreakWeeks = 0;
  if (activeGoal) {
    let cursor = currentWeekMet ? currentWeekKey : addLocalDays(currentWeekKey, -7);
    while (goalForWeek(goalChanges, cursor) && weekMet(practiceDays, goalChanges, cursor)) {
      currentStreakWeeks += 1;
      cursor = addLocalDays(cursor, -7);
    }
  }

  let bestStreakWeeks = 0;
  let runningStreak = 0;
  const firstGoalWeek = goalChanges[0]?.effectiveWeekKey ?? currentWeekKey;
  for (let cursor = firstGoalWeek; cursor <= currentWeekKey; cursor = addLocalDays(cursor, 7)) {
    const goal = goalForWeek(goalChanges, cursor);
    const met = Boolean(goal && weekMet(practiceDays, goalChanges, cursor));
    const currentInProgress = cursor === currentWeekKey && Boolean(goal) && !met;
    if (currentInProgress) break;
    runningStreak = met ? runningStreak + 1 : 0;
    bestStreakWeeks = Math.max(bestStreakWeeks, runningStreak);
  }

  const previousWeekKey = addLocalDays(currentWeekKey, -7);
  const previousGoal = goalForWeek(goalChanges, previousWeekKey);
  const hasLapsed = Boolean(
    activeGoal &&
      bestStreakWeeks > 0 &&
      previousGoal &&
      !weekMet(practiceDays, goalChanges, previousWeekKey) &&
      !currentWeekMet,
  );

  return {
    currentWeekKey,
    activeGoal,
    practiceDaysThisWeek,
    daysRemaining: activeGoal ? Math.max(activeGoal - practiceDaysThisWeek, 0) : 0,
    currentWeekMet,
    currentStreakWeeks,
    bestStreakWeeks,
    totalPracticeDays: practiceDays.length,
    hasLapsed,
  };
}

function milestoneFor(streakWeeks: number): RhythmMilestone | null {
  return MILESTONES.has(streakWeeks as RhythmMilestone) ? (streakWeeks as RhythmMilestone) : null;
}

export function recordMeaningfulPractice(
  dayKeys: string[],
  changes: WeeklyGoalChange[],
  completedAt: Date | number = new Date(),
) {
  const normalized = normalizePracticeDayKeys(dayKeys);
  const today = localDayKey(completedAt);
  const dayWasNew = !normalized.includes(today);
  const before = summarizeRhythm(normalized, changes, completedAt);
  const practiceDayKeys = dayWasNew ? normalizePracticeDayKeys([...normalized, today]) : normalized;
  const summary = summarizeRhythm(practiceDayKeys, changes, completedAt);
  const weeklyGoalReachedNow = dayWasNew && !before.currentWeekMet && summary.currentWeekMet;

  return {
    practiceDayKeys,
    result: {
      dayWasNew,
      weeklyGoalReachedNow,
      milestone: weeklyGoalReachedNow ? milestoneFor(summary.currentStreakWeeks) : null,
      summary,
    } satisfies PracticeCompletionResult,
  };
}

export function calendarGridForMonth(
  visibleMonth: Date,
  dayKeys: string[],
  now: Date | number = new Date(),
): CalendarDayCell[] {
  const month = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1, 12);
  const gridStart = new Date(month);
  gridStart.setDate(month.getDate() - ((month.getDay() + 6) % 7));
  const practiced = new Set(normalizePracticeDayKeys(dayKeys));
  const todayKey = localDayKey(now);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dayKey = localDayKey(date);
    return {
      dayKey,
      dayNumber: date.getDate(),
      inMonth: date.getMonth() === month.getMonth(),
      practiced: practiced.has(dayKey),
      today: dayKey === todayKey,
      future: dayKey > todayKey,
    };
  });
}
