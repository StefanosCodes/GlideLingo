import { LessonSittingView } from '@/features/learning-session/lesson-sitting-view';

export function LessonLectureView({
  lessonId,
  onClose,
}: {
  lessonId: string;
  onClose: () => void;
}) {
  return <LessonSittingView lessonId={lessonId} onClose={onClose} />;
}
