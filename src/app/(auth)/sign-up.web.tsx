import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import {
  AUTH_CODE_RESEND_SECONDS,
  codeValidationMessage,
  confirmationValidationMessage,
  emailValidationMessage,
  normalizeAuthEmail,
  passwordValidationMessage,
  safeAuthErrorMessage,
  unsupportedAuthStateMessage,
} from '@/features/auth/credential-auth';
import {
  AuthAlert,
  AuthField,
  AuthHint,
  CredentialAuthScreen,
  credentialAuthStyles,
} from '@/features/auth/credential-auth-ui.web';
import { useTheme } from '@/hooks/use-theme';
import { useSignUp } from '@/providers/clerk-runtime';

type SignUpStep = 'credentials' | 'verification';

export default function SignUpRoute() {
  const theme = useTheme();
  const { fetchStatus, signUp } = useSignUp();
  const [step, setStep] = useState<SignUpStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const busy = submitting || fetchStatus === 'fetching';

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const finish = async () => {
    if (signUp.status !== 'complete') {
      setErrorMessage(unsupportedAuthStateMessage());
      return;
    }
    const finalized = await signUp.finalize();
    if (finalized.error) {
      setErrorMessage(safeAuthErrorMessage(finalized.error, 'We could not finish creating your account. Please try again.'));
      return;
    }
    setPassword('');
    setConfirmation('');
    setCode('');
    router.replace('/');
  };

  const createAccount = async () => {
    if (busy) return;
    const validationError =
      emailValidationMessage(email) ??
      passwordValidationMessage(password) ??
      confirmationValidationMessage(password, confirmation);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await signUp.password({ emailAddress: normalizeAuthEmail(email), password });
      if (result.error) {
        setErrorMessage(safeAuthErrorMessage(result.error, 'We could not create your account. Check your details and try again.'));
        return;
      }
      if (signUp.status === 'complete') {
        await finish();
        return;
      }
      if (!signUp.unverifiedFields.includes('email_address')) {
        setErrorMessage(unsupportedAuthStateMessage());
        return;
      }

      const sent = await signUp.verifications.sendEmailCode();
      if (sent.error) {
        setErrorMessage(safeAuthErrorMessage(sent.error, 'We could not send the verification code. Please try again.'));
        return;
      }
      setPassword('');
      setConfirmation('');
      setStep('verification');
      setResendSeconds(AUTH_CODE_RESEND_SECONDS);
    } catch (error) {
      setErrorMessage(safeAuthErrorMessage(error, 'We could not create your account. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const verifyEmail = async () => {
    if (busy) return;
    const validationError = codeValidationMessage(code);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (result.error) {
        setErrorMessage(safeAuthErrorMessage(result.error, 'We could not verify that code. Please try again.'));
        return;
      }
      await finish();
    } catch (error) {
      setErrorMessage(safeAuthErrorMessage(error, 'We could not verify that code. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    if (busy || resendSeconds > 0) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await signUp.verifications.sendEmailCode();
      if (result.error) {
        setErrorMessage(safeAuthErrorMessage(result.error, 'We could not send another code. Please try again.'));
        return;
      }
      setResendSeconds(AUTH_CODE_RESEND_SECONDS);
    } catch (error) {
      setErrorMessage(safeAuthErrorMessage(error, 'We could not send another code. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const restart = async () => {
    if (busy) return;
    await signUp.reset();
    setStep('credentials');
    setCode('');
    setErrorMessage(null);
  };

  if (step === 'verification') {
    return (
      <CredentialAuthScreen
        heading="Check your email."
        subheading={`Enter the verification code sent to ${normalizeAuthEmail(email)}.`}
        testID="auth-sign-up-verification">
        <AuthField
          autoCapitalize="none"
          autoComplete="one-time-code"
          editable={!busy}
          keyboardType="number-pad"
          label="Verification code"
          onChangeText={(value) => {
            setCode(value);
            setErrorMessage(null);
          }}
          onSubmitEditing={() => void verifyEmail()}
          placeholder="Enter code"
          returnKeyType="done"
          testID="sign-up-code"
          textContentType="oneTimeCode"
          value={code}
        />
        {errorMessage ? <AuthAlert>{errorMessage}</AuthAlert> : null}
        <View style={credentialAuthStyles.actions}>
          <GlideButton
            disabled={busy}
            fullWidth
            label={busy ? 'Verifying…' : 'Verify email'}
            onPress={() => void verifyEmail()}
            testID="sign-up-verify"
          />
          <GlideButton
            disabled={busy || resendSeconds > 0}
            fullWidth
            label={resendSeconds > 0 ? `Send another code in ${resendSeconds}s` : 'Send another code'}
            onPress={() => void resendCode()}
            testID="sign-up-resend"
            variant="secondary"
          />
          <GlideButton
            disabled={busy}
            fullWidth
            label="Use a different email"
            onPress={() => void restart()}
            testID="sign-up-change-email"
            variant="tertiary"
          />
        </View>
      </CredentialAuthScreen>
    );
  }

  return (
    <CredentialAuthScreen
      heading="Create your account."
      subheading="Use your email and a password. We will ask for your first name after verification."
      testID="auth-sign-up">
      <AuthField
        autoCapitalize="none"
        autoComplete="email"
        editable={!busy}
        keyboardType="email-address"
        label="Email address"
        onChangeText={(value) => { setEmail(value); setErrorMessage(null); }}
        placeholder="you@example.com"
        testID="sign-up-email"
        textContentType="emailAddress"
        value={email}
      />
      <AuthField
        autoCapitalize="none"
        autoComplete="new-password"
        editable={!busy}
        label="Password"
        onChangeText={(value) => { setPassword(value); setErrorMessage(null); }}
        placeholder="At least 8 characters"
        secureTextEntry
        testID="sign-up-password"
        textContentType="newPassword"
        value={password}
      />
      <AuthField
        autoCapitalize="none"
        autoComplete="new-password"
        editable={!busy}
        label="Confirm password"
        onChangeText={(value) => { setConfirmation(value); setErrorMessage(null); }}
        onSubmitEditing={() => void createAccount()}
        placeholder="Repeat your password"
        returnKeyType="done"
        secureTextEntry
        testID="sign-up-password-confirmation"
        textContentType="newPassword"
        value={confirmation}
      />
      <AuthHint>Your password stays private. GlideLingo never stores it.</AuthHint>
      <View nativeID="clerk-captcha" testID="clerk-captcha" />
      {errorMessage ? <AuthAlert>{errorMessage}</AuthAlert> : null}
      <GlideButton
        disabled={busy}
        fullWidth
        label={busy ? 'Creating account…' : 'Create account'}
        onPress={() => void createAccount()}
        testID="sign-up-submit"
      />
      <View style={credentialAuthStyles.footer}>
        <ThemedText type="body" themeColor="textSecondary">
          Already have an account?{' '}
          <Link href={'/sign-in' as never} style={{ color: theme.tint }} testID="sign-up-sign-in-link">
            Sign in
          </Link>
        </ThemedText>
      </View>
    </CredentialAuthScreen>
  );
}
