import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { AccountSummary } from '@/features/auth/account-summary';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

const skillProfile = [
  { id: 'listening', label: 'Listening', empty: 'Not yet' },
  { id: 'speaking', label: 'Speaking', empty: 'Not yet' },
  { id: 'reading', label: 'Reading', empty: 'Not yet' },
  { id: 'writing', label: 'Writing', empty: 'Not yet' },
] as const;

export default function ProgressScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    language,
    enrolledCourse,
    currentModule,
    progress,
    completedLessonIds,
    legacyProgressAvailable,
    legacyProgressError,
    dismissLegacyProgress,
    importLegacyProgress,
  } = useLearning();
  const percent = Math.round(progress * 100);
  const introduced = completedLessonIds.length > 0;

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          PROGRESS · {language.name.toUpperCase()}
          {enrolledCourse ? ` · ${enrolledCourse.levelLabel}` : ''}
        </ThemedText>
        <ThemedText type="display">What you can now do.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Evidence of real-world ability, not XP. Skills stay quiet until a lesson produces an attempt.
        </ThemedText>
      </View>

      <GlideSurface padding="roomy" style={styles.block}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          CAN DO
        </ThemedText>
        <ThemedText type="title2">
          {currentModule?.canDo ??
            (language.available
              ? 'Start a course to collect demonstrated abilities.'
              : `${language.name} is listed, not teaching yet.`)}
        </ThemedText>
        {currentModule ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            Current module: {currentModule.title}. Independent use still needs a delayed check.
          </ThemedText>
        ) : null}
      </GlideSurface>

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
              {introduced ? 'Introduced' : skill.empty}
            </ThemedText>
          </View>
        ))}
      </GlideSurface>

      {legacyProgressAvailable ? (
        <GlideSurface padding="roomy" style={styles.membership} variant="tinted">
          <View style={styles.membershipCopy}>
            <ThemedText type="eyebrow" themeColor="textSecondary">
              EXISTING PROGRESS FOUND
            </ThemedText>
            <ThemedText type="title3">Bring this browser’s earlier progress into your account?</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              Import only if this progress is yours. Earlier lessons will be combined with this account without replacing
              newer progress, then removed from the older shared browser storage.
            </ThemedText>
          </View>
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

      {enrolledCourse ? (
        <View style={[styles.milestone, { borderTopColor: theme.separator }]}>
          <ThemedText type="title3">{percent}%</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            THROUGH {enrolledCourse.title.toUpperCase()}
          </ThemedText>
        </View>
      ) : null}

      <GlideSurface padding="roomy" style={styles.membership}>
        <View style={styles.membershipCopy}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            MEMBERSHIP
          </ThemedText>
          <ThemedText type="title3">GlideLingo Pro</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            View your access, choose a plan, or restore a purchase.
          </ThemedText>
        </View>
        <GlideButton label="Manage Pro" onPress={() => router.push('/subscription')} variant="secondary" />
      </GlideSurface>

      <AccountSummary />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 520 },
  block: { gap: Spacing.two },
  skillRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: Spacing.three,
    minHeight: 56,
    paddingVertical: Spacing.twoHalf,
  },
  milestone: { borderTopWidth: StyleSheet.hairlineWidth, gap: Spacing.half, paddingTop: Spacing.four },
  membership: { gap: Spacing.three },
  membershipCopy: { gap: Spacing.one },
  legacyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
