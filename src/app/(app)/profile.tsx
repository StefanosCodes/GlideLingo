import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { AccountSummary } from '@/features/auth/account-summary';
import { isHumanTutorCommerceEnabled, isHumanTutorMarketplaceEnabled, isHumanTutorMessagingEnabled } from '@/features/tutor-marketplace/config';
import {
  capabilityStateForMode,
  strongestCapabilityEvidence,
} from '@/features/learning-progress/evidence-policy';
import type { WeeklyPracticeGoal } from '@/features/learning-progress/rhythm-policy';
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
  const router = useRouter();
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
    legacyProgressAvailable,
    legacyProgressError,
    persistenceStatus,
    setWeeklyPracticeGoal,
    dismissLegacyProgress,
    importLegacyProgress,
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

      {persistenceStatus !== 'available' ? (
        <GlideSurface accessibilityRole="alert" padding="roomy" style={styles.block} variant="tinted">
          <ThemedText type="headline">
            {persistenceStatus === 'corrupt'
              ? 'Saved progress could not be read safely.'
              : 'Progress is being kept for this session only.'}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {persistenceStatus === 'corrupt'
              ? 'GlideLingo left the stored value untouched instead of replacing it with an empty profile.'
              : 'Device storage is unavailable. Your session still works, but changes may not survive a restart.'}
          </ThemedText>
        </GlideSurface>
      ) : null}

      {legacyProgressAvailable ? (
        <GlideSurface padding="roomy" style={styles.block} variant="tinted">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            EXISTING PROGRESS FOUND
          </ThemedText>
          <ThemedText type="title3">Bring this device’s earlier progress into your account?</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Import only if this progress is yours. Lessons, ability evidence, practice dates, and weekly goals are combined
            with this account before the older shared copy is removed.
          </ThemedText>
          <View style={styles.legacyActions}>
            <GlideButton label="Import progress" onPress={importLegacyProgress} size="regular" />
            <GlideButton label="Not mine" onPress={dismissLegacyProgress} size="regular" variant="tertiary" />
          </View>
          {legacyProgressError ? (
            <ThemedText accessibilityRole="alert" type="footnote" style={{ color: theme.danger }}>
              {legacyProgressError}
            </ThemedText>
          ) : null}
        </GlideSurface>
      ) : null}

      <GlideSurface padding="roomy" style={styles.block}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          MEMBERSHIP
        </ThemedText>
        <ThemedText type="title3">GlideLingo Pro</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          View your access, choose a plan, or restore a purchase.
        </ThemedText>
        <GlideButton label="Manage Pro" onPress={() => router.push('/subscription')} variant="secondary" />
      </GlideSurface>

      <AccountSummary />

      {isHumanTutorMarketplaceEnabled() ? (
        <GlideSurface padding="roomy" style={styles.block}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            HUMAN TUTOR MARKETPLACE
          </ThemedText>
          <ThemedText type="title3">Learn with or become a human tutor.</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Create a private tutor application for the invitation-only marketplace.
          </ThemedText>
          <View style={styles.legacyActions}>
            <GlideButton label="Find a tutor" onPress={() => router.push('/tutors')} variant="secondary" />
            {isHumanTutorMessagingEnabled() ? <GlideButton label="Tutor messages" onPress={() => router.push('/messages')} variant="secondary" /> : null}
            {isHumanTutorCommerceEnabled() ? <GlideButton label="Tutor bookings" onPress={() => router.push('/bookings')} variant="secondary" /> : null}
            <GlideButton label="Apply to become a tutor" onPress={() => router.push('/tutor/apply')} variant="secondary" />
            <GlideButton label="Manage tutor availability" onPress={() => router.push('/tutor/availability')} variant="tertiary" />
            {isHumanTutorCommerceEnabled() ? <GlideButton label="Tutor payouts and meeting" onPress={() => router.push('/tutor/payouts')} variant="tertiary" /> : null}
          </View>
        </GlideSurface>
      ) : null}

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
          <GlideButton label="Open rhythm calendar" variant="secondary" onPress={() => router.push('/rhythm')} />
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
  legacyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
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
