import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import {
  type Course,
  type Language,
  type LanguageId,
  completedModuleIdsFor,
  courseProgress,
  currentModule,
  getCourse,
  getCoursesForLanguage,
  getLesson,
  getLanguage,
  isLessonAvailable,
  languages,
  nextLesson,
} from '@/constants/catalog';
import {
  type LessonCompletionInput,
  type LessonEvidenceRecord,
  type LessonMode,
  reviewItemsFor,
  summarizeLessonCompletion,
  upsertLessonEvidence,
} from '@/features/learning-progress/evidence-policy';
import { useLearningClock } from '@/features/learning-progress/learning-clock';
import {
  recordMeaningfulPractice,
  setGoalForCurrentWeek,
  summarizeRhythm,
  type PracticeCompletionResult,
  type RhythmSummary,
  type WeeklyGoalChange,
  type WeeklyPracticeGoal,
} from '@/features/learning-progress/rhythm-policy';
import {
  LegacyLearningImportFailure,
  mergeConcurrentLearning,
  mergeLegacyLearning,
  persistLegacyLearningImport,
} from '@/providers/learning-migration';
import {
  getLearningStorage,
  LEGACY_IMPORT_OWNER_KEY,
  LEARNING_STORAGE_KEY,
  learningStorageKey,
  legacyDecisionStorageKey,
  legacyScopedLearningStorageKey,
  readStoredLearning,
  type LearningPersistenceStatus,
  type LearningWriteStamp,
  type StoredLearningV2,
  withLearningStorageLock,
  withLearningStorageLocks,
  writeStoredLearning,
} from '@/providers/learning-storage';

export type LessonCompletionResult = PracticeCompletionResult & { evidence: LessonEvidenceRecord };

type LearningContextValue = {
  language: Language;
  languageId: LanguageId;
  languages: Language[];
  courses: Course[];
  enrolledCourse: Course | null;
  currentModule: ReturnType<typeof currentModule>;
  nextLesson: ReturnType<typeof nextLesson>;
  focusedModuleId: string | null;
  activeLessonId: string | null;
  activeLessonMode: LessonMode;
  progress: number;
  completedModuleIds: string[];
  completedLessonIds: string[];
  lessonEvidence: LessonEvidenceRecord[];
  reviewItems: ReturnType<typeof reviewItemsFor>;
  practiceDayKeys: string[];
  practiceDaysThisWeek: number;
  weeklyPracticeGoal: WeeklyPracticeGoal | null;
  weeklyGoalChanges: WeeklyGoalChange[];
  rhythmSummary: RhythmSummary;
  persistenceStatus: LearningPersistenceStatus;
  legacyProgressAvailable: boolean;
  legacyProgressError: string | null;
  setLanguage: (id: LanguageId) => void;
  switchCourse: (courseId: string) => boolean;
  startCourse: (courseId: string) => boolean;
  focusModule: (moduleId: string | null) => void;
  openLesson: (lessonId: string | null, mode?: LessonMode) => void;
  completeLesson: (completion: LessonCompletionInput) => LessonCompletionResult;
  setWeeklyPracticeGoal: (goal: WeeklyPracticeGoal | null) => void;
  dismissLegacyProgress: () => void;
  importLegacyProgress: () => void;
};

const LearningContext = createContext<LearningContextValue | null>(null);
let nextWriterNumber = 0;

function createWriterId() {
  try {
    const id = globalThis.crypto?.randomUUID?.();
    if (id) return id;
  } catch {
    // Older native runtimes do not expose Web Crypto. The fallback still
    // includes process-local and random components to avoid tab collisions.
  }
  return `learning-writer-${Date.now()}-${++nextWriterNumber}-${Math.random().toString(36).slice(2)}`;
}

function latestWriteTime(value: StoredLearningV2) {
  return Math.max(
    0,
    value.fieldWrites.languageId?.at ?? 0,
    ...Object.values(value.fieldWrites.enrolledByLanguage ?? {}).map((stamp) => stamp?.at ?? 0),
    ...Object.values(value.fieldWrites.weeklyGoalChanges ?? {}).map((stamp) => stamp.at),
  );
}

function persistenceStatus(kind: 'found' | 'missing' | 'corrupt' | 'read-error'): LearningPersistenceStatus {
  if (kind === 'corrupt') return 'corrupt';
  if (kind === 'read-error') return 'unavailable';
  return 'available';
}

function initializeLearning(storageScope: string) {
  const storage = getLearningStorage();
  const destinationKey = learningStorageKey(storageScope);
  const destination = readStoredLearning(destinationKey, storage);
  if (destination.kind !== 'missing') {
    return {
      canPersist: destination.kind === 'found',
      status: persistenceStatus(destination.kind),
      value: destination.value,
    };
  }

  const oldScopedKey = legacyScopedLearningStorageKey(storageScope);
  const oldScoped = readStoredLearning(oldScopedKey, storage);
  if (oldScoped.kind === 'found') {
    if (!writeStoredLearning(destinationKey, oldScoped.value, storage)) {
      return { canPersist: false, status: 'unavailable' as const, value: oldScoped.value };
    }
    try {
      storage?.removeItem(oldScopedKey);
    } catch {
      // The destination is already durable and account-scoped. Leaving the old
      // account key is safe and permits manual cleanup later.
    }
    return { canPersist: true, status: 'available' as const, value: oldScoped.value };
  }

  if (oldScoped.kind === 'corrupt' || oldScoped.kind === 'read-error') {
    return {
      canPersist: false,
      status: persistenceStatus(oldScoped.kind),
      value: oldScoped.value,
    };
  }

  return { canPersist: true, status: 'available' as const, value: destination.value };
}

function legacyProgressNeedsDecision(storageScope: string) {
  const storage = getLearningStorage();
  if (!storage) return false;
  let decision: string | null;
  try {
    decision = storage.getItem(legacyDecisionStorageKey(storageScope));
    const owner = storage.getItem(LEGACY_IMPORT_OWNER_KEY);
    if (owner && owner !== storageScope) return false;
  } catch {
    return false;
  }
  if (decision === 'dismissed') return false;
  return readStoredLearning(LEARNING_STORAGE_KEY, storage).kind === 'found';
}

export function LearningProvider({
  children,
  storageScope,
}: PropsWithChildren<{ storageScope: string }>) {
  const storageKey = learningStorageKey(storageScope);
  const legacyDecisionKey = legacyDecisionStorageKey(storageScope);
  const [initial] = useState(() => initializeLearning(storageScope));
  const canPersistRef = useRef(initial.canPersist);
  const [learning, setLearning] = useState<StoredLearningV2>(initial.value);
  const learningRef = useRef(initial.value);
  const [writerId] = useState(createWriterId);
  const writerIdRef = useRef(writerId);
  const writerSequenceRef = useRef(0);
  const latestWriteTimeRef = useRef(latestWriteTime(initial.value));
  const [legacyProgressAvailable, setLegacyProgressAvailable] = useState(() =>
    legacyProgressNeedsDecision(storageScope),
  );
  const [legacyProgressError, setLegacyProgressError] = useState<string | null>(null);
  const [persistenceState, setPersistenceState] = useState<LearningPersistenceStatus>(initial.status);
  const [focusedModuleId, setFocusedModuleId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [activeLessonMode, setActiveLessonMode] = useState<LessonMode>('learn');
  const now = useLearningClock(learning.lessonEvidence);

  const reconcileLearning = useCallback((incoming: StoredLearningV2) => {
    const reconciled = mergeConcurrentLearning(learningRef.current, incoming);
    learningRef.current = reconciled;
    latestWriteTimeRef.current = Math.max(latestWriteTimeRef.current, latestWriteTime(reconciled));
    setLearning(reconciled);
    return reconciled;
  }, []);

  const nextWriteStamp = useCallback((): LearningWriteStamp => {
    const at = Math.max(Date.now(), latestWriteTimeRef.current + 1);
    latestWriteTimeRef.current = at;
    return { at, sequence: ++writerSequenceRef.current, writerId: writerIdRef.current };
  }, []);

  const persistSnapshot = useCallback(
    (snapshot: StoredLearningV2) => {
      if (!canPersistRef.current) return;
      void withLearningStorageLock(
        storageKey,
        () => {
          const storage = getLearningStorage();
          if (!storage) throw new Error('Learning storage is unavailable.');
          const durable = readStoredLearning(storageKey, storage);
          if (durable.kind === 'corrupt' || durable.kind === 'read-error') {
            throw new Error('Learning storage could not be read safely.');
          }
          const merged = durable.kind === 'found'
            ? mergeConcurrentLearning(durable.value, snapshot)
            : snapshot;
          if (!writeStoredLearning(storageKey, merged, storage)) {
            throw new Error('Learning storage could not be written.');
          }
          return merged;
        },
        { requireBrowserLock: Platform.OS === 'web' },
      )
        .then((merged) => {
          reconcileLearning(merged);
          setPersistenceState('available');
        })
        .catch(() => {
          canPersistRef.current = false;
          setPersistenceState('unavailable');
        });
    },
    [reconcileLearning, storageKey],
  );

  const updateLearning = useCallback(
    (update: (current: StoredLearningV2) => StoredLearningV2) => {
      const next = update(learningRef.current);
      learningRef.current = next;
      setLearning(next);
      persistSnapshot(next);
      return next;
    },
    [persistSnapshot],
  );

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function' ||
      typeof window.removeEventListener !== 'function'
    ) return;
    const reconcileStorageEvent = (event: StorageEvent) => {
      if (event.key !== storageKey || event.newValue === null) return;
      const incoming = readStoredLearning(storageKey, {
        getItem: () => event.newValue,
        removeItem: () => undefined,
        setItem: () => undefined,
      });
      if (incoming.kind === 'found') reconcileLearning(incoming.value);
    };
    window.addEventListener('storage', reconcileStorageEvent);
    return () => window.removeEventListener('storage', reconcileStorageEvent);
  }, [reconcileLearning, storageKey]);

  const { completedLessonIds, enrolledByLanguage, languageId, lessonEvidence, practiceDayKeys, weeklyGoalChanges } =
    learning;
  const language = getLanguage(languageId);
  const courses = getCoursesForLanguage(languageId);
  const enrolledCourse = getCourse(enrolledByLanguage[languageId] ?? '') ?? null;
  const moduleNow = enrolledCourse ? currentModule(enrolledCourse, completedLessonIds) : null;
  const lessonNow = enrolledCourse ? nextLesson(enrolledCourse, completedLessonIds) : null;
  const progress = enrolledCourse ? courseProgress(enrolledCourse, completedLessonIds) : 0;
  const completedModuleIds = useMemo(
    () => (enrolledCourse ? completedModuleIdsFor(enrolledCourse, completedLessonIds) : []),
    [completedLessonIds, enrolledCourse],
  );
  const reviewItems = useMemo(() => reviewItemsFor(lessonEvidence, now), [lessonEvidence, now]);
  const rhythmSummary = useMemo(
    () => summarizeRhythm(practiceDayKeys, weeklyGoalChanges, now),
    [now, practiceDayKeys, weeklyGoalChanges],
  );

  const setLanguage = useCallback((id: LanguageId) => {
    setActiveLessonId(null);
    setActiveLessonMode('learn');
    setFocusedModuleId(null);
    const stamp = nextWriteStamp();
    updateLearning((current) => ({
      ...current,
      languageId: id,
      fieldWrites: { ...current.fieldWrites, languageId: stamp },
    }));
  }, [nextWriteStamp, updateLearning]);

  const switchCourse = useCallback(
    (courseId: string) => {
      const course = getCourse(courseId);
      if (!course || !getLanguage(course.languageId).available) return false;
      setActiveLessonId(null);
      setActiveLessonMode('learn');
      setFocusedModuleId(null);
      const stamp = nextWriteStamp();
      const next = updateLearning((current) => ({
        ...current,
        languageId: course.languageId,
        fieldWrites: { ...current.fieldWrites, languageId: stamp },
      }));
      return next.enrolledByLanguage[course.languageId] === course.id;
    },
    [nextWriteStamp, updateLearning],
  );

  const focusModule = useCallback((moduleId: string | null) => {
    setActiveLessonId(null);
    setActiveLessonMode('learn');
    setFocusedModuleId(moduleId);
  }, []);

  const openLesson = useCallback(
    (lessonId: string | null, mode: LessonMode = 'learn') => {
      const found = lessonId && enrolledCourse ? getLesson(enrolledCourse, lessonId) : null;
      const availableLessonId = found && isLessonAvailable(found.lesson) ? lessonId : null;
      setActiveLessonId(availableLessonId);
      setActiveLessonMode(availableLessonId ? mode : 'learn');
      if (availableLessonId && found) {
        setFocusedModuleId(found.module.id);
      }
    },
    [enrolledCourse],
  );

  const startCourse = useCallback(
    (courseId: string) => {
      const course = getCourse(courseId);
      if (!course || course.languageId !== languageId || !language.available) return false;
      const stamp = nextWriteStamp();
      updateLearning((current) => ({
        ...current,
        enrolledByLanguage: { ...current.enrolledByLanguage, [languageId]: course.id },
        fieldWrites: {
          ...current.fieldWrites,
          enrolledByLanguage: { ...current.fieldWrites.enrolledByLanguage, [languageId]: stamp },
        },
      }));
      setFocusedModuleId(null);
      setActiveLessonId(null);
      setActiveLessonMode('learn');
      return true;
    },
    [language.available, languageId, nextWriteStamp, updateLearning],
  );

  const completeLesson = useCallback((completion: LessonCompletionInput) => {
    const completedAt = Date.now();
    const currentLearning = learningRef.current;
    const currentPracticeDays = currentLearning.practiceDayKeys;
    const currentGoalChanges = currentLearning.weeklyGoalChanges;
    const practice = recordMeaningfulPractice(currentPracticeDays, currentGoalChanges, completedAt);
    const previous = currentLearning.lessonEvidence.find((record) => record.lessonId === completion.lessonId);
    const incoming = summarizeLessonCompletion(completion, completedAt, previous);
    const nextEvidence = upsertLessonEvidence(currentLearning.lessonEvidence, incoming);
    const mergedEvidence = nextEvidence.find((record) => record.lessonId === completion.lessonId) ?? incoming;

    updateLearning((current) => ({
      ...current,
      completedLessonIds: current.completedLessonIds.includes(completion.lessonId)
        ? current.completedLessonIds
        : [...current.completedLessonIds, completion.lessonId],
      lessonEvidence: mergeConcurrentLearning(current, {
        ...currentLearning,
        lessonEvidence: nextEvidence,
      }).lessonEvidence,
      practiceDayKeys: [...new Set([...current.practiceDayKeys, ...practice.practiceDayKeys])],
    }));

    return { ...practice.result, evidence: mergedEvidence };
  }, [updateLearning]);

  const setWeeklyPracticeGoal = useCallback((goal: WeeklyPracticeGoal | null) => {
    const changedAt = Date.now();
    const weekKey = setGoalForCurrentWeek([], goal, changedAt)[0].effectiveWeekKey;
    const stamp = nextWriteStamp();
    updateLearning((current) => ({
      ...current,
      weeklyGoalChanges: setGoalForCurrentWeek(current.weeklyGoalChanges, goal, changedAt),
      fieldWrites: {
        ...current.fieldWrites,
        weeklyGoalChanges: { ...current.fieldWrites.weeklyGoalChanges, [weekKey]: stamp },
      },
    }));
  }, [nextWriteStamp, updateLearning]);

  const dismissLegacyProgress = useCallback(() => {
    const storage = getLearningStorage();
    if (!storage) {
      setLegacyProgressError('This choice could not be saved on this device. Nothing was removed.');
      return;
    }
    try {
      storage.setItem(legacyDecisionKey, 'dismissed');
    } catch {
      setLegacyProgressError('This choice could not be saved on this device. Nothing was removed.');
      return;
    }
    setLegacyProgressError(null);
    setLegacyProgressAvailable(false);
  }, [legacyDecisionKey]);

  const importLegacyProgress = useCallback(() => {
    const storage = getLearningStorage();
    if (!storage) {
      setLegacyProgressError('Progress could not be saved on this device. Nothing was removed.');
      return;
    }

    void withLearningStorageLocks(
      [LEARNING_STORAGE_KEY, storageKey],
      () => {
        let claimOwner: string | null;
        try {
          claimOwner = storage.getItem(LEGACY_IMPORT_OWNER_KEY);
        } catch {
          throw new Error('legacy-unsafe');
        }
        if (claimOwner && claimOwner !== storageScope) throw new Error('legacy-missing');
        const legacy = readStoredLearning(LEARNING_STORAGE_KEY, storage);
        if (legacy.kind !== 'found') {
          throw new Error(legacy.kind === 'missing' ? 'legacy-missing' : 'legacy-unsafe');
        }
        const destination = readStoredLearning(storageKey, storage);
        if (destination.kind === 'corrupt' || destination.kind === 'read-error') {
          throw new Error('destination-unsafe');
        }
        const durableCurrent = destination.kind === 'found'
          ? mergeConcurrentLearning(destination.value, learningRef.current)
          : learningRef.current;
        const merged = mergeLegacyLearning(durableCurrent, legacy.value);
        try {
          persistLegacyLearningImport(storage, {
            claimKey: LEGACY_IMPORT_OWNER_KEY,
            claimOwner: storageScope,
            decisionKey: legacyDecisionKey,
            destinationKey: storageKey,
            legacyKey: LEARNING_STORAGE_KEY,
            merged,
          });
          return { cleanupFailed: false, merged };
        } catch (error) {
          if (error instanceof LegacyLearningImportFailure && error.destinationPersisted) {
            return { cleanupFailed: true, merged };
          }
          throw new Error('import-not-persisted');
        }
      },
      { requireBrowserLock: Platform.OS === 'web' },
    )
      .then(({ cleanupFailed, merged }) => {
        canPersistRef.current = true;
        reconcileLearning(merged);
        setFocusedModuleId(null);
        setActiveLessonId(null);
        setActiveLessonMode('learn');
        setPersistenceState('available');
        setLegacyProgressError(
          cleanupFailed ? 'Progress was copied, but cleanup did not finish. Retry to complete the import safely.' : null,
        );
        setLegacyProgressAvailable(cleanupFailed);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        setLegacyProgressError(
          message === 'legacy-missing'
            ? 'The earlier progress is no longer available.'
            : message === 'destination-unsafe'
              ? 'Your account progress could not be read safely. Nothing was overwritten or removed.'
              : message === 'import-not-persisted'
                ? 'Progress could not be saved on this device. The earlier progress is still available.'
              : 'The earlier progress could not be read safely. Nothing was removed.',
        );
      });
  }, [legacyDecisionKey, reconcileLearning, storageKey, storageScope]);

  const value = useMemo<LearningContextValue>(
    () => ({
      language,
      languageId,
      languages,
      courses,
      enrolledCourse,
      currentModule: moduleNow,
      nextLesson: lessonNow,
      focusedModuleId,
      activeLessonId,
      activeLessonMode,
      progress,
      completedModuleIds,
      completedLessonIds,
      lessonEvidence,
      reviewItems,
      practiceDayKeys,
      practiceDaysThisWeek: rhythmSummary.practiceDaysThisWeek,
      weeklyPracticeGoal: rhythmSummary.activeGoal,
      weeklyGoalChanges,
      rhythmSummary,
      persistenceStatus: persistenceState,
      legacyProgressAvailable,
      legacyProgressError,
      setLanguage,
      switchCourse,
      startCourse,
      focusModule,
      openLesson,
      completeLesson,
      setWeeklyPracticeGoal,
      dismissLegacyProgress,
      importLegacyProgress,
    }),
    [
      activeLessonId,
      activeLessonMode,
      completeLesson,
      completedLessonIds,
      completedModuleIds,
      courses,
      dismissLegacyProgress,
      enrolledCourse,
      focusedModuleId,
      focusModule,
      importLegacyProgress,
      language,
      languageId,
      legacyProgressAvailable,
      legacyProgressError,
      lessonEvidence,
      lessonNow,
      moduleNow,
      openLesson,
      persistenceState,
      practiceDayKeys,
      progress,
      reviewItems,
      rhythmSummary,
      setLanguage,
      setWeeklyPracticeGoal,
      startCourse,
      switchCourse,
      weeklyGoalChanges,
    ],
  );

  return <LearningContext.Provider value={value}>{children}</LearningContext.Provider>;
}

export function useLearning() {
  const context = useContext(LearningContext);
  if (!context) throw new Error('useLearning must be used within LearningProvider');
  return context;
}
