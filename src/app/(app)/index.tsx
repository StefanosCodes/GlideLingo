import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { LessonLectureView } from '@/features/learning-session/lesson-lecture-view';
import { ListRow } from '@/components/list-row';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { ProgressBar } from '@/components/ui/progress-bar';
import { featuredLetterGlyph } from '@/constants/reference-content';
import { Radii, Spacing } from '@/constants/theme';
import { strongestCapabilityEvidence } from '@/features/learning-progress/evidence-policy';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    language,
    enrolledCourse,
    currentModule,
    nextLesson,
    activeLessonId,
    activeLessonMode,
    completedLessonIds,
    lessonEvidence,
    reviewItems,
    progress,
    courses,
    openLesson,
    practiceDaysThisWeek,
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
            Available courses stay in the course switcher. Your completed work will still be here when more languages open.
          </ThemedText>
        </View>
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
            Begin with the sound map, then use Greek in short, practical quests.
          </ThemedText>
        </View>
        <GlideSurface padding="roomy" style={styles.primaryCard}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            {catalogCourse.levelLabel} · {catalogCourse.modules.length} QUESTS
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
  const quest = currentModule ?? nextLesson?.module ?? null;
  const dueReview = reviewItems.find((item) => item.due) ?? null;
  const strongest = strongestCapabilityEvidence(lessonEvidence)[0] ?? null;
  const coursePercent = Math.round(progress * 100);
  const questCompleted = quest
    ? quest.lessons.filter((item) => completedLessonIds.includes(item.id)).length
    : 0;
  const questProgress = quest ? questCompleted / quest.lessons.length : 1;
  const nextActionCard = dueReview || lesson;
  const glyph = !dueReview && lesson ? featuredLetterGlyph(lesson.id) : null;

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          HOME · {language.name.toUpperCase()} · {enrolledCourse.levelLabel}
        </ThemedText>
        <ThemedText type="display">
          {dueReview
            ? 'Strengthen a pattern that is ready to return.'
            : lesson
              ? 'Continue your Greek quest.'
              : 'Your foundations are complete.'}
        </ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          {dueReview
            ? 'A short varied check comes before new material, while your completed work remains intact.'
            : lesson
              ? `${lesson.durationMin} focused minutes. One clear next step.`
              : 'Your course path and demonstrated abilities remain available in Quests and Profile.'}
        </ThemedText>
      </View>

      <GlideSurface padding="roomy" style={styles.primaryCard} variant={nextActionCard ? 'hero' : 'card'}>
        <View style={styles.metaRow}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            {dueReview ? 'READY TO STRENGTHEN' : quest ? 'CURRENT QUEST' : 'COURSE COMPLETE'}
          </ThemedText>
          <ThemedText type="caption" themeColor="textTertiary">
            {dueReview ? 'VARIED CHECK' : lesson ? `${lesson.durationMin} MIN` : `${coursePercent}%`}
          </ThemedText>
        </View>
        {glyph ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[styles.glyphWell, { backgroundColor: theme.accentSoft }]}>
            <ThemedText type="display" style={styles.glyph}>
              {glyph}
            </ThemedText>
          </View>
        ) : null}
        <View style={styles.cardCopy}>
          <ThemedText type="title">
            {dueReview?.capability.canDo ?? lesson?.title ?? 'See what you can now do'}
          </ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            {dueReview?.reason ?? quest?.canDo ?? 'A capability profile built from your attempts.'}
          </ThemedText>
        </View>
        {dueReview ? (
          <GlideButton
            fullWidth
            label="Start strengthening check"
            onPress={() => openLesson(dueReview.lessonId, 'review')}
            testID="start-review"
          />
        ) : lesson ? (
          <GlideButton fullWidth label="Continue quest" onPress={() => openLesson(lesson.id)} testID="start-lesson" />
        ) : (
          <GlideButton fullWidth label="Open your profile" onPress={() => router.push('/profile')} />
        )}
      </GlideSurface>

      {quest ? (
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <ThemedText type="eyebrow" themeColor="textSecondary">
              QUEST PROGRESS
            </ThemedText>
            <ThemedText type="title2">{quest.title}</ThemedText>
          </View>
          <GlideSurface padding="roomy" style={styles.progressCard}>
            <View style={styles.progressLabels}>
              <ThemedText type="footnote">
                {questCompleted} of {quest.lessons.length} lessons
              </ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {Math.round(questProgress * 100)}%
              </ThemedText>
            </View>
            <ProgressBar color={theme.accentStrong} value={questProgress} />
            <GlideButton label="See all quests" variant="secondary" onPress={() => router.push('/quests')} />
          </GlideSurface>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            EXPLORE GREEK
          </ThemedText>
          <ThemedText type="title2">Learn beyond the next lesson</ThemedText>
        </View>
        <GlideSurface padding="none">
          <ListRow
            detail="Alphabet, sounds, and example words"
            icon={{ ios: 'textformat.abc', android: 'abc', web: 'abc' }}
            label="Letters"
            onPress={() => router.push('/letters')}
          />
          <ListRow
            detail="Useful words and phrases from your quests"
            icon={{ ios: 'text.bubble', android: 'chat_bubble', web: 'chat_bubble' }}
            label="Phrases"
            last
            onPress={() => router.push('/phrases')}
          />
        </GlideSurface>
      </View>

      <GlideSurface padding="roomy" style={styles.profileSummary}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          YOUR PROFILE
        </ThemedText>
        <ThemedText type="title2">
          {strongest?.capability.canDo ?? 'Your first demonstrated ability will appear here.'}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {weeklyPracticeGoal
            ? `${practiceDaysThisWeek} of ${weeklyPracticeGoal} planned practice days this week.`
            : 'Choose a weekly rhythm that fits your life.'}
        </ThemedText>
        <GlideButton label="View profile" variant="tertiary" onPress={() => router.push('/profile')} />
      </GlideSurface>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 520 },
  primaryCard: { gap: Spacing.threeHalf },
  glyphWell: {
    alignItems: 'center',
    borderRadius: Radii.large,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  glyph: { fontSize: 40, letterSpacing: -1.2, lineHeight: 48 },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two, justifyContent: 'space-between' },
  cardCopy: { gap: Spacing.two, maxWidth: 560 },
  section: { gap: Spacing.three },
  sectionHeading: { gap: Spacing.one },
  progressCard: { gap: Spacing.twoHalf },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  profileSummary: { gap: Spacing.two },
});
