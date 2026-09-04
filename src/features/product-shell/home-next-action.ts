type ReviewCandidate = {
  lessonId: string;
  capability: { canDo: string };
  reason: string;
};

type LessonCandidate = {
  id: string;
  title: string;
  durationMin: number;
};

type HomeNextActionInput = {
  dueReview: ReviewCandidate | null;
  lesson: LessonCandidate | null;
  unitOutcome: string | null;
  unitProgress: number;
  courseProgress: number;
};

export type HomeNextAction = {
  kind: 'review' | 'lesson' | 'complete';
  eyebrow: string;
  title: string;
  outcome: string;
  durationLabel: string;
  progress: number;
  cta: string;
  lessonId: string | null;
};

export function mostRecentEvidence<T extends { evidenceAt: number }>(records: readonly T[]): T | null {
  return records.reduce<T | null>(
    (latest, record) => (!latest || record.evidenceAt > latest.evidenceAt ? record : latest),
    null,
  );
}

export function selectHomeNextAction({
  dueReview,
  lesson,
  unitOutcome,
  unitProgress,
  courseProgress,
}: HomeNextActionInput): HomeNextAction {
  if (dueReview) {
    return {
      kind: 'review',
      eyebrow: 'DUE REVIEW',
      title: dueReview.capability.canDo,
      outcome: dueReview.reason,
      durationLabel: 'ABOUT 5 MIN',
      progress: 0,
      cta: 'Start review',
      lessonId: dueReview.lessonId,
    };
  }

  if (lesson) {
    return {
      kind: 'lesson',
      eyebrow: 'NEXT LESSON',
      title: lesson.title,
      outcome: unitOutcome ?? 'Continue the next authored step in your course.',
      durationLabel: `${lesson.durationMin} MIN`,
      progress: unitProgress,
      cta: 'Continue lesson',
      lessonId: lesson.id,
    };
  }

  return {
    kind: 'complete',
    eyebrow: 'PUBLISHED COURSE COMPLETE',
    title: 'See what you can now do',
    outcome: 'Review your course completion and the evidence collected from your attempts.',
    durationLabel: `${Math.round(courseProgress * 100)}%`,
    progress: courseProgress,
    cta: 'View progress',
    lessonId: null,
  };
}
