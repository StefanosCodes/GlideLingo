import { ThemedText } from '@/components/themed-text';
import { GlideSurface } from '@/components/ui/glide-surface';
import type { LearningPersistenceStatus } from '@/providers/learning-storage';

export function LearningStateNotice({ status }: { status: LearningPersistenceStatus }) {
  if (status === 'available') return null;

  return (
    <GlideSurface accessible accessibilityRole="alert" padding="roomy" variant="tinted">
      <ThemedText type="headline">
        {status === 'corrupt' ? 'Saved progress could not be read safely.' : 'Progress is available for this session only.'}
      </ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary">
        {status === 'corrupt'
          ? 'GlideLingo left the stored value untouched. You can keep learning, but this device needs attention before new progress can be saved.'
          : 'Device storage is unavailable. You can keep learning, but changes may not survive a restart.'}
      </ThemedText>
    </GlideSurface>
  );
}
