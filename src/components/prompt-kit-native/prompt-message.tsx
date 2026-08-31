import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type PromptMessageProps = {
  role: 'user' | 'assistant';
  children: ReactNode;
  label?: string;
};

export function PromptMessage({ role, children, label }: PromptMessageProps) {
  const theme = useTheme();
  const isUser = role === 'user';

  return (
    <View style={[styles.message, isUser && styles.userMessage]}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        {label ?? (isUser ? 'YOU' : 'GLIDELINGO')}
      </ThemedText>
      <View
        style={[
          styles.content,
          isUser && { backgroundColor: theme.surfaceSecondary, borderRadius: Radii.medium, padding: Spacing.three },
        ]}>
        <ThemedText type={isUser ? 'body' : 'title3'}>{children}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  message: { gap: Spacing.two, maxWidth: 520 },
  userMessage: { alignSelf: 'flex-end', maxWidth: '88%' },
  content: { gap: Spacing.two },
});
