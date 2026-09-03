import { type PropsWithChildren, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function CredentialAuthScreen({
  children,
  heading,
  subheading,
  testID,
}: PropsWithChildren<{ heading: string; subheading: string; testID: string }>) {
  const theme = useTheme();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.background }]}
      testID={testID}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            GLIDELINGO ACCOUNT
          </ThemedText>
          <ThemedText type="display" style={styles.centeredCopy}>
            {heading}
          </ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.centeredCopy}>
            {subheading}
          </ThemedText>
        </View>
        <GlideSurface padding="roomy" style={styles.card}>
          {children}
        </GlideSurface>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AuthField({
  label,
  testID,
  ...props
}: TextInputProps & { label: string; testID: string }) {
  const theme = useTheme();

  return (
    <View style={styles.field}>
      <ThemedText type="headline">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textTertiary}
        style={[
          styles.input,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text },
        ]}
        testID={testID}
        {...props}
      />
    </View>
  );
}

export function AuthAlert({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ThemedText accessibilityRole="alert" type="footnote" style={{ color: theme.danger }} testID="auth-error">
      {children}
    </ThemedText>
  );
}

export function AuthHint({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="footnote" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}

export const credentialAuthStyles = StyleSheet.create({
  actions: { gap: Spacing.two },
  footer: { alignItems: 'center', gap: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center' },
});

const styles = StyleSheet.create({
  card: { gap: Spacing.three, maxWidth: 440, width: '100%' },
  centeredCopy: { maxWidth: 480, textAlign: 'center' },
  field: { gap: Spacing.two },
  input: {
    borderRadius: Radii.medium,
    borderWidth: 1,
    fontFamily: Fonts.sans,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twoHalf,
  },
  intro: { alignItems: 'center', gap: Spacing.two },
  screen: { flex: 1 },
  scrollContent: {
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.four,
    justifyContent: 'center',
    padding: Spacing.threeHalf,
  },
});
