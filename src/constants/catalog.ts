export type LanguageId = 'el' | 'es' | 'fr';

export type Language = {
  id: LanguageId;
  name: string;
  region: string;
  flag: string;
  code: string;
  available: boolean;
};

export type Lesson = {
  id: string;
  title: string;
  durationMin: number;
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

export const courses: Course[] = [
  {
    id: 'el-from-zero',
    languageId: 'el',
    title: 'Greek from zero',
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
          { id: 'el-letters-1', title: 'The sound of Greek', durationMin: 8 },
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

export const streakDays = 7;

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

export function courseProgress(course: Course, completedModuleIds: string[]) {
  const done = course.modules.filter((module) => completedModuleIds.includes(module.id)).length;
  return course.modules.length === 0 ? 0 : done / course.modules.length;
}

export function currentModule(course: Course, completedModuleIds: string[]) {
  return course.modules.find((module) => !completedModuleIds.includes(module.id)) ?? null;
}

export function nextLesson(course: Course, completedModuleIds: string[]) {
  const module = currentModule(course, completedModuleIds);
  if (!module) return null;
  return { module, lesson: module.lessons[0] ?? null };
}

export type ModuleStatus = 'complete' | 'current' | 'upcoming';

export function moduleStatus(course: Course, moduleId: string, completedModuleIds: string[]): ModuleStatus {
  if (completedModuleIds.includes(moduleId)) return 'complete';
  const current = currentModule(course, completedModuleIds);
  if (current?.id === moduleId) return 'current';
  return 'upcoming';
}
