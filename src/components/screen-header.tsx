import { Pressable, StyleSheet, View } from 'react-native';

import { LanguagePicker } from '@/components/language-picker';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

export function ScreenHeader() {
  const theme = useTheme();
  const { streakDays } = useLearning();

  return (
    <View style={styles.row}>
      <LanguagePicker />
      <Pressable
        accessibilityLabel={`${streakDays} day learning streak`}
        accessibilityRole="button"
        style={({ pressed }) => [styles.streak, { borderColor: theme.border }, pressed && styles.pressed]}>
        <ThemedText type="caption" themeColor="textSecondary">
          {streakDays} DAY STREAK
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'flex-end',
    overflow: 'visible',
    zIndex: 100,
  },
  streak: {
    alignItems: 'center',
    borderRadius: Radii.capsule,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.twoHalf,
  },
  pressed: { opacity: 0.58 },
});
