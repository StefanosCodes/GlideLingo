export type MigratableLearning<TLanguage extends string> = {
  languageId: TLanguage;
  enrolledByLanguage: Partial<Record<TLanguage, string>>;
  completedLessonIds: string[];
};

export function mergeLegacyLearning<TLanguage extends string>(
  current: MigratableLearning<TLanguage>,
  legacy: MigratableLearning<TLanguage>,
): MigratableLearning<TLanguage> {
  const currentHasProgress =
    Object.keys(current.enrolledByLanguage).length > 0 || current.completedLessonIds.length > 0;

  return {
    languageId: currentHasProgress ? current.languageId : legacy.languageId,
    enrolledByLanguage: { ...legacy.enrolledByLanguage, ...current.enrolledByLanguage },
    completedLessonIds: [...new Set([...legacy.completedLessonIds, ...current.completedLessonIds])],
  };
}
