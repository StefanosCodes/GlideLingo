import type { LanguageId } from '../constants/catalog.ts';
import { isLessonEvidenceRecord, type LessonEvidenceRecord } from '../features/learning-progress/evidence-policy.ts';
import {
  isWeeklyGoalChange,
  localWeekKey,
  normalizeGoalChanges,
  normalizePracticeDayKeys,
  type WeeklyGoalChange,
  type WeeklyPracticeGoal,
} from '../features/learning-progress/rhythm-policy.ts';

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

export type LearningPersistenceStatus = 'available' | 'corrupt' | 'unavailable';
export type LearningStorageReadKind = 'found' | 'missing' | 'corrupt' | 'read-error';
export type LearningStorageReadResult = {
  kind: LearningStorageReadKind;
  value: StoredLearningV2;
};

export type LearningStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

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

export function learningStorageKey(storageScope: string) {
  return `${LEARNING_STORAGE_KEY}:v${LEARNING_STORAGE_VERSION}:${storageScope}`;
}

export function legacyScopedLearningStorageKey(storageScope: string) {
  return `${LEARNING_STORAGE_KEY}:${storageScope}`;
}

export function legacyDecisionStorageKey(storageScope: string) {
  return `${LEARNING_STORAGE_KEY}:legacy-decision:${storageScope}`;
}

export function getLearningStorage(): LearningStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function parseStoredLearningResult(
  raw: string | null,
  now: Date | number = new Date(),
): LearningStorageReadResult {
  if (raw === null) return { kind: 'missing', value: emptyStoredLearning() };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'corrupt', value: emptyStoredLearning() };
    }

    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== undefined && candidate.version !== 1 && candidate.version !== LEARNING_STORAGE_VERSION) {
      return { kind: 'corrupt', value: emptyStoredLearning() };
    }

    const legacyGoal = isWeeklyPracticeGoal(candidate.weeklyPracticeGoal) ? candidate.weeklyPracticeGoal : null;
    const weeklyGoalChanges =
      candidate.version === LEARNING_STORAGE_VERSION && Array.isArray(candidate.weeklyGoalChanges)
        ? normalizeGoalChanges(candidate.weeklyGoalChanges.filter(isWeeklyGoalChange))
        : legacyGoal
          ? [{ effectiveWeekKey: localWeekKey(now), goal: legacyGoal }]
          : [];

    return {
      kind: 'found',
      value: {
        version: LEARNING_STORAGE_VERSION,
        languageId: isLanguageId(candidate.languageId) ? candidate.languageId : 'el',
        enrolledByLanguage: enrolledCourses(candidate.enrolledByLanguage),
        completedLessonIds: stringArray(candidate.completedLessonIds),
        lessonEvidence: Array.isArray(candidate.lessonEvidence)
          ? candidate.lessonEvidence.filter(isLessonEvidenceRecord)
          : [],
        practiceDayKeys: normalizePracticeDayKeys(stringArray(candidate.practiceDayKeys)),
        weeklyGoalChanges,
      },
    };
  } catch {
    return { kind: 'corrupt', value: emptyStoredLearning() };
  }
}

export function parseStoredLearning(raw: string | null, now: Date | number = new Date()): StoredLearningV2 {
  return parseStoredLearningResult(raw, now).value;
}

export function readStoredLearning(
  storageKey: string,
  storage: LearningStorage | undefined = getLearningStorage(),
  now: Date | number = new Date(),
): LearningStorageReadResult {
  if (!storage) return { kind: 'read-error', value: emptyStoredLearning() };

  try {
    return parseStoredLearningResult(storage.getItem(storageKey), now);
  } catch {
    return { kind: 'read-error', value: emptyStoredLearning() };
  }
}

export function writeStoredLearning(
  storageKey: string,
  value: StoredLearningV2,
  storage: LearningStorage | undefined = getLearningStorage(),
) {
  if (!storage) return false;
  try {
    storage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
