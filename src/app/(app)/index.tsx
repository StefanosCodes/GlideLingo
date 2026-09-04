import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Spacing } from '@/constants/theme';
import { strongestCapabilityEvidence } from '@/features/learning-progress/evidence-policy';
import { LessonLectureView } from '@/features/learning-session/lesson-lecture-view';
import { mostRecentEvidence, selectHomeNextAction } from '@/features/product-shell/home-next-action';
import { LearningStateNotice } from '@/features/product-shell/learning-state-notice';
import { useLearning } from '@/providers/learning-provider';

export default function HomeScreen() {
  const router = useRouter();
  const {
    activeLessonId,
    activeLessonMode,
    completedLessonIds,
    courses,
    currentModule,
    enrolledCourse,
    language,
    lessonEvidence,
    nextLesson,
    openLesson,
    persistenceStatus,
    practiceDaysThisWeek,
    progress,
    reviewItems,
    weeklyPracticeGoal,
  } = useLearning();
  const catalogCourse = enrolledCourse ?? courses[0] ?? null;

  if (!language.available || !catalogCourse) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            HOME · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">This course is still being prepared.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Available courses stay in the course menu. Your completed work will still be here when more languages open.
          </ThemedText>
        </View>
        <LearningStateNotice status={persistenceStatus} />
      </ScreenFrame>
    );
  }

  if (!enrolledCourse) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            HOME · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">Build your first Greek foundations.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Begin with the sound map, then use Greek in short, practical units.
          </ThemedText>
        </View>
        <LearningStateNotice status={persistenceStatus} />
        <GlideSurface padding="roomy" style={styles.primaryCard} variant="hero">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            {catalogCourse.levelLabel} · {catalogCourse.modules.length} UNITS
          </ThemedText>
          <ThemedText type="title">{catalogCourse.title}</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            {catalogCourse.summary}
          </ThemedText>
          <GlideButton
            fullWidth
            label="Preview course"
            onPress={() => router.push(`/course/${catalogCourse.id}`)}
            testID="start-lesson"
          />
        </GlideSurface>
      </ScreenFrame>
    );
  }

  if (activeLessonId) {
    return (
      <LessonLectureView
        key={`${activeLessonId}-${activeLessonMode}`}
        lessonId={activeLessonId}
        mode={activeLessonMode}
        onClose={() => openLesson(null)}
      />
    );
  }

  const lesson = nextLesson?.lesson ?? null;
  const unit = currentModule ?? nextLesson?.module ?? null;
  const dueReview = reviewItems.find((item) => item.due) ?? null;
  const recentCapability = mostRecentEvidence(strongestCapabilityEvidence(lessonEvidence));
  const coursePercent = Math.round(progress * 100);
  const unitCompleted = unit
    ? unit.lessons.filter((item) => completedLessonIds.includes(item.id)).length
    : 0;
  const unitProgress = unit ? unitCompleted / unit.lessons.length : 1;
  const nextAction = selectHomeNextAction({
    courseProgress: progress,
    dueReview,
    lesson,
    unitOutcome: unit?.canDo ?? null,
    unitProgress,
  });

  function takeNextAction() {
    if (nextAction.kind === 'review' && nextAction.lessonId) {
      openLesson(nextAction.lessonId, 'review');
      return;
    }
    if (nextAction.kind === 'lesson' && nextAction.lessonId) {
      openLesson(nextAction.lessonId);
      return;
    }
    router.push('/progress');
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          HOME · {language.name.toUpperCase()} · {enrolledCourse.levelLabel}
        </ThemedText>
        <ThemedText type="display">
          {nextAction.kind === 'review'
            ? 'Bring one useful pattern back.'
            : nextAction.kind === 'lesson'
              ? 'Keep your course moving.'
              : 'Your published course is complete.'}
        </ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          One next action, chosen from your current course and review evidence.
        </ThemedText>
      </View>

      <LearningStateNotice status={persistenceStatus} />

      <GlideSurface padding="roomy" style={styles.primaryCard} variant="hero">
        <View style={styles.metaRow}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            {nextAction.eyebrow}
          </ThemedText>
          <ThemedText type="caption" themeColor="textTertiary">
            {nextAction.durationLabel}
          </ThemedText>
        </View>
        <View style={styles.cardCopy}>
          <ThemedText type="title">{nextAction.title}</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            {nextAction.outcome}
          </ThemedText>
        </View>
        <ProgressBar
          accessibilityLabel={`${Math.round(nextAction.progress * 100)}% progress for this action`}
          value={nextAction.progress}
        />
        <GlideButton
          fullWidth
          label={nextAction.cta}
          onPress={takeNextAction}
          testID={
            nextAction.kind === 'review'
              ? 'start-review'
              : nextAction.kind === 'lesson'
                ? 'start-lesson'
                : 'view-progress'
          }
        />
      </GlideSurface>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            TODAY
          </ThemedText>
          <ThemedText type="title2">A finishable plan</ThemedText>
        </View>
        <GlideSurface padding="roomy" style={styles.planRow}>
          <ThemedText type="headline">1. {nextAction.cta}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {nextAction.title} · {nextAction.durationLabel.toLowerCase()}
          </ThemedText>
        </GlideSurface>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            QUICK ACTIONS
          </ThemedText>
          <ThemedText type="title2">Choose another useful path</ThemedText>
        </View>
        <View style={styles.quickActions}>
          <GlideButton label="Practice speaking" onPress={() => router.push('/speak')} variant="secondary" />
          <GlideButton label="Open Practice" onPress={() => router.push('/practice')} variant="secondary" />
        </View>
      </View>

      <View style={styles.metrics}>
        <Metric
          label="WEEKLY RHYTHM"
          value={weeklyPracticeGoal ? `${practiceDaysThisWeek}/${weeklyPracticeGoal}` : 'Not set'}
        />
        <Metric label="XP" value="Not tracked" />
        <Metric label="COURSE" value={`${coursePercent}%`} />
      </View>

      {recentCapability ? (
        <GlideSurface padding="roomy" style={styles.milestone} variant="success">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            RECENT CAPABILITY · {recentCapability.state.toUpperCase()}
          </ThemedText>
          <ThemedText type="title2">{recentCapability.capability.canDo}</ThemedText>
          <GlideButton label="View evidence" onPress={() => router.push('/progress')} variant="tertiary" />
        </GlideSurface>
      ) : null}
    </ScreenFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <GlideSurface padding="roomy" style={styles.metric}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="title3">{value}</ThemedText>
    </GlideSurface>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 520 },
  primaryCard: { gap: Spacing.threeHalf },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two, justifyContent: 'space-between' },
  cardCopy: { gap: Spacing.two, maxWidth: 560 },
  section: { gap: Spacing.three },
  sectionHeading: { gap: Spacing.one },
  planRow: { gap: Spacing.one },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metric: { flexBasis: 148, flexGrow: 1, gap: Spacing.one },
  milestone: { gap: Spacing.two },
});
