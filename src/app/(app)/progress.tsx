import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Spacing } from '@/constants/theme';
import { strongestCapabilityEvidence } from '@/features/learning-progress/evidence-policy';
import { LearningStateNotice } from '@/features/product-shell/learning-state-notice';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

const stateLabel = {
  introduced: 'Introduced',
  practiced: 'Practiced',
  demonstrated: 'Demonstrated',
  retained: 'Retained',
} as const;

export default function ProgressScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    completedLessonIds,
    enrolledCourse,
    language,
    lessonEvidence,
    persistenceStatus,
    practiceDaysThisWeek,
    progress,
    reviewItems,
    weeklyPracticeGoal,
  } = useLearning();
  const capabilities = strongestCapabilityEvidence(lessonEvidence);
  const dueReview = reviewItems.find((item) => item.due) ?? null;
  const percent = Math.round(progress * 100);

  if (!enrolledCourse) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            PROGRESS · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">Your capability record starts with a course.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Completion, practice rhythm, and demonstrated ability will stay separate here.
          </ThemedText>
        </View>
        <LearningStateNotice status={persistenceStatus} />
        <GlideButton label="Choose a course" onPress={() => router.push('/course')} />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          PROGRESS · {language.name.toUpperCase()}
        </ThemedText>
        <ThemedText type="display">What you can do now.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Course completion, activity, and evidence are shown separately so each claim stays meaningful.
        </ThemedText>
      </View>

      <LearningStateNotice status={persistenceStatus} />

      <View style={styles.metrics}>
        <Metric label="COURSE" value={`${percent}%`} detail={`${completedLessonIds.length} lessons complete`} />
        <Metric
          label="WEEKLY RHYTHM"
          value={weeklyPracticeGoal ? `${practiceDaysThisWeek}/${weeklyPracticeGoal}` : 'Not set'}
          detail="Meaningful learning days"
        />
        <Metric label="XP" value="—" detail="Not tracked in this build" />
      </View>

      <GlideSurface padding="roomy" style={styles.block}>
        <View style={styles.progressLabels}>
          <ThemedText type="headline">{enrolledCourse.title}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {percent}% course completion
          </ThemedText>
        </View>
        <ProgressBar accessibilityLabel={`${percent}% of ${enrolledCourse.title} complete`} value={progress} />
      </GlideSurface>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            CAPABILITIES
          </ThemedText>
          <ThemedText type="title2">Evidence from your attempts</ThemedText>
        </View>
        {capabilities.length ? (
          <GlideSurface padding="none">
            {capabilities.map((record, index) => (
              <View
                key={record.capability.id}
                style={[
                  styles.capabilityRow,
                  index > 0 && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth },
                ]}>
                <View style={styles.capabilityCopy}>
                  <ThemedText type="headline">{record.capability.canDo}</ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {stateLabel[record.state]}
                  </ThemedText>
                </View>
              </View>
            ))}
          </GlideSurface>
        ) : (
          <GlideSurface padding="roomy" style={styles.block}>
            <ThemedText type="title3">No capability evidence yet.</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              Finish an authored lesson check to add evidence. Opening a screen or spending time does not create it.
            </ThemedText>
            <GlideButton label="Continue course" onPress={() => router.push('/course')} variant="secondary" />
          </GlideSurface>
        )}
      </View>

      <GlideSurface padding="roomy" style={styles.block} variant={dueReview ? 'tinted' : 'card'}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          REVIEW
        </ThemedText>
        <ThemedText type="title3">
          {dueReview ? dueReview.capability.canDo : 'Nothing is due right now.'}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {dueReview ? dueReview.reason : 'Upcoming review will appear only when your evidence schedule calls for it.'}
        </ThemedText>
        <GlideButton label="Open Practice" onPress={() => router.push('/practice')} variant="secondary" />
      </GlideSurface>

      <GlideSurface padding="roomy" style={styles.block}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          ACTIVITY
        </ThemedText>
        <ThemedText type="title3">Detailed history is not available yet.</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          This shell does not fill missing days with fake zero activity.
        </ThemedText>
      </GlideSurface>
    </ScreenFrame>
  );
}

function Metric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <GlideSurface padding="roomy" style={styles.metric}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="title2">{value}</ThemedText>
      <ThemedText type="caption" themeColor="textTertiary">
        {detail}
      </ThemedText>
    </GlideSurface>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 560 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metric: { flexBasis: 160, flexGrow: 1, gap: Spacing.one },
  block: { gap: Spacing.twoHalf },
  progressLabels: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two, justifyContent: 'space-between' },
  section: { gap: Spacing.three },
  sectionHeading: { gap: Spacing.one },
  capabilityRow: { minHeight: 64, paddingHorizontal: Spacing.three, paddingVertical: Spacing.twoHalf },
  capabilityCopy: { gap: Spacing.half },
});
