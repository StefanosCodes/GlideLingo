export type MigratableLearning<TLanguage extends string> = {
  languageId: TLanguage;
  enrolledByLanguage: Partial<Record<TLanguage, string>>;
  completedLessonIds: string[];
};

export type LearningMigrationStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

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

/**
 * Commit imported progress to the account-scoped destination before changing
 * either legacy marker. If any write fails, the caller keeps the import prompt
 * visible and the shared source is never removed before the durable copy exists.
 */
export function persistLegacyLearningImport<TLanguage extends string>(
  storage: LearningMigrationStorage,
  {
    decisionKey,
    destinationKey,
    legacyKey,
    merged,
  }: {
    decisionKey: string;
    destinationKey: string;
    legacyKey: string;
    merged: MigratableLearning<TLanguage>;
  },
) {
  storage.setItem(destinationKey, JSON.stringify(merged));
  storage.setItem(decisionKey, 'imported');

  try {
    storage.removeItem(legacyKey);
  } catch (error) {
    try {
      storage.removeItem(decisionKey);
    } catch {
      // The durable account copy still prevents data loss. The caller surfaces
      // the original cleanup failure for explicit recovery.
    }
    throw error;
  }
}
