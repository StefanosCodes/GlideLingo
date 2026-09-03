import { Link, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import {
  emailValidationMessage,
  normalizeAuthEmail,
  passwordValidationMessage,
  safeAuthErrorMessage,
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
  const busy = submitting || fetchStatus === 'fetching';

  const submit = async () => {
    if (busy) return;
    const validationError = emailValidationMessage(email) ?? passwordValidationMessage(password);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await signIn.password({
        emailAddress: normalizeAuthEmail(email),
        password,
      });
      if (result.error) {
        setErrorMessage(safeAuthErrorMessage(result.error, 'We could not sign you in. Check your details and try again.'));
        return;
      }
      if (signIn.status !== 'complete') {
        setErrorMessage(unsupportedAuthStateMessage());
        return;
      }

      const finalized = await signIn.finalize();
      if (finalized.error) {
        setErrorMessage(safeAuthErrorMessage(finalized.error, 'We could not finish signing you in. Please try again.'));
        return;
      }
      setPassword('');
      router.replace('/');
    } catch (error) {
      setErrorMessage(safeAuthErrorMessage(error, 'We could not sign you in. Please try again.'));
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
        onChangeText={(value) => {
          setEmail(value);
          setErrorMessage(null);
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
        onChangeText={(value) => {
          setPassword(value);
          setErrorMessage(null);
        }}
        onSubmitEditing={() => void submit()}
        placeholder="Your password"
        returnKeyType="done"
        secureTextEntry
        testID="sign-in-password"
        textContentType="password"
        value={password}
      />
      {errorMessage ? <AuthAlert>{errorMessage}</AuthAlert> : null}
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
