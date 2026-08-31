import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ProgressBar({ value, color, style }: { value: number; color?: string; style?: ViewStyle }) {
  const theme = useTheme();
  const normalizedValue = Math.max(0, Math.min(1, value));

  return (
    <View
      accessibilityLabel={`${Math.round(normalizedValue * 100)} percent complete`}
      accessibilityRole="progressbar"
      style={[styles.track, { backgroundColor: theme.surfaceSecondary }, style]}>
      <View style={[styles.fill, { backgroundColor: color ?? theme.tint, width: `${normalizedValue * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 7, borderRadius: Radii.capsule, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radii.capsule },
});
