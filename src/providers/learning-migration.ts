import type { LessonEvidenceRecord } from '../features/learning-progress/evidence-policy.ts';
import { normalizeGoalChanges, normalizePracticeDayKeys } from '../features/learning-progress/rhythm-policy.ts';
import {
  LEARNING_STORAGE_VERSION,
  type LearningStorage,
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

function mergeEvidence(current: LessonEvidenceRecord[], legacy: LessonEvidenceRecord[]) {
  const byLesson = new Map(legacy.map((record) => [record.lessonId, record]));
  for (const record of current) {
    const earlier = byLesson.get(record.lessonId);
    byLesson.set(record.lessonId, earlier ? mergeEvidenceRecord(record, earlier) : record);
  }
  return [...byLesson.values()];
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
  return {
    version: LEARNING_STORAGE_VERSION,
    languageId: hasProgress(current) ? current.languageId : legacy.languageId,
    enrolledByLanguage: { ...legacy.enrolledByLanguage, ...current.enrolledByLanguage },
    completedLessonIds: [...new Set([...legacy.completedLessonIds, ...current.completedLessonIds])],
    lessonEvidence: mergeEvidence(current.lessonEvidence, legacy.lessonEvidence),
    practiceDayKeys: normalizePracticeDayKeys([...legacy.practiceDayKeys, ...current.practiceDayKeys]),
    weeklyGoalChanges: normalizeGoalChanges([...legacy.weeklyGoalChanges, ...current.weeklyGoalChanges]),
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
