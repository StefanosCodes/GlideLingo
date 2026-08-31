import { useClerk, useUser } from '@clerk/expo';
import { type PropsWithChildren, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { authErrorMessage } from './auth-error-message';
import { hasFirstName, normalizedFirstName } from './auth-profile';
import { signOutFromProfileCompletion } from './profile-completion-session';

const MAX_FIRST_NAME_LENGTH = 64;

export function FirstNameCompletionGate({ children }: PropsWithChildren) {
  const theme = useTheme();
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const [firstName, setFirstName] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isLoaded) {
    return (
      <View
        accessibilityLabel="Loading your profile"
        accessibilityRole="progressbar"
        style={[styles.loading, { backgroundColor: theme.background }]}
        testID="profile-completion-loading">
        <ActivityIndicator color={theme.tint} size="large" />
      </View>
    );
  }

  if (!isSignedIn || !user || hasFirstName(user.firstName)) {
    return children;
  }

  const value = normalizedFirstName(firstName);
  const canSave = value.length > 0 && !saving;

  const saveFirstName = async () => {
    if (!canSave) return;

    setSaving(true);
    setErrorMessage(null);

    try {
      await user.update({ firstName: value });
    } catch (error) {
      setErrorMessage(authErrorMessage(error, 'We could not save your name. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleUseAnotherAccount = async () => {
    if (saving) return;
    setSaving(true);
    setErrorMessage(null);
    const signOutError = await signOutFromProfileCompletion(() => signOut());
    if (signOutError) {
      setErrorMessage(signOutError);
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.background }]}
      testID="first-name-completion">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            ONE LAST DETAIL
          </ThemedText>
          <ThemedText type="display" style={styles.centeredCopy}>
            What should we call you?
          </ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.centeredCopy}>
            Your first name is enough. You can update it later from your account.
          </ThemedText>
        </View>

        <GlideSurface padding="roomy" style={styles.card}>
          <ThemedText nativeID="first-name-label" type="headline">
            First name
          </ThemedText>
          <TextInput
            accessibilityLabel="First name"
            autoCapitalize="words"
            autoComplete="name-given"
            editable={!saving}
            enterKeyHint="done"
            maxLength={MAX_FIRST_NAME_LENGTH}
            onChangeText={(nextValue) => {
              setFirstName(nextValue);
              if (errorMessage) setErrorMessage(null);
            }}
            onSubmitEditing={() => void saveFirstName()}
            placeholder="Your first name"
            placeholderTextColor={theme.textTertiary}
            returnKeyType="done"
            style={[
              styles.input,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text },
            ]}
            textContentType="givenName"
            value={firstName}
          />
          <GlideButton
            disabled={!canSave}
            fullWidth
            label={saving ? 'Saving…' : 'Continue'}
            onPress={() => void saveFirstName()}
            testID="save-first-name"
          />
          <GlideButton
            disabled={saving}
            fullWidth
            label="Use another account"
            onPress={() => void handleUseAnotherAccount()}
            testID="profile-completion-sign-out"
            variant="tertiary"
          />
          {errorMessage ? (
            <ThemedText accessibilityRole="alert" type="footnote" style={{ color: theme.danger }}>
              {errorMessage}
            </ThemedText>
          ) : null}
        </GlideSurface>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.twoHalf, maxWidth: 440, width: '100%' },
  centeredCopy: { maxWidth: 460, textAlign: 'center' },
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
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  screen: { flex: 1 },
  scrollContent: {
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.four,
    justifyContent: 'center',
    padding: Spacing.threeHalf,
  },
});
