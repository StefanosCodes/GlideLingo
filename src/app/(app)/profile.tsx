import { Pressable, StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideSurface } from '@/components/ui/glide-surface';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  capabilityStateForMode,
  strongestCapabilityEvidence,
  type WeeklyPracticeGoal,
} from '@/features/learning-progress/evidence-policy';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

const skillProfile = [
  { id: 'listening', label: 'Listening' },
  { id: 'speaking', label: 'Speaking' },
  { id: 'reading', label: 'Reading' },
  { id: 'writing', label: 'Writing' },
] as const;

const rhythmOptions = [2, 3, 5] as const;

const stateLabel = {
  unseen: 'Not yet',
  introduced: 'Introduced',
  practiced: 'Practiced',
  demonstrated: 'Demonstrated',
  retained: 'Retained',
} as const;

export default function ProfileScreen() {
  const theme = useTheme();
  const {
    language,
    enrolledCourse,
    currentModule,
    progress,
    lessonEvidence,
    practiceDaysThisWeek,
    weeklyPracticeGoal,
    completedModuleIds,
    setWeeklyPracticeGoal,
  } = useLearning();
  const percent = Math.round(progress * 100);
  const capabilities = strongestCapabilityEvidence(lessonEvidence);
  const strongest = capabilities[0] ?? null;

  function setRhythm(goal: WeeklyPracticeGoal) {
    setWeeklyPracticeGoal(goal);
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          PROFILE · {language.name.toUpperCase()}
        </ThemedText>
        <ThemedText type="display">Your learning, kept in one place.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Course completion, practice rhythm, and demonstrated ability stay separate so every claim remains meaningful.
        </ThemedText>
      </View>

      <GlideSurface padding="roomy" style={styles.identityCard}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText style={styles.avatarText}>{language.flag}</ThemedText>
        </View>
        <View style={styles.identityCopy}>
          <ThemedText type="title2">{enrolledCourse?.title ?? `${language.name} learner`}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {enrolledCourse
              ? `${completedModuleIds.length} of ${enrolledCourse.modules.length} quests complete · ${percent}% of the course path`
              : language.available
                ? 'Choose a course to begin building your profile.'
                : 'No published course is available yet.'}
          </ThemedText>
        </View>
      </GlideSurface>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            WHAT YOU CAN DO
          </ThemedText>
          <ThemedText type="title2">Capability portfolio</ThemedText>
        </View>
        <GlideSurface padding="roomy" style={styles.block} variant={strongest ? 'success' : 'card'}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            {strongest ? stateLabel[strongest.state].toUpperCase() : 'NEXT CAPABILITY'}
          </ThemedText>
          <ThemedText type="title2">
            {strongest?.capability.canDo
              ?? currentModule?.canDo
              ?? (language.available
                ? 'Start a quest to collect ability evidence.'
                : `${language.name} has no published capability path yet.`)}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {strongest
              ? strongest.state === 'demonstrated'
                ? 'Shown in a fresh checkpoint. A delayed, varied check is still required before this becomes retained.'
                : strongest.state === 'practiced'
                  ? 'Built with support or recovery. A fresh first attempt can demonstrate it.'
                  : 'Encountered with instruction. It still needs useful practice.'
              : currentModule
                ? `Current quest: ${currentModule.title}. This is the target, not evidence yet.`
                : 'Nothing is inferred from time spent or empty taps.'}
          </ThemedText>
        </GlideSurface>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            YOUR RHYTHM
          </ThemedText>
          <ThemedText type="title2">
            {weeklyPracticeGoal
              ? `${practiceDaysThisWeek} of ${weeklyPracticeGoal} practice days this week`
              : 'Choose a weekly pace you can keep'}
          </ThemedText>
        </View>
        <GlideSurface padding="roomy" style={styles.block}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Missing a day never erases completed work or capability evidence.
          </ThemedText>
          {weeklyPracticeGoal ? (
            <ProgressBar
              accessibilityLabel={`${practiceDaysThisWeek} of ${weeklyPracticeGoal} planned practice days complete this week`}
              value={practiceDaysThisWeek / weeklyPracticeGoal}
            />
          ) : null}
          <View accessibilityRole="radiogroup" style={styles.rhythmChoices}>
            {rhythmOptions.map((goal) => {
              const selected = weeklyPracticeGoal === goal;
              return (
                <Pressable
                  key={goal}
                  aria-checked={selected}
                  accessibilityLabel={`${goal} practice days per week`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setRhythm(goal)}
                  style={({ pressed }) => [
                    styles.rhythmChoice,
                    {
                      backgroundColor: selected ? theme.backgroundSelected : theme.surface,
                      borderColor: selected ? theme.tint : theme.border,
                      opacity: pressed ? 0.68 : 1,
                    },
                  ]}>
                  <ThemedText type="footnote">{goal} days</ThemedText>
                </Pressable>
              );
            })}
          </View>
          {weeklyPracticeGoal ? (
            <Pressable accessibilityRole="button" onPress={() => setWeeklyPracticeGoal(null)} style={styles.clearRhythm}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Use no weekly target
              </ThemedText>
            </Pressable>
          ) : null}
        </GlideSurface>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            SKILL PROFILE
          </ThemedText>
          <ThemedText type="title2">Evidence by communication mode</ThemedText>
        </View>
        <GlideSurface padding="none">
          {skillProfile.map((skill, index) => (
            <View
              key={skill.id}
              style={[
                styles.skillRow,
                index < skillProfile.length - 1 && {
                  borderBottomColor: theme.separator,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}>
              <ThemedText type="headline">{skill.label}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {stateLabel[capabilityStateForMode(lessonEvidence, skill.id)]}
              </ThemedText>
            </View>
          ))}
        </GlideSurface>
      </View>

      {enrolledCourse ? (
        <View style={[styles.milestone, { borderTopColor: theme.separator }]}>
          <ThemedText type="title3">{percent}%</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            COURSE PATH · {enrolledCourse.title.toUpperCase()} · COMPLETION ONLY
          </ThemedText>
        </View>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 560 },
  identityCard: { alignItems: 'center', flexDirection: 'row', gap: Spacing.three },
  avatar: { alignItems: 'center', borderRadius: Radii.capsule, height: 52, justifyContent: 'center', width: 52 },
  avatarText: { fontFamily: Fonts.sans, fontSize: 26, lineHeight: 32 },
  identityCopy: { flex: 1, gap: Spacing.half },
  section: { gap: Spacing.three },
  sectionHeading: { gap: Spacing.one },
  block: { gap: Spacing.twoHalf },
  rhythmChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
  rhythmChoice: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 72,
    paddingHorizontal: Spacing.twoHalf,
  },
  clearRhythm: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 40 },
  skillRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: Spacing.three,
    minHeight: 56,
    paddingVertical: Spacing.twoHalf,
  },
  milestone: { borderTopWidth: StyleSheet.hairlineWidth, gap: Spacing.half, paddingTop: Spacing.four },
});
