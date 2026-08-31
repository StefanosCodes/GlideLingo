import type { LessonEvidenceRecord } from '../features/learning-progress/evidence-policy.ts';
import { normalizeGoalChanges, normalizePracticeDayKeys } from '../features/learning-progress/rhythm-policy.ts';
import {
  LEARNING_STORAGE_VERSION,
  type LearningFieldWrites,
  type LearningStorage,
  type LearningWriteStamp,
  type StoredLearningV2,
} from './learning-storage.ts';

const evidenceRank = {
  introduced: 0,
  practiced: 1,
  demonstrated: 2,
  retained: 3,
} as const;

function mergeEvidenceRecord(current: LessonEvidenceRecord, legacy: LessonEvidenceRecord) {
  const currentRank = evidenceRank[current.state];
  const legacyRank = evidenceRank[legacy.state];
  const strongest = currentRank >= legacyRank ? current : legacy;
  const latest = current.lastPracticedAt >= legacy.lastPracticedAt ? current : legacy;

  return {
    ...strongest,
    capability: strongest.capability ?? latest.capability,
    lastPracticedAt: latest.lastPracticedAt,
    lastMode: latest.lastMode,
    lastCheckpoint: latest.lastCheckpoint,
    introducedModes: [...new Set([...legacy.introducedModes, ...current.introducedModes])],
    checkCount: Math.max(current.checkCount, legacy.checkCount),
    firstTryCorrectCount: Math.max(current.firstTryCorrectCount, legacy.firstTryCorrectCount),
    recoveredCheckCount: Math.max(current.recoveredCheckCount, legacy.recoveredCheckCount),
    completionCount: Math.max(current.completionCount, legacy.completionCount),
  } satisfies LessonEvidenceRecord;
}

export function mergeEvidence(current: LessonEvidenceRecord[], legacy: LessonEvidenceRecord[]) {
  const byLesson = new Map(legacy.map((record) => [record.lessonId, record]));
  for (const record of current) {
    const earlier = byLesson.get(record.lessonId);
    byLesson.set(record.lessonId, earlier ? mergeEvidenceRecord(record, earlier) : record);
  }
  return [...byLesson.values()];
}

export function compareLearningWriteStamps(
  left: LearningWriteStamp | undefined,
  right: LearningWriteStamp | undefined,
) {
  if (!left) return right ? -1 : 0;
  if (!right) return 1;
  if (left.at !== right.at) return left.at - right.at;
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  return left.writerId.localeCompare(right.writerId);
}

function selectScalar<T>(
  current: T,
  currentStamp: LearningWriteStamp | undefined,
  incoming: T,
  incomingStamp: LearningWriteStamp | undefined,
) {
  return compareLearningWriteStamps(currentStamp, incomingStamp) < 0
    ? { value: incoming, stamp: incomingStamp }
    : { value: current, stamp: currentStamp };
}

/**
 * Reconciles two account-scoped snapshots. Progress evidence is monotonic;
 * independently editable scalar fields use a deterministic last-write tuple
 * of wall time, writer-local sequence, and writer id.
 */
export function mergeConcurrentLearning(current: StoredLearningV2, incoming: StoredLearningV2): StoredLearningV2 {
  const language = selectScalar(
    current.languageId,
    current.fieldWrites.languageId,
    incoming.languageId,
    incoming.fieldWrites.languageId,
  );

  const enrolledByLanguage = { ...current.enrolledByLanguage };
  const enrolledWrites: NonNullable<LearningFieldWrites['enrolledByLanguage']> = {
    ...current.fieldWrites.enrolledByLanguage,
  };
  for (const languageId of ['el', 'es', 'fr'] as const) {
    const selected = selectScalar(
      current.enrolledByLanguage[languageId],
      current.fieldWrites.enrolledByLanguage?.[languageId],
      incoming.enrolledByLanguage[languageId],
      incoming.fieldWrites.enrolledByLanguage?.[languageId],
    );
    if (selected.value === undefined) delete enrolledByLanguage[languageId];
    else enrolledByLanguage[languageId] = selected.value;
    if (selected.stamp) enrolledWrites[languageId] = selected.stamp;
    else delete enrolledWrites[languageId];
  }

  const goalByWeek = new Map(current.weeklyGoalChanges.map((change) => [change.effectiveWeekKey, change]));
  const goalWrites: Record<string, LearningWriteStamp> = { ...current.fieldWrites.weeklyGoalChanges };
  const incomingGoals = new Map(incoming.weeklyGoalChanges.map((change) => [change.effectiveWeekKey, change]));
  for (const weekKey of new Set([...goalByWeek.keys(), ...incomingGoals.keys()])) {
    const selected = selectScalar(
      goalByWeek.get(weekKey),
      current.fieldWrites.weeklyGoalChanges?.[weekKey],
      incomingGoals.get(weekKey),
      incoming.fieldWrites.weeklyGoalChanges?.[weekKey],
    );
    if (selected.value) goalByWeek.set(weekKey, selected.value);
    else goalByWeek.delete(weekKey);
    if (selected.stamp) goalWrites[weekKey] = selected.stamp;
    else delete goalWrites[weekKey];
  }

  return {
    version: LEARNING_STORAGE_VERSION,
    languageId: language.value,
    enrolledByLanguage,
    completedLessonIds: [...new Set([...current.completedLessonIds, ...incoming.completedLessonIds])],
    lessonEvidence: mergeEvidence(current.lessonEvidence, incoming.lessonEvidence),
    practiceDayKeys: normalizePracticeDayKeys([...current.practiceDayKeys, ...incoming.practiceDayKeys]),
    weeklyGoalChanges: normalizeGoalChanges([...goalByWeek.values()]),
    fieldWrites: {
      ...(language.stamp ? { languageId: language.stamp } : {}),
      ...(Object.keys(enrolledWrites).length ? { enrolledByLanguage: enrolledWrites } : {}),
      ...(Object.keys(goalWrites).length ? { weeklyGoalChanges: goalWrites } : {}),
    },
  };
}

function hasProgress(value: StoredLearningV2) {
  return Boolean(
    Object.keys(value.enrolledByLanguage).length ||
      value.completedLessonIds.length ||
      value.lessonEvidence.length ||
      value.practiceDayKeys.length ||
      value.weeklyGoalChanges.length,
  );
}

export function mergeLegacyLearning(current: StoredLearningV2, legacy: StoredLearningV2): StoredLearningV2 {
  const currentHasProgress = hasProgress(current);
  return {
    version: LEARNING_STORAGE_VERSION,
    languageId: currentHasProgress ? current.languageId : legacy.languageId,
    enrolledByLanguage: { ...legacy.enrolledByLanguage, ...current.enrolledByLanguage },
    completedLessonIds: [...new Set([...legacy.completedLessonIds, ...current.completedLessonIds])],
    lessonEvidence: mergeEvidence(current.lessonEvidence, legacy.lessonEvidence),
    practiceDayKeys: normalizePracticeDayKeys([...legacy.practiceDayKeys, ...current.practiceDayKeys]),
    weeklyGoalChanges: normalizeGoalChanges([...legacy.weeklyGoalChanges, ...current.weeklyGoalChanges]),
    fieldWrites: {
      ...legacy.fieldWrites,
      ...current.fieldWrites,
      ...(currentHasProgress
        ? { languageId: current.fieldWrites.languageId }
        : { languageId: legacy.fieldWrites.languageId }),
      enrolledByLanguage: {
        ...legacy.fieldWrites.enrolledByLanguage,
        ...current.fieldWrites.enrolledByLanguage,
      },
      weeklyGoalChanges: {
        ...legacy.fieldWrites.weeklyGoalChanges,
        ...current.fieldWrites.weeklyGoalChanges,
      },
    },
  };
}

/**
 * Write the complete V2 account destination before changing either legacy
 * marker. Cleanup failures leave the shared source intact and remove the
 * decision marker so the exact idempotent merge can be retried.
 */
export function persistLegacyLearningImport(
  storage: LearningStorage,
  {
    decisionKey,
    destinationKey,
    legacyKey,
    merged,
  }: {
    decisionKey: string;
    destinationKey: string;
    legacyKey: string;
    merged: StoredLearningV2;
  },
) {
  storage.setItem(destinationKey, JSON.stringify(merged));
  storage.setItem(decisionKey, 'imported');

  try {
    storage.removeItem(legacyKey);
  } catch (error) {
    try {
      storage.removeItem(decisionKey);
    } catch {
      // The complete account copy remains durable. A later explicit import can
      // safely merge the same source again without duplicating stored evidence.
    }
    throw error;
  }
}
