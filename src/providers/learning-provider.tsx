import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

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
  LEARNING_STORAGE_VERSION,
  readStoredLearning,
  type LearningPersistenceStatus,
  writeStoredLearning,
} from '@/providers/learning-storage';

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
  setLanguage: (id: LanguageId) => void;
  switchCourse: (courseId: string) => boolean;
  startCourse: (courseId: string) => boolean;
  focusModule: (moduleId: string | null) => void;
  openLesson: (lessonId: string | null, mode?: LessonMode) => void;
  completeLesson: (completion: LessonCompletionInput) => PracticeCompletionResult;
  setWeeklyPracticeGoal: (goal: WeeklyPracticeGoal | null) => void;
};

const LearningContext = createContext<LearningContextValue | null>(null);

export function LearningProvider({ children }: PropsWithChildren) {
  const [languageId, setLanguageId] = useState<LanguageId>('el');
  const [enrolledByLanguage, setEnrolledByLanguage] = useState<Partial<Record<LanguageId, string>>>({});
  const [completedLessonIds, setCompletedLessonIds] = useState<string[]>([]);
  const [lessonEvidence, setLessonEvidence] = useState<LessonEvidenceRecord[]>([]);
  const [practiceDayKeys, setPracticeDayKeys] = useState<string[]>([]);
  const [weeklyGoalChanges, setWeeklyGoalChanges] = useState<WeeklyGoalChange[]>([]);
  const [persistenceStatus, setPersistenceStatus] = useState<LearningPersistenceStatus>('available');
  const [hasHydrated, setHasHydrated] = useState(false);
  const [focusedModuleId, setFocusedModuleId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [activeLessonMode, setActiveLessonMode] = useState<LessonMode>('learn');

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const stored = readStoredLearning();
      setLanguageId(stored.value.languageId);
      setEnrolledByLanguage(stored.value.enrolledByLanguage);
      setCompletedLessonIds(stored.value.completedLessonIds);
      setLessonEvidence(stored.value.lessonEvidence);
      setPracticeDayKeys(stored.value.practiceDayKeys);
      setWeeklyGoalChanges(stored.value.weeklyGoalChanges);
      setPersistenceStatus(stored.status);
      setHasHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    const saved = writeStoredLearning({
      version: LEARNING_STORAGE_VERSION,
      languageId,
      enrolledByLanguage,
      completedLessonIds,
      lessonEvidence,
      practiceDayKeys,
      weeklyGoalChanges,
    });
    if (!saved) queueMicrotask(() => setPersistenceStatus('unavailable'));
  }, [completedLessonIds, enrolledByLanguage, hasHydrated, languageId, lessonEvidence, practiceDayKeys, weeklyGoalChanges]);

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
  const reviewItems = useMemo(() => reviewItemsFor(lessonEvidence), [lessonEvidence]);
  const rhythmSummary = useMemo(
    () => summarizeRhythm(practiceDayKeys, weeklyGoalChanges),
    [practiceDayKeys, weeklyGoalChanges],
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
        const found = enrolledCourse.modules.find((m) => m.lessons.some((l) => l.id === lessonId));
        if (found) {
          setFocusedModuleId(found.id);
        }
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

  const completeLesson = useCallback(
    (completion: LessonCompletionInput) => {
      const completedAt = Date.now();
      const practice = recordMeaningfulPractice(practiceDayKeys, weeklyGoalChanges, completedAt);
      setCompletedLessonIds((current) =>
        current.includes(completion.lessonId) ? current : [...current, completion.lessonId],
      );
      setLessonEvidence((current) => {
        const previous = current.find((record) => record.lessonId === completion.lessonId);
        const incoming = summarizeLessonCompletion(completion, completedAt, previous);
        return upsertLessonEvidence(current, incoming);
      });
      setPracticeDayKeys(practice.practiceDayKeys);
      return practice.result;
    },
    [practiceDayKeys, weeklyGoalChanges],
  );

  const setWeeklyPracticeGoal = useCallback((goal: WeeklyPracticeGoal | null) => {
    setWeeklyGoalChanges((current) => setGoalForCurrentWeek(current, goal));
  }, []);

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
      persistenceStatus,
      setLanguage,
      switchCourse,
      startCourse,
      focusModule,
      openLesson,
      completeLesson,
      setWeeklyPracticeGoal,
    }),
    [
      activeLessonId,
      activeLessonMode,
      completeLesson,
      completedLessonIds,
      completedModuleIds,
      courses,
      enrolledCourse,
      focusedModuleId,
      focusModule,
      language,
      languageId,
      lessonEvidence,
      lessonNow,
      moduleNow,
      openLesson,
      persistenceStatus,
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
