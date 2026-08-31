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

import {
  type Course,
  type Language,
  type LanguageId,
  completedModuleIdsFor,
  courseProgress,
  currentModule,
  getCourse,
  getCoursesForLanguage,
  getLanguage,
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
import { mergeLegacyLearning, persistLegacyLearningImport } from '@/providers/learning-migration';
import {
  getLearningStorage,
  LEARNING_STORAGE_KEY,
  LEARNING_STORAGE_VERSION,
  learningStorageKey,
  legacyDecisionStorageKey,
  legacyScopedLearningStorageKey,
  readStoredLearning,
  type LearningPersistenceStatus,
  type StoredLearningV2,
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
  try {
    if (storage.getItem(legacyDecisionStorageKey(storageScope))) return false;
  } catch {
    return false;
  }
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
  const [legacyProgressAvailable, setLegacyProgressAvailable] = useState(() =>
    legacyProgressNeedsDecision(storageScope),
  );
  const [legacyProgressError, setLegacyProgressError] = useState<string | null>(null);
  const [languageId, setLanguageId] = useState<LanguageId>(initial.value.languageId);
  const [enrolledByLanguage, setEnrolledByLanguage] = useState<Partial<Record<LanguageId, string>>>(
    initial.value.enrolledByLanguage,
  );
  const [completedLessonIds, setCompletedLessonIds] = useState<string[]>(initial.value.completedLessonIds);
  const [lessonEvidence, setLessonEvidence] = useState<LessonEvidenceRecord[]>(initial.value.lessonEvidence);
  const lessonEvidenceRef = useRef(lessonEvidence);
  const [practiceDayKeys, setPracticeDayKeys] = useState<string[]>(initial.value.practiceDayKeys);
  const practiceDayKeysRef = useRef(practiceDayKeys);
  const [weeklyGoalChanges, setWeeklyGoalChanges] = useState<WeeklyGoalChange[]>(initial.value.weeklyGoalChanges);
  const weeklyGoalChangesRef = useRef(weeklyGoalChanges);
  const [persistenceState, setPersistenceState] = useState<LearningPersistenceStatus>(initial.status);
  const [focusedModuleId, setFocusedModuleId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [activeLessonMode, setActiveLessonMode] = useState<LessonMode>('learn');
  const now = useLearningClock(lessonEvidence);

  useEffect(() => {
    lessonEvidenceRef.current = lessonEvidence;
  }, [lessonEvidence]);

  useEffect(() => {
    practiceDayKeysRef.current = practiceDayKeys;
  }, [practiceDayKeys]);

  useEffect(() => {
    weeklyGoalChangesRef.current = weeklyGoalChanges;
  }, [weeklyGoalChanges]);

  useEffect(() => {
    if (!canPersistRef.current) return;
    const saved = writeStoredLearning(storageKey, {
      version: LEARNING_STORAGE_VERSION,
      languageId,
      enrolledByLanguage,
      completedLessonIds,
      lessonEvidence,
      practiceDayKeys,
      weeklyGoalChanges,
    });
    if (!saved) {
      canPersistRef.current = false;
      queueMicrotask(() => setPersistenceState('unavailable'));
    }
  }, [completedLessonIds, enrolledByLanguage, languageId, lessonEvidence, practiceDayKeys, storageKey, weeklyGoalChanges]);

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
    setLanguageId(id);
  }, []);

  const switchCourse = useCallback(
    (courseId: string) => {
      const course = getCourse(courseId);
      if (!course || !getLanguage(course.languageId).available) return false;
      setActiveLessonId(null);
      setActiveLessonMode('learn');
      setFocusedModuleId(null);
      setLanguageId(course.languageId);
      return enrolledByLanguage[course.languageId] === course.id;
    },
    [enrolledByLanguage],
  );

  const focusModule = useCallback((moduleId: string | null) => {
    setActiveLessonId(null);
    setActiveLessonMode('learn');
    setFocusedModuleId(moduleId);
  }, []);

  const openLesson = useCallback(
    (lessonId: string | null, mode: LessonMode = 'learn') => {
      setActiveLessonId(lessonId);
      setActiveLessonMode(lessonId ? mode : 'learn');
      if (lessonId && enrolledCourse) {
        const found = enrolledCourse.modules.find((module) => module.lessons.some((lesson) => lesson.id === lessonId));
        if (found) setFocusedModuleId(found.id);
      }
    },
    [enrolledCourse],
  );

  const startCourse = useCallback(
    (courseId: string) => {
      const course = getCourse(courseId);
      if (!course || course.languageId !== languageId || !language.available) return false;
      setEnrolledByLanguage((current) => ({ ...current, [languageId]: course.id }));
      setFocusedModuleId(null);
      setActiveLessonId(null);
      setActiveLessonMode('learn');
      return true;
    },
    [language.available, languageId],
  );

  const completeLesson = useCallback((completion: LessonCompletionInput) => {
    const completedAt = Date.now();
    const currentPracticeDays = practiceDayKeysRef.current;
    const currentGoalChanges = weeklyGoalChangesRef.current;
    const practice = recordMeaningfulPractice(currentPracticeDays, currentGoalChanges, completedAt);
    const previous = lessonEvidenceRef.current.find((record) => record.lessonId === completion.lessonId);
    const incoming = summarizeLessonCompletion(completion, completedAt, previous);
    const nextEvidence = upsertLessonEvidence(lessonEvidenceRef.current, incoming);
    const mergedEvidence = nextEvidence.find((record) => record.lessonId === completion.lessonId) ?? incoming;

    lessonEvidenceRef.current = nextEvidence;
    practiceDayKeysRef.current = practice.practiceDayKeys;
    setCompletedLessonIds((current) =>
      current.includes(completion.lessonId) ? current : [...current, completion.lessonId],
    );
    setLessonEvidence(nextEvidence);
    setPracticeDayKeys(practice.practiceDayKeys);

    return { ...practice.result, evidence: mergedEvidence };
  }, []);

  const setWeeklyPracticeGoal = useCallback((goal: WeeklyPracticeGoal | null) => {
    const next = setGoalForCurrentWeek(weeklyGoalChangesRef.current, goal, Date.now());
    weeklyGoalChangesRef.current = next;
    setWeeklyGoalChanges(next);
  }, []);

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

    const legacy = readStoredLearning(LEARNING_STORAGE_KEY, storage);
    if (legacy.kind !== 'found') {
      setLegacyProgressError(
        legacy.kind === 'missing'
          ? 'The earlier progress is no longer available.'
          : 'The earlier progress could not be read safely. Nothing was removed.',
      );
      return;
    }

    const destination = readStoredLearning(storageKey, storage);
    if (destination.kind === 'corrupt' || destination.kind === 'read-error') {
      setLegacyProgressError('Your account progress could not be read safely. Nothing was overwritten or removed.');
      return;
    }

    const currentSnapshot: StoredLearningV2 = {
      version: LEARNING_STORAGE_VERSION,
      languageId,
      enrolledByLanguage,
      completedLessonIds,
      lessonEvidence: lessonEvidenceRef.current,
      practiceDayKeys: practiceDayKeysRef.current,
      weeklyGoalChanges: weeklyGoalChangesRef.current,
    };
    const durableCurrent = destination.kind === 'found'
      ? mergeLegacyLearning(currentSnapshot, destination.value)
      : currentSnapshot;
    const merged = mergeLegacyLearning(durableCurrent, legacy.value);

    try {
      persistLegacyLearningImport(storage, {
        decisionKey: legacyDecisionKey,
        destinationKey: storageKey,
        legacyKey: LEARNING_STORAGE_KEY,
        merged,
      });
    } catch {
      setLegacyProgressError('Progress was copied, but cleanup did not finish. Retry to complete the import safely.');
      return;
    }

    canPersistRef.current = true;
    lessonEvidenceRef.current = merged.lessonEvidence;
    practiceDayKeysRef.current = merged.practiceDayKeys;
    weeklyGoalChangesRef.current = merged.weeklyGoalChanges;
    setLanguageId(merged.languageId);
    setEnrolledByLanguage(merged.enrolledByLanguage);
    setCompletedLessonIds(merged.completedLessonIds);
    setLessonEvidence(merged.lessonEvidence);
    setPracticeDayKeys(merged.practiceDayKeys);
    setWeeklyGoalChanges(merged.weeklyGoalChanges);
    setFocusedModuleId(null);
    setActiveLessonId(null);
    setActiveLessonMode('learn');
    setPersistenceState('available');
    setLegacyProgressError(null);
    setLegacyProgressAvailable(false);
  }, [completedLessonIds, enrolledByLanguage, languageId, legacyDecisionKey, storageKey]);

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
