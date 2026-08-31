import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GlideSymbol } from '@/components/ui/glide-symbol';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThinkingBarProps = {
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function ThinkingBar({ text = 'Thinking', actionLabel = 'Answer now', onAction }: ThinkingBarProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0.4);

  useEffect(() => {
    if (!reduceMotion) {
      opacity.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    }
    return () => cancelAnimation(opacity);
  }, [opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View accessibilityLiveRegion="polite" style={styles.row}>
      <Animated.View style={[styles.status, animatedStyle]}>
        <ThemedText type="footnote">{text}</ThemedText>
        <GlideSymbol
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={13}
          tintColor={theme.textSecondary}
        />
      </Animated.View>
      {onAction && (
        <Pressable onPress={onAction} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.action}>
            {actionLabel}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  action: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 1 },
  pressed: { opacity: 0.58 },
});
