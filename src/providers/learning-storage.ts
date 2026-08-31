import type { LanguageId } from '@/constants/catalog';
import { isLessonEvidenceRecord, type LessonEvidenceRecord } from '@/features/learning-progress/evidence-policy';
import {
  isWeeklyGoalChange,
  localWeekKey,
  normalizeGoalChanges,
  normalizePracticeDayKeys,
  type WeeklyGoalChange,
  type WeeklyPracticeGoal,
} from '@/features/learning-progress/rhythm-policy';

export const LEARNING_STORAGE_KEY = 'glidelingo-learning';
export const LEARNING_STORAGE_VERSION = 2;

export type StoredLearningV2 = {
  version: typeof LEARNING_STORAGE_VERSION;
  languageId: LanguageId;
  enrolledByLanguage: Partial<Record<LanguageId, string>>;
  completedLessonIds: string[];
  lessonEvidence: LessonEvidenceRecord[];
  practiceDayKeys: string[];
  weeklyGoalChanges: WeeklyGoalChange[];
};

export type LearningPersistenceStatus = 'available' | 'unavailable';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function isLanguageId(value: unknown): value is LanguageId {
  return value === 'el' || value === 'es' || value === 'fr';
}

function isWeeklyPracticeGoal(value: unknown): value is WeeklyPracticeGoal {
  return value === 2 || value === 3 || value === 5;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string'))] : [];
}

function enrolledCourses(value: unknown): Partial<Record<LanguageId, string>> {
  if (!value || typeof value !== 'object') return {};
  const candidate = value as Partial<Record<LanguageId, unknown>>;
  return {
    ...(typeof candidate.el === 'string' ? { el: candidate.el } : {}),
    ...(typeof candidate.es === 'string' ? { es: candidate.es } : {}),
    ...(typeof candidate.fr === 'string' ? { fr: candidate.fr } : {}),
  };
}

export function emptyStoredLearning(): StoredLearningV2 {
  return {
    version: LEARNING_STORAGE_VERSION,
    languageId: 'el',
    enrolledByLanguage: {},
    completedLessonIds: [],
    lessonEvidence: [],
    practiceDayKeys: [],
    weeklyGoalChanges: [],
  };
}

export function parseStoredLearning(raw: string | null, now: Date | number = new Date()): StoredLearningV2 {
  if (!raw) return emptyStoredLearning();

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const legacyGoal = isWeeklyPracticeGoal(parsed.weeklyPracticeGoal) ? parsed.weeklyPracticeGoal : null;
    const weeklyGoalChanges =
      parsed.version === LEARNING_STORAGE_VERSION && Array.isArray(parsed.weeklyGoalChanges)
        ? normalizeGoalChanges(parsed.weeklyGoalChanges.filter(isWeeklyGoalChange))
        : legacyGoal
          ? [{ effectiveWeekKey: localWeekKey(now), goal: legacyGoal }]
          : [];

    return {
      version: LEARNING_STORAGE_VERSION,
      languageId: isLanguageId(parsed.languageId) ? parsed.languageId : 'el',
      enrolledByLanguage: enrolledCourses(parsed.enrolledByLanguage),
      completedLessonIds: stringArray(parsed.completedLessonIds),
      lessonEvidence: Array.isArray(parsed.lessonEvidence)
        ? parsed.lessonEvidence.filter(isLessonEvidenceRecord)
        : [],
      practiceDayKeys: normalizePracticeDayKeys(stringArray(parsed.practiceDayKeys)),
      weeklyGoalChanges,
    };
  } catch {
    return emptyStoredLearning();
  }
}

export function readStoredLearning(
  storage: StorageLike | undefined = globalThis.localStorage,
  now: Date | number = new Date(),
) {
  if (!storage) {
    return { value: emptyStoredLearning(), status: 'unavailable' as LearningPersistenceStatus };
  }

  try {
    return {
      value: parseStoredLearning(storage.getItem(LEARNING_STORAGE_KEY), now),
      status: 'available' as LearningPersistenceStatus,
    };
  } catch {
    return { value: emptyStoredLearning(), status: 'unavailable' as LearningPersistenceStatus };
  }
}

export function writeStoredLearning(value: StoredLearningV2, storage: StorageLike | undefined = globalThis.localStorage) {
  if (!storage) return false;
  try {
    storage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
