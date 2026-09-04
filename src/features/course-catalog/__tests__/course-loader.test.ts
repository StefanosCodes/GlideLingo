import { expect, test } from '@jest/globals';

import {
  availableLessonsForModule,
  availableModulesForCourse,
  courseProgress,
  courses,
  currentModule,
  findLesson,
  getAvailableLesson,
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
      'must be one of: explain, listen_choose, match, order_phrase, type_response, script_recognition, listen_repeat, controlled_speak, mini_roleplay, checkpoint_item, reflection',
    ),
  );
});

test('the runtime boundary applies the complete schema before exposing typed content', () => {
  const missingSharedField = structuredClone(enElGrPackageSource);
  const sharedActivity = (missingSharedField.missions[0] as {
    lessons: { activities: { feedbackContrasts?: unknown }[] }[];
  }).lessons[0].activities[0];
  delete sharedActivity.feedbackContrasts;
  expect(() => loadCoursePackage(missingSharedField, { publicationPolicy: 'include-drafts' })).toThrow(
    'missions/0/lessons/0/activities/0/feedbackContrasts: must have required property',
  );

  const missingRendererField = structuredClone(enElGrPackageSource);
  const explainActivity = (missingRendererField.missions[0] as {
    lessons: { activities: { text?: unknown }[] }[];
  }).lessons[0].activities[0];
  delete explainActivity.text;
  expect(() => loadCoursePackage(missingRendererField, { publicationPolicy: 'include-drafts' })).toThrow(
    'missions/0/lessons/0/activities/0/text: must have required property',
  );

  const missingReviewContract = structuredClone(enElGrPackageSource);
  (missingReviewContract.publication as { reviews: unknown }).reviews = {};
  expect(() => loadCoursePackage(missingReviewContract, { publicationPolicy: 'include-drafts' })).toThrow(
    'publication.json/reviews/curriculum: must have required property',
  );

  const missingValidatorStatus = structuredClone(enElGrPackageSource);
  delete (missingValidatorStatus.publication as { validatorReport: { status?: unknown } }).validatorReport.status;
  expect(() => loadCoursePackage(missingValidatorStatus, { publicationPolicy: 'include-drafts' })).toThrow(
    'publication.json/validatorReport/status: must have required property',
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

  const duplicateChoiceSource = structuredClone(enElGrPackageSource);
  const duplicateChoices = (duplicateChoiceSource.missions[0] as {
    lessons: { activities: { choices?: { id: string }[] }[] }[];
  }).lessons[0].activities.find((activity) => activity.choices)?.choices;
  expect(duplicateChoices).toBeDefined();
  if (!duplicateChoices) return;
  duplicateChoices[1].id = duplicateChoices[0].id;
  expect(() => loadCoursePackage(duplicateChoiceSource, { publicationPolicy: 'include-drafts' })).toThrow(
    /choices\/1\/id: duplicate choice ID/,
  );

  const duplicateChoiceTextSource = structuredClone(enElGrPackageSource);
  const duplicateChoiceTexts = (duplicateChoiceTextSource.missions[0] as {
    lessons: { activities: { choices?: { text: string }[] }[] }[];
  }).lessons[0].activities.find((activity) => activity.choices)?.choices;
  expect(duplicateChoiceTexts).toBeDefined();
  if (!duplicateChoiceTexts) return;
  duplicateChoiceTexts[1].text = duplicateChoiceTexts[0].text;
  expect(() => loadCoursePackage(duplicateChoiceTextSource, { publicationPolicy: 'include-drafts' })).toThrow(
    /choices\/1\/text: duplicate choice text/,
  );

  const multipleAnswersSource = structuredClone(enElGrPackageSource);
  const multipleAnswers = (multipleAnswersSource.missions[0] as {
    lessons: { activities: { acceptedChoiceIds?: string[] }[] }[];
  }).lessons[0].activities.find((activity) => activity.acceptedChoiceIds)?.acceptedChoiceIds;
  expect(multipleAnswers).toBeDefined();
  if (!multipleAnswers) return;
  multipleAnswers.push('choice-epsilon');
  expect(() => loadCoursePackage(multipleAnswersSource, { publicationPolicy: 'include-drafts' })).toThrow(
    /acceptedChoiceIds: must NOT have more than 1 items/,
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
    expect.objectContaining({ type: 'check', answer: 'ε', evidence: { capabilityId: 'el-script-vowels-a-e-i', level: 'practice' } }),
    expect.objectContaining({ type: 'check', greek: 'να', answer: 'na', evidence: { capabilityId: 'el-script-vowels-a-e-i', level: 'checkpoint' } }),
    expect.objectContaining({ type: 'check', greek: 'νε', answer: 'ne', evidence: { capabilityId: 'el-script-vowels-a-e-i', level: 'checkpoint' } }),
    expect.objectContaining({ type: 'check', greek: 'νι', answer: 'ni', evidence: { capabilityId: 'el-script-vowels-a-e-i', level: 'checkpoint' } }),
  ]);
  expect(found?.lesson.reviewBeats).toEqual([
    {
      type: 'notice',
      text: 'No model this time. Read the new syllable from the sound pattern you practiced.',
    },
    expect.objectContaining({ type: 'check', greek: 'αν', answer: 'an' }),
    expect.objectContaining({ type: 'check', greek: 'ιν', answer: 'in' }),
  ]);
  expect(found?.lesson.capability).toEqual({
    id: 'el-script-vowels-a-e-i',
    canDo: 'I can recognize α, ε, and ι in a new Greek syllable.',
    mode: 'reading',
  });
});

test('available lesson lookup is course-scoped and excludes placeholders', () => {
  const course = courses[0];
  expect(getAvailableLesson(course, 'el-letters-1')?.lesson.id).toBe('el-letters-1');
  expect(getAvailableLesson(course, 'el-letters-2')).toBeNull();
  expect(getAvailableLesson(course, 'missing-lesson')).toBeNull();
});

test('the authored checkpoint set covers every grapheme claimed by the capability', () => {
  const loaded = loadCoursePackage(enElGrPackageSource, { publicationPolicy: 'include-drafts' });
  expect(loaded).not.toBeNull();
  if (!loaded) return;
  const demonstratedSyllables = loaded.missions[0].checkpointActivityIds.map(
    (id) => loaded.lookups.activities.get(id)?.text,
  );
  expect(demonstratedSyllables).toEqual(['να', 'νε', 'νι']);
  for (const grapheme of ['α', 'ε', 'ι']) {
    expect(demonstratedSyllables.some((syllable) => syllable?.includes(grapheme))).toBe(true);
  }
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
