export type CapabilityState = 'introduced' | 'practiced' | 'demonstrated' | 'retained';

export type CommunicationMode = 'listening' | 'speaking' | 'reading' | 'writing';

export type EvidenceLevel = 'practice' | 'checkpoint';

export type LessonMode = 'learn' | 'review';

export type WeeklyPracticeGoal = 2 | 3 | 5;

export type LessonCapability = {
  id: string;
  canDo: string;
  mode: CommunicationMode;
};

export type CheckObservation = {
  beatIndex: number;
  capabilityId?: string;
  level?: EvidenceLevel;
  attempts: number;
  correct: boolean;
  correctOnFirstTry: boolean;
};

export type LessonCompletionInput = {
  lessonId: string;
  mode: LessonMode;
  capability?: LessonCapability;
  introducedModes: CommunicationMode[];
  checks: CheckObservation[];
};

export type CheckpointResult = 'none' | 'recovered' | 'first-try';

export type LessonEvidenceRecord = {
  lessonId: string;
  capability?: LessonCapability;
  state: CapabilityState;
  evidenceAt: number;
  lastPracticedAt: number;
  lastMode: LessonMode;
  lastCheckpoint: CheckpointResult;
  introducedModes: CommunicationMode[];
  checkCount: number;
  firstTryCorrectCount: number;
  recoveredCheckCount: number;
  completionCount: number;
};

export type ReviewItem = {
  lessonId: string;
  capability: LessonCapability;
  state: CapabilityState;
  dueAt: number;
  due: boolean;
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const stateRank: Record<CapabilityState, number> = {
  introduced: 0,
  practiced: 1,
  demonstrated: 2,
  retained: 3,
};

function uniqueModes(modes: CommunicationMode[]) {
  return [...new Set(modes)];
}

export function summarizeLessonCompletion(
  input: LessonCompletionInput,
  completedAt: number,
  previous?: LessonEvidenceRecord,
): LessonEvidenceRecord {
  const relevantChecks = input.capability
    ? input.checks.filter((check) => !check.capabilityId || check.capabilityId === input.capability?.id)
    : input.checks;
  const completedChecks = relevantChecks.filter((check) => check.correct);
  const checkpoints = completedChecks.filter((check) => check.level === 'checkpoint');
  const firstTryCheckpoint = checkpoints.length > 0 && checkpoints.every((check) => check.correctOnFirstTry);
  const recoveredCheckpoint = checkpoints.some((check) => !check.correctOnFirstTry);
  const hasQualifyingPractice = completedChecks.some((check) => check.level === 'practice' || check.level === 'checkpoint');

  let state: CapabilityState = 'introduced';
  if (hasQualifyingPractice) state = 'practiced';
  if (firstTryCheckpoint) state = 'demonstrated';

  // A repeated review item can strengthen an existing demonstration, but it is
  // not sufficiently varied to claim retained performance yet.
  if (input.mode === 'review' && previous && stateRank[previous.state] >= stateRank.demonstrated) {
    state = previous.state;
  }

  const lastCheckpoint: CheckpointResult = firstTryCheckpoint
    ? 'first-try'
    : recoveredCheckpoint
      ? 'recovered'
      : 'none';

  return {
    lessonId: input.lessonId,
    capability: input.capability,
    state,
    evidenceAt: completedAt,
    lastPracticedAt: completedAt,
    lastMode: input.mode,
    lastCheckpoint,
    introducedModes: uniqueModes(input.introducedModes),
    checkCount: completedChecks.length,
    firstTryCorrectCount: completedChecks.filter((check) => check.correctOnFirstTry).length,
    recoveredCheckCount: completedChecks.filter((check) => !check.correctOnFirstTry).length,
    completionCount: 1,
  };
}

export function mergeLessonEvidence(
  previous: LessonEvidenceRecord | undefined,
  incoming: LessonEvidenceRecord,
): LessonEvidenceRecord {
  if (!previous) return incoming;

  const incomingIsStronger = stateRank[incoming.state] > stateRank[previous.state];
  const incomingMatchesBest = stateRank[incoming.state] === stateRank[previous.state];
  const best = incomingIsStronger || incomingMatchesBest ? incoming : previous;

  return {
    ...best,
    evidenceAt: incomingIsStronger || incomingMatchesBest ? incoming.evidenceAt : previous.evidenceAt,
    lastPracticedAt: incoming.lastPracticedAt,
    lastMode: incoming.lastMode,
    lastCheckpoint: incoming.lastCheckpoint,
    introducedModes: uniqueModes([...previous.introducedModes, ...incoming.introducedModes]),
    checkCount: incoming.checkCount,
    firstTryCorrectCount: incoming.firstTryCorrectCount,
    recoveredCheckCount: incoming.recoveredCheckCount,
    completionCount: previous.completionCount + 1,
  };
}

export function upsertLessonEvidence(records: LessonEvidenceRecord[], incoming: LessonEvidenceRecord) {
  const previous = records.find((record) => record.lessonId === incoming.lessonId);
  const merged = mergeLessonEvidence(previous, incoming);
  return previous
    ? records.map((record) => (record.lessonId === incoming.lessonId ? merged : record))
    : [...records, merged];
}

export function capabilityStateForMode(
  records: LessonEvidenceRecord[],
  mode: CommunicationMode,
): CapabilityState | 'unseen' {
  let best: CapabilityState | 'unseen' = 'unseen';

  for (const record of records) {
    if (record.introducedModes.includes(mode) && best === 'unseen') best = 'introduced';
    if (record.capability?.mode !== mode) continue;
    if (best === 'unseen' || stateRank[record.state] > stateRank[best]) best = record.state;
  }

  return best;
}

export function strongestCapabilityEvidence(records: LessonEvidenceRecord[]) {
  return records
    .filter((record): record is LessonEvidenceRecord & { capability: LessonCapability } => Boolean(record.capability))
    .sort((left, right) => {
      const rankDifference = stateRank[right.state] - stateRank[left.state];
      return rankDifference || right.evidenceAt - left.evidenceAt;
    });
}

export function reviewItemsFor(records: LessonEvidenceRecord[], now = Date.now()): ReviewItem[] {
  return strongestCapabilityEvidence(records)
    .map((record) => {
      let delay = 0;
      let reason = 'Try a fresh checkpoint with less support.';

      if (record.lastCheckpoint === 'recovered') {
        reason = 'You recovered this pattern. A fresh first attempt can demonstrate it.';
      } else if (record.state === 'demonstrated') {
        delay = record.lastMode === 'review' && record.lastCheckpoint === 'first-try' ? 3 * DAY_MS : DAY_MS;
        reason =
          record.lastMode === 'review'
            ? 'Bring this back after a wider gap so recall becomes more durable.'
            : 'Retrieve this later to see whether it still comes back without the lesson.';
      } else if (record.state === 'retained') {
        delay = 7 * DAY_MS;
        reason = 'Use this again in a changed context to keep it available.';
      }

      const dueAt = record.lastPracticedAt + delay;
      return {
        lessonId: record.lessonId,
        capability: record.capability,
        state: record.state,
        dueAt,
        due: dueAt <= now,
        reason,
      };
    })
    .sort((left, right) => left.dueAt - right.dueAt);
}

export function localDayKey(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function practiceDaysInCurrentWeek(dayKeys: string[], now = new Date()) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  const currentWeek = new Set(
    Array.from({ length: 7 }, (_, index) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + index);
      return localDayKey(day);
    }),
  );

  return new Set(dayKeys.filter((key) => currentWeek.has(key))).size;
}

export function isLessonEvidenceRecord(value: unknown): value is LessonEvidenceRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<LessonEvidenceRecord>;
  const capability = record.capability as Partial<LessonCapability> | undefined;
  const capabilityIsValid =
    capability === undefined ||
    (capability !== null &&
      typeof capability === 'object' &&
      typeof capability.id === 'string' &&
      typeof capability.canDo === 'string' &&
      (capability.mode === 'listening' ||
        capability.mode === 'speaking' ||
        capability.mode === 'reading' ||
        capability.mode === 'writing'));
  return (
    typeof record.lessonId === 'string' &&
    typeof record.state === 'string' &&
    Object.prototype.hasOwnProperty.call(stateRank, record.state) &&
    Number.isFinite(record.evidenceAt) &&
    Number.isFinite(record.lastPracticedAt) &&
    (record.lastMode === 'learn' || record.lastMode === 'review') &&
    (record.lastCheckpoint === 'none' || record.lastCheckpoint === 'recovered' || record.lastCheckpoint === 'first-try') &&
    Array.isArray(record.introducedModes) &&
    record.introducedModes.every(
      (mode) => mode === 'listening' || mode === 'speaking' || mode === 'reading' || mode === 'writing',
    ) &&
    capabilityIsValid &&
    Number.isFinite(record.checkCount) &&
    Number.isFinite(record.firstTryCorrectCount) &&
    Number.isFinite(record.recoveredCheckCount) &&
    Number.isFinite(record.completionCount)
  );
}
