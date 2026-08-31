import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type PromptSuggestionProps = Omit<PressableProps, 'children' | 'style'> & {
  children: ReactNode;
  selected?: boolean;
};

export function PromptSuggestion({ children, selected = false, ...props }: PromptSuggestionProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      {...props}
      style={({ pressed }) => [
        styles.suggestion,
        {
          backgroundColor: selected ? theme.tintSoft : 'transparent',
          borderColor: selected ? theme.textSecondary : theme.border,
          opacity: pressed ? 0.62 : 1,
        },
      ]}>
      <ThemedText type="footnote">{children}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  suggestion: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radii.capsule,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: Spacing.twoHalf,
    paddingVertical: 7,
  },
});
