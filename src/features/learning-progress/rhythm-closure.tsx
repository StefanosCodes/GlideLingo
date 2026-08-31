import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GlideSymbol } from '@/components/ui/glide-symbol';
import { Motion, Radii, Spacing } from '@/constants/theme';
import type { PracticeCompletionResult } from '@/features/learning-progress/rhythm-policy';
import { useTheme } from '@/hooks/use-theme';

export function RhythmClosure({ result }: { result: PracticeCompletionResult | null }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(result?.weeklyGoalReachedNow && !reduceMotion ? 0.96 : 1);

  useEffect(() => {
    if (result?.weeklyGoalReachedNow && !reduceMotion) {
      scale.value = withTiming(1, { duration: Motion.deliberate });
    }
  }, [reduceMotion, result?.weeklyGoalReachedNow, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (!result?.dayWasNew || !result.summary.activeGoal) return null;

  const { activeGoal, currentStreakWeeks, practiceDaysThisWeek } = result.summary;
  const firstWeek = result.weeklyGoalReachedNow && currentStreakWeeks === 1;
  const summary = result.weeklyGoalReachedNow
    ? firstWeek
      ? 'Your first steady week is complete.'
      : `Your ${currentStreakWeeks}-week rhythm streak continues.`
    : `${practiceDaysThisWeek} of ${activeGoal} practice days this week.`;
  const kicker = result.weeklyGoalReachedNow
    ? result.milestone && result.milestone > 1
      ? `${result.milestone}-WEEK MILESTONE`
      : 'WEEK COMPLETE'
    : 'YOUR RHYTHM';

  return (
    <Animated.View
      accessibilityLabel={`${kicker}. ${summary}`}
      accessible
      style={[
        styles.surface,
        { backgroundColor: theme.warningSoft, borderColor: theme.warning },
        animatedStyle,
      ]}
      testID="rhythm-closure">
      <View style={styles.heading}>
        <GlideSymbol
          name={{ ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' }}
          size={18}
          tintColor={theme.warning}
        />
        <ThemedText type="eyebrow" themeColor="textSecondary">
          {kicker}
        </ThemedText>
      </View>
      <ThemedText type={result.weeklyGoalReachedNow ? 'headline' : 'footnote'}>{summary}</ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  surface: {
    alignSelf: 'stretch',
    borderRadius: Radii.large,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.one,
    padding: Spacing.three,
  },
  heading: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
});
