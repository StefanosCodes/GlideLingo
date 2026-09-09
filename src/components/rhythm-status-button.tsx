import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideSymbol } from '@/components/ui/glide-symbol';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

type PressState = { pressed: boolean; hovered?: boolean };

export function RhythmStatusButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const theme = useTheme();
  const { rhythmSummary } = useLearning();
  const { activeGoal, currentStreakWeeks, practiceDaysThisWeek } = rhythmSummary;
  const label = !activeGoal
    ? 'Set rhythm'
    : currentStreakWeeks > 0
      ? `${currentStreakWeeks} wk`
      : `${practiceDaysThisWeek}/${activeGoal}`;
  const accessibilityLabel = !activeGoal
    ? 'Set a weekly practice rhythm'
    : `${currentStreakWeeks}-week rhythm streak. ${practiceDaysThisWeek} of ${activeGoal} practice days this week.`;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={() => router.push('/rhythm')}
      style={({ pressed, hovered }: PressState) => [
        styles.button,
        compact && styles.buttonCompact,
        {
          backgroundColor: theme.warningSoft,
          borderColor: theme.warning,
          opacity: pressed ? 0.68 : hovered ? 0.84 : 1,
        },
      ]}
      testID="rhythm-status-button">
      <GlideSymbol
        name={{ ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' }}
        size={16}
        tintColor={theme.warning}
      />
      {!compact ? (
        <ThemedText numberOfLines={1} style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const webClickable = Platform.select({ web: { cursor: 'pointer' as const }, default: {} });

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: Radii.capsule,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.one,
    height: 36,
    paddingHorizontal: Spacing.twoHalf,
    ...webClickable,
  },
  label: { fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 18 },
  buttonCompact: { height: 44, justifyContent: 'center', paddingHorizontal: 0, width: 44 },
});
