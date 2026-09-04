export type LessonVoiceScenario = {
  courseId: string;
  lessonId: string;
  scenarioId: string;
};

const AUTHORED_LESSON_SCENARIOS: readonly LessonVoiceScenario[] = [
  {
    courseId: 'el-from-zero',
    lessonId: 'el-letters-1',
    scenarioId: 'el-letters-1-voice-v1',
  },
];

export function voiceScenarioForLesson(courseId: string, lessonId: string): LessonVoiceScenario | null {
  return (
    AUTHORED_LESSON_SCENARIOS.find(
      (scenario) => scenario.courseId === courseId && scenario.lessonId === lessonId,
    ) ?? null
  );
}
