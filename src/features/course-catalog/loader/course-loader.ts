import type {
  ActivityRecord,
  AudioClipRecord,
  CapabilityRecord,
  CoursePackage,
  CoursePackageLookups,
  CoursePackageSource,
  CourseRecord,
  LanguageProfileRecord,
  LessonRecord,
  LoadedCoursePackage,
  MissionAssetRecord,
  MissionRecord,
  ModuleRecord,
  PronunciationTargetRecord,
  PublicationRecord,
  ScenarioRecord,
} from '@/features/course-catalog/model/course-content';
import { validateCoursePackageSourceSchema } from '@/features/course-catalog/loader/course-schema-validator';

const SUPPORTED_SCHEMA_VERSION = 1;
const SUPPORTED_RENDERERS = new Set([
  'explain',
  'listen_choose',
  'match',
  'order_phrase',
  'type_response',
  'script_recognition',
  'listen_repeat',
  'controlled_speak',
  'mini_roleplay',
  'checkpoint_item',
  'reflection',
]);
const REQUIRED_SCHEMA_NAMES = [
  'course',
  'languageProfile',
  'capabilities',
  'modules',
  'mission',
  'lesson',
  'activity',
  'scenario',
  'pronunciationTargets',
  'publication',
] as const;

type RecordValue = Record<string, unknown>;
type PublicationPolicy = 'published-only' | 'include-drafts';

export class CoursePackageLoadError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'CoursePackageLoadError';
  }
}

function fail(path: string, message: string): never {
  throw new CoursePackageLoadError(path, message);
}

function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as RecordValue;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(path, 'must be a non-empty string');
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) => string(item, `${path}/${index}`));
}

function schemaRecord(value: unknown, path: string): RecordValue {
  const result = record(value, path);
  if (result.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail(`${path}/schemaVersion`, `unsupported schema version ${JSON.stringify(result.schemaVersion)}`);
  }
  string(result.id, `${path}/id`);
  const version = string(result.version, `${path}/version`);
  if (!version.startsWith('1.')) fail(`${path}/version`, `unsupported content version ${JSON.stringify(version)}`);
  return result;
}

function register<T extends { id: string }>(
  map: Map<string, T>,
  value: T,
  path: string,
  globalIds?: Map<string, string>,
) {
  const previous = globalIds?.get(value.id);
  if (map.has(value.id) || previous) {
    fail(`${path}/id`, `duplicate ID ${JSON.stringify(value.id)}; first declared at ${previous ?? 'an earlier record'}`);
  }
  map.set(value.id, value);
  globalIds?.set(value.id, path);
}

function reference<T>(map: ReadonlyMap<string, T>, id: string, path: string, kind: string) {
  if (!map.has(id)) fail(path, `${kind} ${JSON.stringify(id)} does not exist`);
}

function references<T>(map: ReadonlyMap<string, T>, ids: string[], path: string, kind: string) {
  ids.forEach((id, index) => reference(map, id, `${path}/${index}`, kind));
}

function parseCourse(value: unknown): CourseRecord {
  const item = schemaRecord(value, 'course.json');
  string(item.targetLocale, 'course.json/targetLocale');
  string(item.targetVariety, 'course.json/targetVariety');
  stringArray(item.exitCapabilityIds, 'course.json/exitCapabilityIds');
  stringArray(item.moduleOrder, 'course.json/moduleOrder');
  string(item.publicationRef, 'course.json/publicationRef');
  return item as CourseRecord;
}

function parseLanguageProfile(value: unknown): LanguageProfileRecord {
  const item = schemaRecord(value, 'language-profile.json');
  string(item.courseId, 'language-profile.json/courseId');
  return item as LanguageProfileRecord;
}

function parseCapabilities(value: unknown): CapabilityRecord[] {
  const document = record(value, 'capabilities.json');
  if (document.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail('capabilities.json/schemaVersion', `unsupported schema version ${JSON.stringify(document.schemaVersion)}`);
  }
  return array(document.capabilities, 'capabilities.json/capabilities').map((valueToParse, index) => {
    const path = `capabilities.json/capabilities/${index}`;
    const item = schemaRecord(valueToParse, path);
    string(item.courseId, `${path}/courseId`);
    string(item.canDo, `${path}/canDo`);
    stringArray(item.prerequisiteCapabilityIds, `${path}/prerequisiteCapabilityIds`);
    stringArray(item.teachingMissionIds, `${path}/teachingMissionIds`);
    return item as CapabilityRecord;
  });
}

function parseModules(value: unknown): ModuleRecord[] {
  const document = record(value, 'modules.json');
  if (document.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail('modules.json/schemaVersion', `unsupported schema version ${JSON.stringify(document.schemaVersion)}`);
  }
  return array(document.modules, 'modules.json/modules').map((valueToParse, index) => {
    const path = `modules.json/modules/${index}`;
    const item = schemaRecord(valueToParse, path);
    string(item.courseId, `${path}/courseId`);
    string(item.stageId, `${path}/stageId`);
    stringArray(item.targetCapabilityIds, `${path}/targetCapabilityIds`);
    stringArray(item.supportingCapabilityIds, `${path}/supportingCapabilityIds`);
    stringArray(item.prerequisiteModuleIds, `${path}/prerequisiteModuleIds`);
    stringArray(item.missionIds, `${path}/missionIds`);
    string(item.checkpointActivityId, `${path}/checkpointActivityId`);
    stringArray(item.delayedReviewCapabilityIds, `${path}/delayedReviewCapabilityIds`);
    stringArray(item.recommendedScenarioIds, `${path}/recommendedScenarioIds`);
    return item as ModuleRecord;
  });
}

function parseActivity(value: unknown, path: string): ActivityRecord {
  const item = schemaRecord(value, path);
  const rendererType = string(item.rendererType, `${path}/rendererType`);
  if (!SUPPORTED_RENDERERS.has(rendererType)) {
    fail(`${path}/rendererType`, `unsupported renderer type ${JSON.stringify(rendererType)}`);
  }
  stringArray(item.targetCapabilityIds, `${path}/targetCapabilityIds`);
  stringArray(item.supportingCapabilityIds, `${path}/supportingCapabilityIds`);
  stringArray(item.assetIds, `${path}/assetIds`);
  if (item.audioId !== undefined) string(item.audioId, `${path}/audioId`);
  if (item.answerAliases !== undefined) stringArray(item.answerAliases, `${path}/answerAliases`);
  if (item.scenarioId !== undefined) string(item.scenarioId, `${path}/scenarioId`);
  if (item.pronunciationTargetId !== undefined) string(item.pronunciationTargetId, `${path}/pronunciationTargetId`);
  if (rendererType === 'explain' || rendererType === 'reflection') string(item.text, `${path}/text`);
  if (rendererType === 'listen_choose' || rendererType === 'script_recognition') {
    const choices = array(item.choices, `${path}/choices`);
    const choiceIds = new Set<string>();
    const choiceTexts = new Set<string>();
    choices.forEach((choice, index) => {
      const parsed = record(choice, `${path}/choices/${index}`);
      const choiceId = string(parsed.id, `${path}/choices/${index}/id`);
      if (choiceIds.has(choiceId)) fail(`${path}/choices/${index}/id`, `duplicate choice ID ${JSON.stringify(choiceId)}`);
      choiceIds.add(choiceId);
      const choiceText = string(parsed.text, `${path}/choices/${index}/text`);
      if (choiceTexts.has(choiceText)) fail(`${path}/choices/${index}/text`, `duplicate choice text ${JSON.stringify(choiceText)}`);
      choiceTexts.add(choiceText);
    });
    stringArray(item.acceptedChoiceIds, `${path}/acceptedChoiceIds`);
  }
  return item as ActivityRecord;
}

function parseMissions(values: readonly unknown[]): MissionRecord[] {
  return values.map((value, missionIndex) => {
    const path = `missions/${missionIndex}`;
    const item = schemaRecord(value, path);
    string(item.courseId, `${path}/courseId`);
    string(item.moduleId, `${path}/moduleId`);
    stringArray(item.targetCapabilityIds, `${path}/targetCapabilityIds`);
    stringArray(item.supportingCapabilityIds, `${path}/supportingCapabilityIds`);
    stringArray(item.prerequisiteCapabilityIds, `${path}/prerequisiteCapabilityIds`);
    stringArray(item.lessonOrder, `${path}/lessonOrder`);
    stringArray(item.checkpointActivityIds, `${path}/checkpointActivityIds`);
    stringArray(item.reviewActivityIds, `${path}/reviewActivityIds`);
    const completionCondition = record(item.completionCondition, `${path}/completionCondition`);
    stringArray(completionCondition.requiredActivityIds, `${path}/completionCondition/requiredActivityIds`);
    const offline = record(item.offline, `${path}/offline`);
    stringArray(offline.unavailableActivityIds, `${path}/offline/unavailableActivityIds`);
    const assets = array(item.assets, `${path}/assets`).map((assetValue, assetIndex) => {
      const assetPath = `${path}/assets/${assetIndex}`;
      const asset = record(assetValue, assetPath);
      string(asset.id, `${assetPath}/id`);
      string(asset.path, `${assetPath}/path`);
      return asset as MissionAssetRecord;
    });
    const lessons = array(item.lessons, `${path}/lessons`).map((lessonValue, lessonIndex) => {
      const lessonPath = `${path}/lessons/${lessonIndex}`;
      const lesson = schemaRecord(lessonValue, lessonPath);
      string(lesson.missionId, `${lessonPath}/missionId`);
      string(lesson.title, `${lessonPath}/title`);
      stringArray(lesson.assetIds, `${lessonPath}/assetIds`);
      const lessonCompletion = record(lesson.completionCondition, `${lessonPath}/completionCondition`);
      stringArray(lessonCompletion.requiredActivityIds, `${lessonPath}/completionCondition/requiredActivityIds`);
      stringArray(lesson.safeResumeActivityIds, `${lessonPath}/safeResumeActivityIds`);
      const activities = array(lesson.activities, `${lessonPath}/activities`).map((activity, activityIndex) =>
        parseActivity(activity, `${lessonPath}/activities/${activityIndex}`));
      return { ...lesson, activities } as LessonRecord;
    });
    return { ...item, assets, lessons } as MissionRecord;
  });
}

function parseScenarios(values: readonly unknown[]): ScenarioRecord[] {
  return values.map((value, index) => {
    const path = `scenarios/${index}`;
    const item = schemaRecord(value, path);
    string(item.courseId, `${path}/courseId`);
    string(item.moduleId, `${path}/moduleId`);
    stringArray(item.targetCapabilityIds, `${path}/targetCapabilityIds`);
    stringArray(item.supportingCapabilityIds, `${path}/supportingCapabilityIds`);
    string(item.conversationProfileId, `${path}/conversationProfileId`);
    const observationIds = new Set<string>();
    array(item.successObservations, `${path}/successObservations`).forEach((observation, observationIndex) => {
      const observationPath = `${path}/successObservations/${observationIndex}`;
      const observationId = string(record(observation, observationPath).id, `${observationPath}/id`);
      if (observationIds.has(observationId)) {
        fail(`${observationPath}/id`, `duplicate success observation ID ${JSON.stringify(observationId)}`);
      }
      observationIds.add(observationId);
    });
    return item as ScenarioRecord;
  });
}

function parsePronunciationTargets(value: unknown): PronunciationTargetRecord[] {
  const document = record(value, 'pronunciation/targets.json');
  if (document.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail('pronunciation/targets.json/schemaVersion', `unsupported schema version ${JSON.stringify(document.schemaVersion)}`);
  }
  return array(document.targets, 'pronunciation/targets.json/targets').map((valueToParse, index) => {
    const path = `pronunciation/targets.json/targets/${index}`;
    const item = schemaRecord(valueToParse, path);
    string(item.courseId, `${path}/courseId`);
    stringArray(item.targetAudioIds, `${path}/targetAudioIds`);
    return item as PronunciationTargetRecord;
  });
}

function parsePublication(value: unknown): PublicationRecord {
  const item = schemaRecord(value, 'publication.json');
  string(item.courseId, 'publication.json/courseId');
  string(item.courseVersion, 'publication.json/courseVersion');
  if (!['draft', 'published', 'retired'].includes(String(item.status))) {
    fail('publication.json/status', `unsupported publication status ${JSON.stringify(item.status)}`);
  }
  const schemaVersions = record(item.schemaVersions, 'publication.json/schemaVersions');
  for (const name of REQUIRED_SCHEMA_NAMES) {
    if (schemaVersions[name] !== SUPPORTED_SCHEMA_VERSION) {
      fail(`publication.json/schemaVersions/${name}`, `must equal ${SUPPORTED_SCHEMA_VERSION}`);
    }
  }
  record(item.validatorReport, 'publication.json/validatorReport');
  record(item.reviews, 'publication.json/reviews');
  return item as PublicationRecord;
}

function parseAudioClips(value: unknown): AudioClipRecord[] {
  const document = record(value, 'audio-manifest.json');
  if (document.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail('audio-manifest.json/schemaVersion', `unsupported schema version ${JSON.stringify(document.schemaVersion)}`);
  }
  return array(document.clips, 'audio-manifest.json/clips').map((valueToParse, index) => {
    const path = `audio-manifest.json/clips/${index}`;
    const item = record(valueToParse, path);
    string(item.id, `${path}/id`);
    string(item.lessonId, `${path}/lessonId`);
    string(item.profile, `${path}/profile`);
    string(item.text, `${path}/text`);
    return item as AudioClipRecord;
  });
}

function buildLookups(coursePackage: CoursePackage): CoursePackageLookups {
  const globalIds = new Map<string, string>();
  const courses = new Map<string, CourseRecord>();
  const modules = new Map<string, ModuleRecord>();
  const missions = new Map<string, MissionRecord>();
  const lessons = new Map<string, LessonRecord>();
  const activities = new Map<string, ActivityRecord>();
  const capabilities = new Map<string, CapabilityRecord>();
  const scenarios = new Map<string, ScenarioRecord>();
  const pronunciationTargets = new Map<string, PronunciationTargetRecord>();
  const audioClips = new Map<string, AudioClipRecord>();
  const assets = new Map<string, MissionAssetRecord>();

  register(courses, coursePackage.course, 'course.json', globalIds);
  register(new Map(), coursePackage.languageProfile, 'language-profile.json', globalIds);
  coursePackage.capabilities.forEach((item, index) => register(capabilities, item, `capabilities.json/capabilities/${index}`, globalIds));
  coursePackage.modules.forEach((item, index) => register(modules, item, `modules.json/modules/${index}`, globalIds));
  coursePackage.missions.forEach((mission, missionIndex) => {
    register(missions, mission, `missions/${missionIndex}`, globalIds);
    mission.lessons.forEach((lesson, lessonIndex) => {
      register(lessons, lesson, `missions/${missionIndex}/lessons/${lessonIndex}`, globalIds);
      lesson.activities.forEach((activity, activityIndex) =>
        register(activities, activity, `missions/${missionIndex}/lessons/${lessonIndex}/activities/${activityIndex}`, globalIds));
    });
    mission.assets.forEach((asset, assetIndex) => {
      const key = `${mission.id}/${asset.id}`;
      if (assets.has(key)) fail(`missions/${missionIndex}/assets/${assetIndex}/id`, `duplicate asset ID ${JSON.stringify(asset.id)}`);
      assets.set(key, asset);
    });
  });
  coursePackage.scenarios.forEach((item, index) => register(scenarios, item, `scenarios/${index}`, globalIds));
  coursePackage.pronunciationTargets.forEach((item, index) =>
    register(pronunciationTargets, item, `pronunciation/targets.json/targets/${index}`, globalIds));
  register(new Map(), coursePackage.publication, 'publication.json', globalIds);
  coursePackage.audioClips.forEach((item, index) =>
    register(audioClips, item, `audio-manifest.json/clips/${index}`, globalIds));

  return { courses, modules, missions, lessons, activities, capabilities, scenarios, pronunciationTargets, audioClips, assets };
}

function validateReferences(coursePackage: CoursePackage, lookups: CoursePackageLookups) {
  const { course, languageProfile, publication } = coursePackage;
  if (languageProfile.courseId !== course.id) fail('language-profile.json/courseId', `must equal ${JSON.stringify(course.id)}`);
  if (publication.courseId !== course.id) fail('publication.json/courseId', `must equal ${JSON.stringify(course.id)}`);
  if (publication.courseVersion !== course.version) fail('publication.json/courseVersion', `must equal ${JSON.stringify(course.version)}`);
  if (publication.id !== course.publicationRef) fail('course.json/publicationRef', `publication ${JSON.stringify(course.publicationRef)} does not exist`);
  references(lookups.modules, course.moduleOrder, 'course.json/moduleOrder', 'module');
  references(lookups.capabilities, course.exitCapabilityIds, 'course.json/exitCapabilityIds', 'capability');

  coursePackage.capabilities.forEach((capability, index) => {
    const path = `capabilities.json/capabilities/${index}`;
    if (capability.courseId !== course.id) fail(`${path}/courseId`, `must equal ${JSON.stringify(course.id)}`);
    references(lookups.capabilities, capability.prerequisiteCapabilityIds, `${path}/prerequisiteCapabilityIds`, 'capability');
    references(lookups.missions, capability.teachingMissionIds, `${path}/teachingMissionIds`, 'mission');
  });

  coursePackage.modules.forEach((module, index) => {
    const path = `modules.json/modules/${index}`;
    if (module.courseId !== course.id) fail(`${path}/courseId`, `must equal ${JSON.stringify(course.id)}`);
    references(lookups.capabilities, module.targetCapabilityIds, `${path}/targetCapabilityIds`, 'capability');
    references(lookups.capabilities, module.supportingCapabilityIds, `${path}/supportingCapabilityIds`, 'capability');
    references(lookups.modules, module.prerequisiteModuleIds, `${path}/prerequisiteModuleIds`, 'module');
    references(lookups.missions, module.missionIds, `${path}/missionIds`, 'mission');
    references(lookups.capabilities, module.delayedReviewCapabilityIds, `${path}/delayedReviewCapabilityIds`, 'capability');
    references(lookups.scenarios, module.recommendedScenarioIds, `${path}/recommendedScenarioIds`, 'scenario');
    reference(lookups.activities, module.checkpointActivityId, `${path}/checkpointActivityId`, 'activity');
  });

  coursePackage.missions.forEach((mission, missionIndex) => {
    const path = `missions/${missionIndex}`;
    if (mission.courseId !== course.id) fail(`${path}/courseId`, `must equal ${JSON.stringify(course.id)}`);
    reference(lookups.modules, mission.moduleId, `${path}/moduleId`, 'module');
    references(lookups.capabilities, mission.targetCapabilityIds, `${path}/targetCapabilityIds`, 'capability');
    references(lookups.capabilities, mission.supportingCapabilityIds, `${path}/supportingCapabilityIds`, 'capability');
    references(lookups.capabilities, mission.prerequisiteCapabilityIds, `${path}/prerequisiteCapabilityIds`, 'capability');
    const localLessons = new Map(mission.lessons.map((lesson) => [lesson.id, lesson]));
    const localActivities = new Map(mission.lessons.flatMap((lesson) => lesson.activities).map((activity) => [activity.id, activity]));
    const localAssets = new Map(mission.assets.map((asset) => [asset.id, asset]));
    references(localLessons, mission.lessonOrder, `${path}/lessonOrder`, 'lesson in this mission');
    references(localActivities, mission.completionCondition.requiredActivityIds, `${path}/completionCondition/requiredActivityIds`, 'activity in this mission');
    references(localActivities, mission.checkpointActivityIds, `${path}/checkpointActivityIds`, 'activity in this mission');
    references(localActivities, mission.reviewActivityIds, `${path}/reviewActivityIds`, 'activity in this mission');
    references(localActivities, mission.offline.unavailableActivityIds, `${path}/offline/unavailableActivityIds`, 'activity in this mission');
    mission.lessons.forEach((lesson, lessonIndex) => {
      const lessonPath = `${path}/lessons/${lessonIndex}`;
      if (lesson.missionId !== mission.id) fail(`${lessonPath}/missionId`, `must equal ${JSON.stringify(mission.id)}`);
      const lessonActivities = new Map(lesson.activities.map((activity) => [activity.id, activity]));
      references(lessonActivities, lesson.completionCondition.requiredActivityIds, `${lessonPath}/completionCondition/requiredActivityIds`, 'activity in this lesson');
      references(lessonActivities, lesson.safeResumeActivityIds, `${lessonPath}/safeResumeActivityIds`, 'activity in this lesson');
      references(localAssets, lesson.assetIds, `${lessonPath}/assetIds`, 'asset in this mission');
      lesson.activities.forEach((activity, activityIndex) => {
        const activityPath = `${lessonPath}/activities/${activityIndex}`;
        references(lookups.capabilities, activity.targetCapabilityIds, `${activityPath}/targetCapabilityIds`, 'capability');
        references(lookups.capabilities, activity.supportingCapabilityIds, `${activityPath}/supportingCapabilityIds`, 'capability');
        references(localAssets, activity.assetIds, `${activityPath}/assetIds`, 'asset in this mission');
        if (activity.audioId) reference(lookups.audioClips, activity.audioId, `${activityPath}/audioId`, 'audio clip');
        if (activity.scenarioId) reference(lookups.scenarios, activity.scenarioId, `${activityPath}/scenarioId`, 'scenario');
        if (activity.pronunciationTargetId) {
          reference(lookups.pronunciationTargets, activity.pronunciationTargetId, `${activityPath}/pronunciationTargetId`, 'pronunciation target');
        }
      });
    });
  });

  coursePackage.audioClips.forEach((clip, index) =>
    reference(lookups.lessons, clip.lessonId, `audio-manifest.json/clips/${index}/lessonId`, 'lesson'));
  coursePackage.scenarios.forEach((scenario, index) => {
    const path = `scenarios/${index}`;
    if (scenario.courseId !== course.id) fail(`${path}/courseId`, `must equal ${JSON.stringify(course.id)}`);
    reference(lookups.modules, scenario.moduleId, `${path}/moduleId`, 'module');
    references(lookups.capabilities, scenario.targetCapabilityIds, `${path}/targetCapabilityIds`, 'capability');
    references(lookups.capabilities, scenario.supportingCapabilityIds, `${path}/supportingCapabilityIds`, 'capability');
  });
  coursePackage.pronunciationTargets.forEach((target, index) => {
    const path = `pronunciation/targets.json/targets/${index}`;
    if (target.courseId !== course.id) fail(`${path}/courseId`, `must equal ${JSON.stringify(course.id)}`);
    references(lookups.audioClips, target.targetAudioIds, `${path}/targetAudioIds`, 'audio clip');
  });
}

function enforcePublishedGate(publication: PublicationRecord) {
  if (!publication.publishedAt) fail('publication.json/publishedAt', 'a published package requires a timestamp');
  if (publication.validatorReport.status !== 'passed') {
    fail('publication.json/validatorReport/status', 'a published package requires a passed validator report');
  }
  for (const [name, review] of Object.entries(publication.reviews)) {
    if (review.status !== 'approved') fail(`publication.json/reviews/${name}/status`, 'a published package requires every review to be approved');
  }
}

export function loadCoursePackage(
  source: CoursePackageSource,
  { publicationPolicy = 'published-only' as PublicationPolicy } = {},
): LoadedCoursePackage | null {
  try {
    validateCoursePackageSourceSchema(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'schema validation failed';
    const separator = message.indexOf(': ');
    if (separator > 0) fail(message.slice(0, separator), message.slice(separator + 2));
    throw error;
  }
  const coursePackage: CoursePackage = {
    course: parseCourse(source.course),
    languageProfile: parseLanguageProfile(source.languageProfile),
    capabilities: parseCapabilities(source.capabilities),
    modules: parseModules(source.modules),
    missions: parseMissions(source.missions),
    scenarios: parseScenarios(source.scenarios),
    pronunciationTargets: parsePronunciationTargets(source.pronunciationTargets),
    publication: parsePublication(source.publication),
    audioClips: parseAudioClips(source.audioManifest),
  };
  const lookups = buildLookups(coursePackage);
  validateReferences(coursePackage, lookups);

  if (coursePackage.publication.status === 'retired') return null;
  if (coursePackage.publication.status === 'draft' && publicationPolicy === 'published-only') return null;
  if (coursePackage.publication.status === 'published') enforcePublishedGate(coursePackage.publication);
  return { ...coursePackage, lookups };
}
