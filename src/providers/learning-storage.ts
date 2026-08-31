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
export const LEGACY_IMPORT_OWNER_KEY = `${LEARNING_STORAGE_KEY}:legacy-import-owner`;

export type LearningWriteStamp = {
  at: number;
  sequence: number;
  writerId: string;
};

export type LearningFieldWrites = {
  languageId?: LearningWriteStamp;
  enrolledByLanguage?: Partial<Record<LanguageId, LearningWriteStamp>>;
  weeklyGoalChanges?: Record<string, LearningWriteStamp>;
};

export type StoredLearningV2 = {
  version: typeof LEARNING_STORAGE_VERSION;
  languageId: LanguageId;
  enrolledByLanguage: Partial<Record<LanguageId, string>>;
  completedLessonIds: string[];
  lessonEvidence: LessonEvidenceRecord[];
  practiceDayKeys: string[];
  weeklyGoalChanges: WeeklyGoalChange[];
  fieldWrites: LearningFieldWrites;
};

export type LearningPersistenceStatus = 'available' | 'corrupt' | 'unavailable';
export type LearningStorageReadKind = 'found' | 'missing' | 'corrupt' | 'read-error';
export type LearningStorageReadResult = {
  kind: LearningStorageReadKind;
  value: StoredLearningV2;
};

export type LearningStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;
export type LearningLockManager = {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T> | T,
  ): Promise<T>;
};
export type LearningStorageLockOptions = {
  lockManager?: LearningLockManager | null;
  requireBrowserLock?: boolean;
};

const storageQueues = new Map<string, Promise<void>>();

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

function isWriteStamp(value: unknown): value is LearningWriteStamp {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LearningWriteStamp>;
  return (
    Number.isFinite(candidate.at) &&
    Number.isInteger(candidate.sequence) &&
    (candidate.sequence ?? -1) >= 0 &&
    typeof candidate.writerId === 'string' &&
    candidate.writerId.length > 0
  );
}

function writeStampRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, LearningWriteStamp] => isWriteStamp(entry[1])),
  );
}

function fieldWrites(value: unknown): LearningFieldWrites {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  const enrolled = writeStampRecord(candidate.enrolledByLanguage);
  return {
    ...(isWriteStamp(candidate.languageId) ? { languageId: candidate.languageId } : {}),
    ...(Object.keys(enrolled).length
      ? {
          enrolledByLanguage: {
            ...(isWriteStamp(enrolled.el) ? { el: enrolled.el } : {}),
            ...(isWriteStamp(enrolled.es) ? { es: enrolled.es } : {}),
            ...(isWriteStamp(enrolled.fr) ? { fr: enrolled.fr } : {}),
          },
        }
      : {}),
    ...(Object.keys(writeStampRecord(candidate.weeklyGoalChanges)).length
      ? { weeklyGoalChanges: writeStampRecord(candidate.weeklyGoalChanges) }
      : {}),
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
    fieldWrites: {},
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

export function getLearningLockManager(): LearningLockManager | undefined {
  try {
    const candidate = (globalThis.navigator as Navigator & { locks?: LearningLockManager } | undefined)?.locks;
    return candidate && typeof candidate.request === 'function' ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export async function withLearningStorageLock<T>(
  storageKey: string,
  work: () => Promise<T> | T,
  {
    lockManager = getLearningLockManager(),
    requireBrowserLock = false,
  }: LearningStorageLockOptions = {},
) {
  if (requireBrowserLock && !lockManager) {
    throw new Error('Cross-tab learning storage locking is unavailable.');
  }

  const previous = storageQueues.get(storageKey) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() =>
    lockManager
      ? lockManager.request(`glidelingo:${storageKey}`, { mode: 'exclusive' }, work)
      : work(),
  );
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  storageQueues.set(storageKey, settled);
  void settled.finally(() => {
    if (storageQueues.get(storageKey) === settled) storageQueues.delete(storageKey);
  });
  return run;
}

/**
 * Acquires multiple storage locks in one canonical lexical order. Callers must
 * never acquire an earlier key while already holding a later key. In
 * particular, legacy imports acquire the shared source before the scoped
 * destination; ordinary scoped saves acquire only their destination.
 */
export function withLearningStorageLocks<T>(
  storageKeys: string[],
  work: () => Promise<T> | T,
  options: LearningStorageLockOptions = {},
): Promise<T> {
  const orderedKeys = [...new Set(storageKeys)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const acquire = (index: number): Promise<T> =>
    index >= orderedKeys.length
      ? Promise.resolve().then(work)
      : withLearningStorageLock(orderedKeys[index], () => acquire(index + 1), options);
  return acquire(0);
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
        fieldWrites: fieldWrites(candidate.fieldWrites),
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
