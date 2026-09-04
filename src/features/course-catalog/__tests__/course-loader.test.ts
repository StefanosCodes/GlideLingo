import { expect, test } from '@jest/globals';

import {
  availableLessonsForModule,
  availableModulesForCourse,
  courseProgress,
  courses,
  currentModule,
  findLesson,
  isLessonAvailable,
  moduleStatus,
  nextLesson,
} from '@/constants/catalog';
import { phrasesForCourse } from '@/constants/reference-content';
import {
  CoursePackageLoadError,
  loadCoursePackage,
} from '@/features/course-catalog/loader/course-loader';
import { enElGrPackageSource } from '@/features/course-catalog/loader/course-packages.generated';
import {
  getCourseAudioClip,
  getCourseLesson,
  orderedLessons,
  orderedMissions,
  orderedModules,
} from '@/features/course-catalog/selectors/course-selectors';

test('production loading hides the draft Greek migration package', () => {
  expect(loadCoursePackage(enElGrPackageSource)).toBeNull();
});

test('the explicit migration policy builds deterministic lookup maps and orders', () => {
  const loaded = loadCoursePackage(enElGrPackageSource, { publicationPolicy: 'include-drafts' });
  expect(loaded).not.toBeNull();
  if (!loaded) return;

  expect(orderedModules(loaded).map((module) => module.id)).toEqual(['el-letters']);
  expect(orderedMissions(loaded, 'el-letters').map((mission) => mission.id)).toEqual([
    'el-letters-sound-map',
  ]);
  expect(orderedLessons(loaded, 'el-letters-sound-map').map((lesson) => lesson.id)).toEqual([
    'el-letters-1',
  ]);
  expect(getCourseLesson(loaded, 'el-letters-1')?.module.id).toBe('el-letters');
  expect(getCourseAudioClip(loaded, 'el-letter-alpha')?.lessonId).toBe('el-letters-1');
});

test('the runtime boundary rejects an unsupported renderer with its exact package path', () => {
  const source = structuredClone(enElGrPackageSource);
  const mission = source.missions[0] as {
    lessons: { activities: { rendererType: string }[] }[];
  };
  mission.lessons[0].activities[0].rendererType = 'greek-only-card';

  expect(() => loadCoursePackage(source, { publicationPolicy: 'include-drafts' })).toThrow(
    new CoursePackageLoadError(
      'missions/0/lessons/0/activities/0/rendererType',
      'unsupported renderer type "greek-only-card"',
    ),
  );
});

test('the loader rejects duplicate IDs and unresolved references before exposing lookups', () => {
  const duplicateSource = structuredClone(enElGrPackageSource);
  const duplicateMission = duplicateSource.missions[0] as {
    lessons: { activities: { id: string }[] }[];
  };
  duplicateMission.lessons[0].activities[1].id = duplicateMission.lessons[0].activities[0].id;
  expect(() => loadCoursePackage(duplicateSource, { publicationPolicy: 'include-drafts' })).toThrow(
    /missions\/0\/lessons\/0\/activities\/1\/id: duplicate ID "el-alpha-hear"/,
  );

  const missingReferenceSource = structuredClone(enElGrPackageSource);
  const missingReferenceMission = missingReferenceSource.missions[0] as {
    lessons: { activities: { audioId?: string }[] }[];
  };
  missingReferenceMission.lessons[0].activities[0].audioId = 'missing-audio';
  expect(() => loadCoursePackage(missingReferenceSource, { publicationPolicy: 'include-drafts' })).toThrow(
    'missions/0/lessons/0/activities/0/audioId: audio clip "missing-audio" does not exist',
  );
});

test('the compatibility catalog renders the current Greek lesson from package activities', () => {
  const found = findLesson('el-letters-1');
  expect(found?.lesson.title).toBe('The sound of Greek');
  expect(found?.lesson.durationMin).toBe(8);
  expect(found?.lesson.beats).toEqual([
    { type: 'hear', greek: 'α · Α', gloss: 'like the a in father', audioId: 'el-letter-alpha' },
    { type: 'hear', greek: 'ε · Ε', gloss: 'like the e in red', audioId: 'el-letter-epsilon' },
    { type: 'hear', greek: 'ι · Ι', gloss: 'like the ee in see', audioId: 'el-letter-iota' },
    {
      type: 'notice',
      text: 'η and υ also sound like ι in Standard Modern Greek. Same sound, different letters. Treat them as one for now.',
    },
    { type: 'hear', greek: 'καλημέρα', gloss: 'kalimera — good morning', audioId: 'el-kalimera' },
    expect.objectContaining({ type: 'check', answer: 'α', evidence: { capabilityId: 'el-script-vowels-a-e-i', level: 'practice' } }),
    expect.objectContaining({ type: 'check', greek: 'να', answer: 'na', evidence: { capabilityId: 'el-script-vowels-a-e-i', level: 'checkpoint' } }),
  ]);
  expect(found?.lesson.reviewBeats).toEqual([
    {
      type: 'notice',
      text: 'No model this time. Read the new syllable from the sound pattern you practiced.',
    },
    expect.objectContaining({ type: 'check', greek: 'με', answer: 'me' }),
  ]);
  expect(found?.lesson.capability).toEqual({
    id: 'el-script-vowels-a-e-i',
    canDo: 'I can recognize α, ε, and ι in a new Greek syllable.',
    mode: 'reading',
  });
});

test('draft placeholder metadata never becomes the next lesson or inflates available progress', () => {
  const course = courses[0];
  const authoredLesson = findLesson('el-letters-1')?.lesson;
  const placeholderLesson = findLesson('el-letters-2')?.lesson;

  expect(authoredLesson && isLessonAvailable(authoredLesson)).toBe(true);
  expect(placeholderLesson && isLessonAvailable(placeholderLesson)).toBe(false);
  expect(nextLesson(course, [])?.lesson.id).toBe('el-letters-1');

  const afterAuthoredLesson = ['el-letters-1'];
  expect(nextLesson(course, afterAuthoredLesson)).toBeNull();
  expect(currentModule(course, afterAuthoredLesson)).toBeNull();
  expect(courseProgress(course, afterAuthoredLesson)).toBe(1);
  expect(moduleStatus(course, 'el-introduce', afterAuthoredLesson)).toBe('unavailable');
  expect(moduleStatus(course, 'el-origin', afterAuthoredLesson)).toBe('unavailable');
  expect(availableLessonsForModule(course.modules[0])).toHaveLength(1);
  expect(availableModulesForCourse(course)).toHaveLength(1);
});

test('legacy catalog metadata and phrase extraction remain compatible', () => {
  expect(courses).toHaveLength(1);
  expect(courses[0].modules).toHaveLength(12);
  expect(courses[0].modules.flatMap((module) => module.lessons)).toHaveLength(26);
  expect(phrasesForCourse(courses[0]).map((phrase) => phrase.greek)).toEqual(['καλημέρα', 'νερό']);
});
