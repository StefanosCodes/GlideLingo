import { Pressable, StyleSheet, Text } from 'react-native';

import { Fonts, Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { GlideButtonProps } from './glide-button.types';

export type { GlideButtonProps } from './glide-button.types';

export function GlideButton({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  fullWidth = false,
  disabled = false,
  testID,
  style,
}: GlideButtonProps) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          backgroundColor: isPrimary ? theme.tint : 'transparent',
          borderColor: isSecondary ? theme.border : 'transparent',
          height: size === 'large' ? 48 : 40,
          opacity: disabled ? 0.38 : pressed ? 0.68 : 1,
        },
        style,
      ]}>
      <Text style={[styles.label, { color: isPrimary ? theme.textInverse : theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    borderWidth: 1,
    cursor: 'pointer',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  label: { fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 20 },
});
