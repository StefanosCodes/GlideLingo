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
  streakDays,
} from '@/constants/catalog';
import { mergeLegacyLearning, persistLegacyLearningImport } from '@/providers/learning-migration';

const STORAGE_KEY = 'glidelingo-learning';
const DEFAULT_LANGUAGE: LanguageId = 'el';

type StoredLearning = {
  languageId: LanguageId;
  enrolledByLanguage: Partial<Record<LanguageId, string>>;
  completedLessonIds: string[];
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
  completedLessonIds: string[];
  legacyProgressAvailable: boolean;
  legacyProgressError: string | null;
  setLanguage: (id: LanguageId) => void;
  startCourse: (courseId: string) => boolean;
  focusModule: (moduleId: string | null) => void;
  openLesson: (lessonId: string | null) => void;
  completeLesson: (lessonId: string) => void;
  dismissLegacyProgress: () => void;
  importLegacyProgress: () => void;
};

const LearningContext = createContext<LearningContextValue | null>(null);

function isLanguageId(value: string): value is LanguageId {
  return value === 'el' || value === 'es' || value === 'fr';
}

function readStored(storageKey: string): StoredLearning {
  const fallback: StoredLearning = {
    languageId: DEFAULT_LANGUAGE,
    enrolledByLanguage: {},
    completedLessonIds: [],
  };

  if (Platform.OS !== 'web') return fallback;

  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredLearning> & { completedModuleIds?: string[] };
    return {
      languageId: parsed.languageId && isLanguageId(parsed.languageId) ? parsed.languageId : DEFAULT_LANGUAGE,
      enrolledByLanguage: parsed.enrolledByLanguage ?? {},
      completedLessonIds: Array.isArray(parsed.completedLessonIds) ? parsed.completedLessonIds : [],
    };
  } catch {
    return fallback;
  }
}

function legacyProgressNeedsDecision(decisionKey: string) {
  if (Platform.OS !== 'web') return false;
  try {
    return !globalThis.localStorage?.getItem(decisionKey) && Boolean(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function LearningProvider({ children, storageScope }: PropsWithChildren<{ storageScope: string }>) {
  const storageKey = `${STORAGE_KEY}:${storageScope}`;
  const legacyDecisionKey = `${STORAGE_KEY}:legacy-decision:${storageScope}`;
  const [initial] = useState(() => readStored(storageKey));
  const [legacyProgressAvailable, setLegacyProgressAvailable] = useState(() =>
    legacyProgressNeedsDecision(legacyDecisionKey),
  );
  const [legacyProgressError, setLegacyProgressError] = useState<string | null>(null);
  const [languageId, setLanguageId] = useState<LanguageId>(initial.languageId);
  const [enrolledByLanguage, setEnrolledByLanguage] = useState<Partial<Record<LanguageId, string>>>(
    initial.enrolledByLanguage,
  );
  const [completedLessonIds, setCompletedLessonIds] = useState<string[]>(initial.completedLessonIds);
  const [focusedModuleId, setFocusedModuleId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      globalThis.localStorage?.setItem(
        storageKey,
        JSON.stringify({ languageId, enrolledByLanguage, completedLessonIds } satisfies StoredLearning),
      );
    } catch {
      // Session still works without persistence.
    }
  }, [completedLessonIds, enrolledByLanguage, languageId, storageKey]);

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
      setCompletedLessonIds((current) =>
        current.filter((id) => !course.modules.some((module) => module.lessons.some((lesson) => lesson.id === id))),
      );
      setFocusedModuleId(null);
      setActiveLessonId(null);
      return true;
    },
    [language.available, languageId],
  );

  const completeLesson = useCallback((lessonId: string) => {
    setCompletedLessonIds((current) => (current.includes(lessonId) ? current : [...current, lessonId]));
  }, []);

  const dismissLegacyProgress = useCallback(() => {
    setLegacyProgressError(null);
    setLegacyProgressAvailable(false);
    try {
      globalThis.localStorage?.setItem(legacyDecisionKey, 'dismissed');
    } catch {
      // The current session remains isolated even if the decision cannot persist.
    }
  }, [legacyDecisionKey]);

  const importLegacyProgress = useCallback(() => {
    if (Platform.OS !== 'web') return;

    const legacy = readStored(STORAGE_KEY);
    const merged = mergeLegacyLearning(
      { languageId, enrolledByLanguage, completedLessonIds },
      legacy,
    );
    const storage = globalThis.localStorage;
    if (!storage) {
      setLegacyProgressError('Progress could not be saved in this browser. Nothing was removed.');
      return;
    }

    try {
      persistLegacyLearningImport(storage, {
        decisionKey: legacyDecisionKey,
        destinationKey: storageKey,
        legacyKey: STORAGE_KEY,
        merged,
      });
    } catch {
      setLegacyProgressError('Progress could not be saved in this browser. Nothing was removed.');
      return;
    }

    setLanguageId(merged.languageId);
    setEnrolledByLanguage(merged.enrolledByLanguage);
    setCompletedLessonIds(merged.completedLessonIds);
    setFocusedModuleId(null);
    setActiveLessonId(null);
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
      progress,
      streakDays,
      completedModuleIds,
      completedLessonIds,
      legacyProgressAvailable,
      legacyProgressError,
      setLanguage,
      startCourse,
      focusModule,
      openLesson,
      completeLesson,
      dismissLegacyProgress,
      importLegacyProgress,
    }),
    [
      activeLessonId,
      completeLesson,
      completedLessonIds,
      completedModuleIds,
      courses,
      dismissLegacyProgress,
      enrolledCourse,
      focusedModuleId,
      focusModule,
      language,
      languageId,
      legacyProgressAvailable,
      legacyProgressError,
      lessonNow,
      moduleNow,
      openLesson,
      progress,
      importLegacyProgress,
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
