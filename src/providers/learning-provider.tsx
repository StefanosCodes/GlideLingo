import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import {
  type Course,
  type Language,
  type LanguageId,
  courseProgress,
  currentModule,
  getCourse,
  getCoursesForLanguage,
  getLanguage,
  languages,
  nextLesson,
  streakDays,
} from '@/constants/catalog';

const STORAGE_KEY = 'glidelingo-learning';
const DEFAULT_LANGUAGE: LanguageId = 'el';

type StoredLearning = {
  languageId: LanguageId;
  enrolledByLanguage: Partial<Record<LanguageId, string>>;
  completedModuleIds: string[];
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
  progress: number;
  streakDays: number;
  completedModuleIds: string[];
  setLanguage: (id: LanguageId) => void;
  startCourse: (courseId: string) => boolean;
  focusModule: (moduleId: string | null) => void;
  openLesson: (lessonId: string | null) => void;
};

const LearningContext = createContext<LearningContextValue | null>(null);

function isLanguageId(value: string): value is LanguageId {
  return value === 'el' || value === 'es' || value === 'fr';
}

function readStored(): StoredLearning {
  const fallback: StoredLearning = {
    languageId: DEFAULT_LANGUAGE,
    enrolledByLanguage: {},
    completedModuleIds: [],
  };

  if (Platform.OS !== 'web') return fallback;

  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredLearning>;
    return {
      languageId: parsed.languageId && isLanguageId(parsed.languageId) ? parsed.languageId : DEFAULT_LANGUAGE,
      enrolledByLanguage: parsed.enrolledByLanguage ?? {},
      completedModuleIds: Array.isArray(parsed.completedModuleIds) ? parsed.completedModuleIds : [],
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
  const [completedModuleIds, setCompletedModuleIds] = useState<string[]>(initial.completedModuleIds);
  const [focusedModuleId, setFocusedModuleId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      globalThis.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ languageId, enrolledByLanguage, completedModuleIds } satisfies StoredLearning),
      );
    } catch {
      // Session still works without persistence.
    }
  }, [completedModuleIds, enrolledByLanguage, languageId]);

  const language = getLanguage(languageId);
  const courses = getCoursesForLanguage(languageId);
  const enrolledCourse = getCourse(enrolledByLanguage[languageId] ?? '') ?? null;
  const moduleNow = enrolledCourse ? currentModule(enrolledCourse, completedModuleIds) : null;
  const lessonNow = enrolledCourse ? nextLesson(enrolledCourse, completedModuleIds) : null;
  const progress = enrolledCourse ? courseProgress(enrolledCourse, completedModuleIds) : 0;

  const setLanguage = useCallback((id: LanguageId) => {
    setActiveLessonId(null);
    setFocusedModuleId(null);
    setLanguageId(id);
  }, []);

  const focusModule = useCallback((moduleId: string | null) => {
    setActiveLessonId(null);
    setFocusedModuleId(moduleId);
  }, []);

  const openLesson = useCallback(
    (lessonId: string | null) => {
      setActiveLessonId(lessonId);
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
      setCompletedModuleIds((current) => current.filter((id) => !course.modules.some((module) => module.id === id)));
      setFocusedModuleId(null);
      setActiveLessonId(null);
      return true;
    },
    [language.available, languageId],
  );

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
      progress,
      streakDays,
      completedModuleIds,
      setLanguage,
      startCourse,
      focusModule,
      openLesson,
    }),
    [
      activeLessonId,
      completedModuleIds,
      courses,
      enrolledCourse,
      focusedModuleId,
      focusModule,
      language,
      languageId,
      lessonNow,
      moduleNow,
      openLesson,
      progress,
      setLanguage,
      startCourse,
    ],
  );

  return <LearningContext.Provider value={value}>{children}</LearningContext.Provider>;
}

export function useLearning() {
  const context = useContext(LearningContext);
  if (!context) throw new Error('useLearning must be used within LearningProvider');
  return context;
}
