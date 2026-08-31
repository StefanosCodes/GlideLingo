import { reviewItemsFor, type LessonEvidenceRecord } from './evidence-policy.ts';

export function nextLocalMidnight(now: Date | number = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  return new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime();
}

export function nextLearningRefreshAt(records: LessonEvidenceRecord[], now: number = Date.now()) {
  const nextReviewDueAt = reviewItemsFor(records, now).find((item) => item.dueAt > now)?.dueAt;
  return Math.min(nextLocalMidnight(now), nextReviewDueAt ?? Number.POSITIVE_INFINITY);
}
