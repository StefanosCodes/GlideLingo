import type { Course, Lesson, LessonBlock, SittingBeat } from '@/constants/catalog';
import { loadCoursePackage } from '@/features/course-catalog/loader/course-loader';
import type { ActivityRecord, CoursePackageSource } from '@/features/course-catalog/model/course-content';
import { getCourseLesson } from '@/features/course-catalog/selectors/course-selectors';
import type {
  CommunicationMode,
  EvidenceLevel,
  LessonCapability,
} from '@/features/learning-progress/evidence-policy';

export type CompatibilityPresentation = {
  lessonId: string;
  blocks: LessonBlock[];
};

function asLegacyMode(mode: ActivityRecord['communicationMode']): CommunicationMode | null {
  if (mode === 'listening' || mode === 'reading') return mode;
  if (mode === 'spoken-production' || mode === 'spoken-interaction') return 'speaking';
  if (mode === 'written-production' || mode === 'written-interaction') return 'writing';
  return null;
}

function asEvidenceLevel(activity: ActivityRecord): EvidenceLevel | undefined {
  if (activity.evidenceEligibility === 'practice') return 'practice';
  if (activity.evidenceEligibility === 'demonstration' || activity.evidenceEligibility === 'retention') {
    return 'checkpoint';
  }
  return undefined;
}

function asSittingBeat(activity: ActivityRecord): SittingBeat {
  if (activity.rendererType === 'explain' && activity.audioId && activity.text) {
    return { type: 'hear', greek: activity.prompt, gloss: activity.text, audioId: activity.audioId };
  }
  if (activity.rendererType === 'explain' && activity.text) {
    return { type: 'notice', text: activity.text };
  }
  if (activity.rendererType === 'script_recognition' && activity.choices && activity.acceptedChoiceIds) {
    const acceptedId = activity.acceptedChoiceIds[0];
    const answer = activity.choices.find((choice) => choice.id === acceptedId)?.text;
    if (!answer) throw new Error(`Activity ${JSON.stringify(activity.id)} has no accepted compatibility choice.`);
    const evidenceLevel = asEvidenceLevel(activity);
    return {
      type: 'check',
      prompt: activity.prompt,
      choices: activity.choices.map((choice) => choice.text),
      answer,
      ...(activity.text ? { greek: activity.text } : {}),
      ...(activity.audioId ? { audioId: activity.audioId } : {}),
      ...(activity.feedbackContrasts[0]?.feedback
        ? { feedback: activity.feedbackContrasts[0].feedback }
        : {}),
      ...(evidenceLevel
        ? { evidence: { capabilityId: activity.targetCapabilityIds[0], level: evidenceLevel } }
        : {}),
    };
  }
  throw new Error(
    `Activity ${JSON.stringify(activity.id)} cannot be represented by the temporary catalog adapter.`,
  );
}

function adaptLesson(
  source: CoursePackageSource,
  presentation: CompatibilityPresentation,
): { courseId: string; moduleId: string; lesson: Lesson } {
  // The current Greek prototype predates publication review. This explicit bridge
  // is the only draft-loading exception; normal loader callers remain published-only.
  const coursePackage = loadCoursePackage(source, { publicationPolicy: 'include-drafts' });
  if (!coursePackage) throw new Error('The compatibility course package is unavailable.');
  const found = getCourseLesson(coursePackage, presentation.lessonId);
  if (!found) throw new Error(`Compatibility lesson ${JSON.stringify(presentation.lessonId)} does not exist.`);
  const capability = coursePackage.lookups.capabilities.get(found.lesson.activities[0]?.targetCapabilityIds[0] ?? '');
  const evidenceActivity = capability
    ? found.lesson.activities.find((activity) =>
      activity.assessmentEligible && activity.targetCapabilityIds.includes(capability.id))
    : undefined;
  const primaryMode = evidenceActivity
    ? asLegacyMode(evidenceActivity.communicationMode)
    : capability?.communicationModes.map(asLegacyMode).find(Boolean);
  const introducedModes = [
    ...new Set(found.lesson.activities.map((activity) => asLegacyMode(activity.communicationMode)).filter(Boolean)),
  ] as CommunicationMode[];
  const lessonCapability: LessonCapability | undefined = capability && primaryMode
    ? { id: capability.id, canDo: capability.canDo, mode: primaryMode }
    : undefined;

  return {
    courseId: coursePackage.course.id,
    moduleId: found.module.id,
    lesson: {
      id: found.lesson.id,
      title: found.lesson.title,
      durationMin: found.lesson.durationMinutes,
      contentStatus: 'authored',
      blocks: presentation.blocks,
      beats: found.lesson.activities.filter((activity) => activity.phase !== 'revisit').map(asSittingBeat),
      reviewBeats: found.lesson.activities.filter((activity) => activity.phase === 'revisit').map(asSittingBeat),
      capability: lessonCapability,
      introducedModes,
    },
  };
}

export function bridgeCoursePackageLesson(
  courses: Course[],
  source: CoursePackageSource,
  presentation: CompatibilityPresentation,
): Course[] {
  const adapted = adaptLesson(source, presentation);
  let replaced = false;
  const result = courses.map((course) => {
    if (course.id !== adapted.courseId) return course;
    return {
      ...course,
      modules: course.modules.map((module) => {
        return {
          ...module,
          lessons: module.lessons.map((lesson) => {
            if (module.id !== adapted.moduleId || lesson.id !== adapted.lesson.id) {
              return { ...lesson, contentStatus: 'placeholder' as const };
            }
            replaced = true;
            return adapted.lesson;
          }),
        };
      }),
    };
  });
  if (!replaced) {
    throw new Error(
      `Compatibility catalog is missing ${adapted.courseId}/${adapted.moduleId}/${adapted.lesson.id}.`,
    );
  }
  return result;
}
