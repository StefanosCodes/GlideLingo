import type { LoadedCoursePackage } from '@/features/course-catalog/model/course-content';

export function orderedModules(coursePackage: LoadedCoursePackage) {
  return coursePackage.course.moduleOrder.map((id) => {
    const module = coursePackage.lookups.modules.get(id);
    if (!module) throw new Error(`Validated course package lost module ${JSON.stringify(id)}.`);
    return module;
  });
}

export function orderedMissions(coursePackage: LoadedCoursePackage, moduleId: string) {
  const module = coursePackage.lookups.modules.get(moduleId);
  if (!module) return [];
  return module.missionIds.map((id) => {
    const mission = coursePackage.lookups.missions.get(id);
    if (!mission) throw new Error(`Validated course package lost mission ${JSON.stringify(id)}.`);
    return mission;
  });
}

export function orderedLessons(coursePackage: LoadedCoursePackage, missionId: string) {
  const mission = coursePackage.lookups.missions.get(missionId);
  if (!mission) return [];
  return mission.lessonOrder.map((id) => {
    const lesson = coursePackage.lookups.lessons.get(id);
    if (!lesson) throw new Error(`Validated course package lost lesson ${JSON.stringify(id)}.`);
    return lesson;
  });
}

export function getCourseLesson(coursePackage: LoadedCoursePackage, lessonId: string) {
  const lesson = coursePackage.lookups.lessons.get(lessonId);
  if (!lesson) return null;
  const mission = coursePackage.lookups.missions.get(lesson.missionId);
  if (!mission) throw new Error(`Validated course package lost parent mission ${JSON.stringify(lesson.missionId)}.`);
  const module = coursePackage.lookups.modules.get(mission.moduleId);
  if (!module) throw new Error(`Validated course package lost parent module ${JSON.stringify(mission.moduleId)}.`);
  return { module, mission, lesson };
}

export function getCourseActivity(coursePackage: LoadedCoursePackage, activityId: string) {
  return coursePackage.lookups.activities.get(activityId) ?? null;
}

export function getCourseCapability(coursePackage: LoadedCoursePackage, capabilityId: string) {
  return coursePackage.lookups.capabilities.get(capabilityId) ?? null;
}

export function getCourseScenario(coursePackage: LoadedCoursePackage, scenarioId: string) {
  return coursePackage.lookups.scenarios.get(scenarioId) ?? null;
}

export function getCourseAudioClip(coursePackage: LoadedCoursePackage, audioId: string) {
  return coursePackage.lookups.audioClips.get(audioId) ?? null;
}

export function getCourseAsset(coursePackage: LoadedCoursePackage, missionId: string, assetId: string) {
  return coursePackage.lookups.assets.get(`${missionId}/${assetId}`) ?? null;
}
