import type {
  CommunicationMode,
  EvidenceLevel,
  LessonCapability,
} from '@/features/learning-progress/evidence-policy';
import {
  bridgeCoursePackageLesson,
  type CompatibilityPresentation,
} from '@/features/course-catalog/compat/catalog-adapter';
import {
  enElGrCompatibilityPresentation,
  enElGrPackageSource,
} from '@/features/course-catalog/loader/course-packages.generated';

export type LanguageId = 'el' | 'es' | 'fr';

export type AudioClipId = string;

export type Language = {
  id: LanguageId;
  name: string;
  region: string;
  flag: string;
  code: string;
  available: boolean;
};

export type LessonBlock =
  | { type: 'heading'; text: string }
  | { type: 'prose'; text: string }
  | { type: 'example'; greek: string; gloss: string; audioId?: AudioClipId }
  | { type: 'callout'; text: string }
  | { type: 'listen'; label: string; audioId: AudioClipId }
  | { type: 'check'; prompt: string; choices: string[]; answer: string };

export type SittingBeat =
  | { type: 'hear'; greek: string; gloss: string; audioId: AudioClipId }
  | { type: 'notice'; text: string }
  | {
      type: 'check';
      prompt: string;
      choices: string[];
      answer: string;
      greek?: string;
      audioId?: AudioClipId;
      feedback?: string;
      evidence?: { capabilityId: string; level: EvidenceLevel };
    };

export type Lesson = {
  id: string;
  title: string;
  durationMin: number;
  contentStatus?: 'authored' | 'placeholder';
  blocks?: LessonBlock[];
  beats?: SittingBeat[];
  reviewBeats?: SittingBeat[];
  capability?: LessonCapability;
  introducedModes?: CommunicationMode[];
};

export type CourseModule = {
  id: string;
  title: string;
  canDo: string;
  lessons: Lesson[];
};

export type Course = {
  id: string;
  languageId: LanguageId;
  title: string;
  levelLabel: string;
  summary: string;
  canDos: string[];
  modules: CourseModule[];
};

export const languages: Language[] = [
  { id: 'el', name: 'Greek', region: 'Greece', flag: '🇬🇷', code: 'GR', available: true },
  { id: 'es', name: 'Spanish', region: 'Spain', flag: '🇪🇸', code: 'ES', available: false },
  { id: 'fr', name: 'French', region: 'France', flag: '🇫🇷', code: 'FR', available: false },
];

const compatibilityCatalog: Course[] = [
  {
    id: 'el-from-zero',
    languageId: 'el',
    title: 'Greek Foundations',
    levelLabel: 'A0–A1',
    summary: 'A clear path from the alphabet to first real conversations in Standard Modern Greek.',
    canDos: [
      'Greet someone and introduce yourself',
      'Order at a café',
      'Handle a basic travel exchange',
    ],
    modules: [
      {
        id: 'el-letters',
        title: 'Decode Greek letters',
        canDo: 'I can recognize core Greek letters and sound patterns.',
        lessons: [
          {
            id: 'el-letters-1',
            title: 'The sound of Greek',
            durationMin: 8,
          },
          { id: 'el-letters-2', title: 'The alphabet', durationMin: 10 },
          { id: 'el-letters-3', title: 'First words', durationMin: 8 },
        ],
      },
      {
        id: 'el-introduce',
        title: 'Introduce yourself',
        canDo: 'I can say my name and ask someone their name.',
        lessons: [
          { id: 'el-introduce-1', title: 'Hear a first meeting', durationMin: 8 },
          { id: 'el-introduce-2', title: 'Say your name', durationMin: 10 },
          { id: 'el-introduce-3', title: 'Short dialogue', durationMin: 8 },
        ],
      },
      {
        id: 'el-origin',
        title: 'Share where you are from',
        canDo: 'I can say where I am from and what languages I speak.',
        lessons: [
          { id: 'el-origin-1', title: 'Countries and languages', durationMin: 8 },
          { id: 'el-origin-2', title: 'Ask and answer', durationMin: 10 },
        ],
      },
      {
        id: 'el-personal',
        title: 'Exchange simple personal information',
        canDo: 'I can answer basic questions about myself.',
        lessons: [
          { id: 'el-personal-1', title: 'Age, work, and home', durationMin: 10 },
          { id: 'el-personal-2', title: 'A short exchange', durationMin: 8 },
        ],
      },
      {
        id: 'el-cafe',
        title: 'Order at a café',
        canDo: 'I can order a drink and thank the server.',
        lessons: [
          { id: 'el-cafe-1', title: 'Drinks and politeness', durationMin: 8 },
          { id: 'el-cafe-2', title: 'Place an order', durationMin: 12 },
        ],
      },
      {
        id: 'el-numbers',
        title: 'Numbers, prices, and time',
        canDo: 'I can understand simple prices and times of day.',
        lessons: [
          { id: 'el-numbers-1', title: 'Numbers you will hear', durationMin: 10 },
          { id: 'el-numbers-2', title: 'Ask the price', durationMin: 8 },
        ],
      },
      {
        id: 'el-directions',
        title: 'Ask where something is',
        canDo: 'I can ask for a place and follow a short direction.',
        lessons: [
          { id: 'el-directions-1', title: 'Places around you', durationMin: 8 },
          { id: 'el-directions-2', title: 'Follow a direction', durationMin: 10 },
        ],
      },
      {
        id: 'el-family',
        title: 'Talk about family',
        canDo: 'I can name familiar people and how they relate to me.',
        lessons: [
          { id: 'el-family-1', title: 'People you know', durationMin: 8 },
          { id: 'el-family-2', title: 'A short description', durationMin: 10 },
        ],
      },
      {
        id: 'el-routine',
        title: 'Describe a daily routine',
        canDo: 'I can say what I do in a simple day.',
        lessons: [
          { id: 'el-routine-1', title: 'A simple day', durationMin: 10 },
          { id: 'el-routine-2', title: 'Tell it in order', durationMin: 8 },
        ],
      },
      {
        id: 'el-shop',
        title: 'Buy something in a shop',
        canDo: 'I can ask for an item and understand a simple price.',
        lessons: [
          { id: 'el-shop-1', title: 'What you need', durationMin: 8 },
          { id: 'el-shop-2', title: 'Pay and leave', durationMin: 10 },
        ],
      },
      {
        id: 'el-plan',
        title: 'Make a simple plan',
        canDo: 'I can suggest meeting and respond to an invitation.',
        lessons: [
          { id: 'el-plan-1', title: 'Suggest a time', durationMin: 8 },
          { id: 'el-plan-2', title: 'Accept or decline', durationMin: 8 },
        ],
      },
      {
        id: 'el-travel',
        title: 'Handle a basic travel interaction',
        canDo: 'I can manage a short lodging or travel exchange.',
        lessons: [
          { id: 'el-travel-1', title: 'At the desk', durationMin: 10 },
          { id: 'el-travel-2', title: 'Close politely', durationMin: 8 },
        ],
      },
    ],
  },
];

export const courses = bridgeCoursePackageLesson(
  compatibilityCatalog,
  enElGrPackageSource,
  enElGrCompatibilityPresentation as CompatibilityPresentation,
);

export function getLanguage(id: LanguageId) {
  const language = languages.find((item) => item.id === id);
  if (!language) throw new Error(`Unknown language: ${id}`);
  return language;
}

export function getCoursesForLanguage(languageId: LanguageId) {
  return courses.filter((course) => course.languageId === languageId);
}

export function getCourse(id: string) {
  return courses.find((course) => course.id === id) ?? null;
}

export function getModule(course: Course, moduleId: string) {
  return course.modules.find((module) => module.id === moduleId) ?? null;
}

export function getLesson(course: Course, lessonId: string) {
  for (const module of course.modules) {
    const lesson = module.lessons.find((item) => item.id === lessonId);
    if (lesson) return { module, lesson };
  }
  return null;
}

export function findLesson(lessonId: string) {
  for (const course of courses) {
    const found = getLesson(course, lessonId);
    if (found) return { course, ...found };
  }
  return null;
}

export function isLessonComplete(lessonId: string, completedLessonIds: string[]) {
  return completedLessonIds.includes(lessonId);
}

export function isLessonAvailable(lesson: Lesson) {
  return lesson.contentStatus !== 'placeholder';
}

export function getAvailableLesson(course: Course, lessonId: string) {
  const found = getLesson(course, lessonId);
  return found && isLessonAvailable(found.lesson) ? found : null;
}

export function availableLessonsForModule(module: CourseModule) {
  return module.lessons.filter(isLessonAvailable);
}

export function availableModulesForCourse(course: Course) {
  return course.modules.filter((module) => availableLessonsForModule(module).length > 0);
}

export function isModuleComplete(module: CourseModule, completedLessonIds: string[]) {
  const availableLessons = availableLessonsForModule(module);
  return availableLessons.length > 0 && availableLessons.every((lesson) => completedLessonIds.includes(lesson.id));
}

export function completedModuleIdsFor(course: Course, completedLessonIds: string[]) {
  return course.modules.filter((module) => isModuleComplete(module, completedLessonIds)).map((module) => module.id);
}

export function courseProgress(course: Course, completedLessonIds: string[]) {
  const total = course.modules.reduce(
    (count, module) => count + availableLessonsForModule(module).length,
    0,
  );
  if (total === 0) return 0;
  const done = course.modules.reduce(
    (count, module) => count + module.lessons.filter(
      (lesson) => isLessonAvailable(lesson) && completedLessonIds.includes(lesson.id),
    ).length,
    0,
  );
  return done / total;
}

export function currentModule(course: Course, completedLessonIds: string[]) {
  return course.modules.find(
    (module) => availableLessonsForModule(module).length > 0 && !isModuleComplete(module, completedLessonIds),
  ) ?? null;
}

export function nextLesson(course: Course, completedLessonIds: string[]) {
  for (const module of course.modules) {
    const lesson = module.lessons.find(
      (item) => isLessonAvailable(item) && !completedLessonIds.includes(item.id),
    );
    if (lesson) return { module, lesson };
  }
  return null;
}

export type ModuleStatus = 'complete' | 'current' | 'upcoming' | 'unavailable';

export function moduleStatus(course: Course, moduleId: string, completedLessonIds: string[]): ModuleStatus {
  const module = getModule(course, moduleId);
  if (!module) return 'upcoming';
  if (availableLessonsForModule(module).length === 0) return 'unavailable';
  if (isModuleComplete(module, completedLessonIds)) return 'complete';
  const current = currentModule(course, completedLessonIds);
  if (current?.id === moduleId) return 'current';
  return 'upcoming';
}
