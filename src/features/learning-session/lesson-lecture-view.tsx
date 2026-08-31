import { LessonSittingView } from '@/features/learning-session/lesson-sitting-view';
import type { LessonMode } from '@/features/learning-progress/evidence-policy';

export function LessonLectureView({
  lessonId,
  mode = 'learn',
  onClose,
}: {
  lessonId: string;
  mode?: LessonMode;
  onClose: () => void;
}) {
  return <LessonSittingView lessonId={lessonId} mode={mode} onClose={onClose} />;
}
