import { Link, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import {
  emailValidationMessage,
  normalizeAuthEmail,
  passwordValidationMessage,
  safeAuthIssue,
  type AuthIssueField,
  unsupportedAuthStateMessage,
} from '@/features/auth/credential-auth';
import {
  AuthAlert,
  AuthField,
  CredentialAuthScreen,
  credentialAuthStyles,
} from '@/features/auth/credential-auth-ui.web';
import { useTheme } from '@/hooks/use-theme';
import { useSignIn } from '@/providers/clerk-runtime';

export default function SignInRoute() {
  const theme = useTheme();
  const { fetchStatus, signIn } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<AuthIssueField | null>(null);
  const busy = submitting || fetchStatus === 'fetching';

  const clearError = () => {
    setErrorMessage(null);
    setErrorField(null);
  };

  const showAuthError = (error: unknown, fallback: string) => {
    const issue = safeAuthIssue(error, fallback);
    setErrorMessage(issue.message);
    setErrorField(issue.field);
  };

  const submit = async () => {
    if (busy) return;
    const emailError = emailValidationMessage(email);
    const passwordError = passwordValidationMessage(password);
    if (emailError || passwordError) {
      setErrorMessage(emailError ?? passwordError);
      setErrorField(emailError ? 'email' : 'password');
      return;
    }

    setSubmitting(true);
    clearError();
    try {
      const result = await signIn.password({
        emailAddress: normalizeAuthEmail(email),
        password,
      });
      if (result.error) {
        showAuthError(result.error, 'We could not sign you in right now. Check your connection and try again.');
        return;
      }
      if (signIn.status !== 'complete') {
        setErrorMessage(unsupportedAuthStateMessage());
        setErrorField(null);
        return;
      }

      const finalized = await signIn.finalize();
      if (finalized.error) {
        showAuthError(finalized.error, 'We could not finish signing you in. Please try again.');
        return;
      }
      setPassword('');
      router.replace('/');
    } catch (error) {
      showAuthError(error, 'We could not sign you in right now. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CredentialAuthScreen
      heading="Welcome back."
      subheading="Sign in with the email and password you use for GlideLingo."
      testID="auth-sign-in">
      <AuthField
        autoCapitalize="none"
        autoComplete="email"
        editable={!busy}
        keyboardType="email-address"
        label="Email address"
        errorMessage={errorField === 'email' ? errorMessage : null}
        onChangeText={(value) => {
          setEmail(value);
          clearError();
        }}
        placeholder="you@example.com"
        returnKeyType="next"
        testID="sign-in-email"
        textContentType="emailAddress"
        value={email}
      />
      <AuthField
        autoCapitalize="none"
        autoComplete="current-password"
        editable={!busy}
        label="Password"
        errorMessage={errorField === 'password' ? errorMessage : null}
        onChangeText={(value) => {
          setPassword(value);
          clearError();
        }}
        onSubmitEditing={() => void submit()}
        placeholder="Your password"
        returnKeyType="done"
        secureTextEntry
        testID="sign-in-password"
        textContentType="password"
        value={password}
      />
      {errorMessage && !['email', 'password'].includes(errorField ?? '') ? (
        <AuthAlert>{errorMessage}</AuthAlert>
      ) : null}
      <View style={credentialAuthStyles.actions}>
        <GlideButton
          disabled={busy}
          fullWidth
          label={busy ? 'Signing in…' : 'Sign in'}
          onPress={() => void submit()}
          testID="sign-in-submit"
        />
      </View>
      <View style={credentialAuthStyles.footer}>
        <Link href={'/forgot-password' as never} style={{ color: theme.tint }} testID="forgot-password-link">
          Forgot your password?
        </Link>
        <ThemedText type="body" themeColor="textSecondary">
          New to GlideLingo?{' '}
          <Link href={'/sign-up' as never} style={{ color: theme.tint }} testID="auth-create-account-link">
            Create an account
          </Link>
        </ThemedText>
      </View>
    </CredentialAuthScreen>
  );
}
