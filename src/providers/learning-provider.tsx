import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
  getLanguage,
  languages,
  nextLesson,
} from '@/constants/catalog';
import {
  isLessonEvidenceRecord,
  type LessonCompletionInput,
  type LessonEvidenceRecord,
  type LessonMode,
  localDayKey,
  practiceDaysInCurrentWeek,
  reviewItemsFor,
  summarizeLessonCompletion,
  type WeeklyPracticeGoal,
  upsertLessonEvidence,
} from '@/features/learning-progress/evidence-policy';

const STORAGE_KEY = 'glidelingo-learning';
const DEFAULT_LANGUAGE: LanguageId = 'el';

type StoredLearning = {
  languageId: LanguageId;
  enrolledByLanguage: Partial<Record<LanguageId, string>>;
  completedLessonIds: string[];
  lessonEvidence: LessonEvidenceRecord[];
  practiceDayKeys: string[];
  weeklyPracticeGoal: WeeklyPracticeGoal | null;
};

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
  practiceDaysThisWeek: number;
  weeklyPracticeGoal: WeeklyPracticeGoal | null;
  setLanguage: (id: LanguageId) => void;
  switchCourse: (courseId: string) => boolean;
  startCourse: (courseId: string) => boolean;
  focusModule: (moduleId: string | null) => void;
  openLesson: (lessonId: string | null, mode?: LessonMode) => void;
  completeLesson: (completion: LessonCompletionInput) => void;
  setWeeklyPracticeGoal: (goal: WeeklyPracticeGoal | null) => void;
};

const LearningContext = createContext<LearningContextValue | null>(null);

function isLanguageId(value: string): value is LanguageId {
  return value === 'el' || value === 'es' || value === 'fr';
}

function readStored(): StoredLearning {
  const fallback: StoredLearning = {
    languageId: DEFAULT_LANGUAGE,
    enrolledByLanguage: {},
    completedLessonIds: [],
    lessonEvidence: [],
    practiceDayKeys: [],
    weeklyPracticeGoal: null,
  };

  if (Platform.OS !== 'web') return fallback;

  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredLearning> & { completedModuleIds?: string[] };
    return {
      languageId: parsed.languageId && isLanguageId(parsed.languageId) ? parsed.languageId : DEFAULT_LANGUAGE,
      enrolledByLanguage: parsed.enrolledByLanguage ?? {},
      completedLessonIds: Array.isArray(parsed.completedLessonIds) ? parsed.completedLessonIds : [],
      lessonEvidence: Array.isArray(parsed.lessonEvidence)
        ? parsed.lessonEvidence.filter(isLessonEvidenceRecord)
        : [],
      practiceDayKeys: Array.isArray(parsed.practiceDayKeys)
        ? parsed.practiceDayKeys.filter((key): key is string => typeof key === 'string')
        : [],
      weeklyPracticeGoal:
        parsed.weeklyPracticeGoal === 2 || parsed.weeklyPracticeGoal === 3 || parsed.weeklyPracticeGoal === 5
          ? parsed.weeklyPracticeGoal
          : null,
    };
  } catch {
    return fallback;
  }
}

export function LearningProvider({ children }: PropsWithChildren) {
  const [initial] = useState(() => readStored());
  const [languageId, setLanguageId] = useState<LanguageId>(initial.languageId);
  const [enrolledByLanguage, setEnrolledByLanguage] = useState<Partial<Record<LanguageId, string>>>(
    initial.enrolledByLanguage,
  );
  const [completedLessonIds, setCompletedLessonIds] = useState<string[]>(initial.completedLessonIds);
  const [lessonEvidence, setLessonEvidence] = useState<LessonEvidenceRecord[]>(initial.lessonEvidence);
  const [practiceDayKeys, setPracticeDayKeys] = useState<string[]>(initial.practiceDayKeys);
  const [weeklyPracticeGoal, setWeeklyPracticeGoal] = useState<WeeklyPracticeGoal | null>(initial.weeklyPracticeGoal);
  const [focusedModuleId, setFocusedModuleId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [activeLessonMode, setActiveLessonMode] = useState<LessonMode>('learn');

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      globalThis.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify({
          languageId,
          enrolledByLanguage,
          completedLessonIds,
          lessonEvidence,
          practiceDayKeys,
          weeklyPracticeGoal,
        } satisfies StoredLearning),
      );
    } catch {
      // Session still works without persistence.
    }
  }, [completedLessonIds, enrolledByLanguage, languageId, lessonEvidence, practiceDayKeys, weeklyPracticeGoal]);

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
  const practiceDaysThisWeek = useMemo(() => practiceDaysInCurrentWeek(practiceDayKeys), [practiceDayKeys]);

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

  const completeLesson = useCallback((completion: LessonCompletionInput) => {
    const completedAt = Date.now();
    setCompletedLessonIds((current) =>
      current.includes(completion.lessonId) ? current : [...current, completion.lessonId],
    );
    setLessonEvidence((current) => {
      const previous = current.find((record) => record.lessonId === completion.lessonId);
      const incoming = summarizeLessonCompletion(completion, completedAt, previous);
      return upsertLessonEvidence(current, incoming);
    });
    setPracticeDayKeys((current) => {
      const today = localDayKey(completedAt);
      return current.includes(today) ? current : [...current, today];
    });
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
      practiceDaysThisWeek,
      weeklyPracticeGoal,
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
      practiceDaysThisWeek,
      progress,
      reviewItems,
      setLanguage,
      startCourse,
      switchCourse,
      weeklyPracticeGoal,
    ],
  );

  return <LearningContext.Provider value={value}>{children}</LearningContext.Provider>;
}

export function useLearning() {
  const context = useContext(LearningContext);
  if (!context) throw new Error('useLearning must be used within LearningProvider');
  return context;
}
