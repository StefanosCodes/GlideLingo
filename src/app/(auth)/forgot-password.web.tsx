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

type RecoveryStep = 'email' | 'code' | 'password';

export default function ForgotPasswordRoute() {
  const theme = useTheme();
  const { fetchStatus, signIn } = useSignIn();
  const [step, setStep] = useState<RecoveryStep>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<AuthIssueField | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
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

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const beginRecovery = async () => {
    if (busy) return;
    const validationError = emailValidationMessage(email);
    if (validationError) {
      setErrorMessage(validationError);
      setErrorField('email');
      return;
    }
    setSubmitting(true);
    clearError();
    try {
      const created = await signIn.create({ identifier: normalizeAuthEmail(email) });
      if (created.error) {
        showAuthError(created.error, 'We could not start password recovery right now. Check your connection and try again.');
        return;
      }
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error) {
        showAuthError(sent.error, 'We could not send the recovery code right now. Please try again.');
        return;
      }
      setStep('code');
      setResendSeconds(AUTH_CODE_RESEND_SECONDS);
    } catch (error) {
      showAuthError(error, 'We could not start password recovery right now. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async () => {
    if (busy) return;
    const validationError = codeValidationMessage(code);
    if (validationError) {
      setErrorMessage(validationError);
      setErrorField('code');
      return;
    }
    setSubmitting(true);
    clearError();
    try {
      const result = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
      if (result.error) {
        showAuthError(result.error, 'We could not verify that code right now. Please try again.');
        return;
      }
      if (signIn.status !== 'needs_new_password') {
        setErrorMessage(unsupportedAuthStateMessage());
        setErrorField(null);
        return;
      }
      setCode('');
      setStep('password');
    } catch (error) {
      showAuthError(error, 'We could not verify that code right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const setNewPassword = async () => {
    if (busy) return;
    const passwordError = passwordValidationMessage(password);
    const confirmationError = confirmationValidationMessage(password, confirmation);
    if (passwordError || confirmationError) {
      setErrorMessage(passwordError ?? confirmationError);
      setErrorField(passwordError ? 'password' : 'confirmation');
      return;
    }
    setSubmitting(true);
    clearError();
    try {
      const result = await signIn.resetPasswordEmailCode.submitPassword({
        password,
        signOutOfOtherSessions: true,
      });
      if (result.error) {
        showAuthError(result.error, 'We could not update your password right now. Please try again.');
        return;
      }
      if (signIn.status !== 'complete') {
        setErrorMessage(unsupportedAuthStateMessage());
        setErrorField(null);
        return;
      }
      const finalized = await signIn.finalize();
      if (finalized.error) {
        showAuthError(finalized.error, 'Your password changed, but sign-in did not finish. Sign in again.');
        return;
      }
      setPassword('');
      setConfirmation('');
      router.replace('/');
    } catch (error) {
      showAuthError(error, 'We could not update your password right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    if (busy || resendSeconds > 0) return;
    setSubmitting(true);
    clearError();
    try {
      const result = await signIn.resetPasswordEmailCode.sendCode();
      if (result.error) {
        showAuthError(result.error, 'We could not send another code right now. Please try again.');
        return;
      }
      setResendSeconds(AUTH_CODE_RESEND_SECONDS);
    } catch (error) {
      showAuthError(error, 'We could not send another code right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const restart = async () => {
    if (busy) return;
    await signIn.reset();
    setStep('email');
    setCode('');
    setPassword('');
    setConfirmation('');
    clearError();
  };

  if (step === 'code') {
    return (
      <CredentialAuthScreen
        heading="Check your email."
        subheading={`Enter the recovery code sent to ${normalizeAuthEmail(email)}.`}
        testID="auth-recovery-code">
        <AuthField
          autoCapitalize="none"
          autoComplete="one-time-code"
          editable={!busy}
          keyboardType="number-pad"
          label="Recovery code"
          errorMessage={errorField === 'code' ? errorMessage : null}
          onChangeText={(value) => { setCode(value); clearError(); }}
          onSubmitEditing={() => void verifyCode()}
          placeholder="Enter code"
          returnKeyType="done"
          testID="recovery-code"
          textContentType="oneTimeCode"
          value={code}
        />
        {errorMessage && errorField !== 'code' ? <AuthAlert>{errorMessage}</AuthAlert> : null}
        <View style={credentialAuthStyles.actions}>
          <GlideButton disabled={busy} fullWidth label={busy ? 'Checking…' : 'Continue'} onPress={() => void verifyCode()} testID="recovery-code-submit" />
          <GlideButton
            disabled={busy || resendSeconds > 0}
            fullWidth
            label={resendSeconds > 0 ? `Send another code in ${resendSeconds}s` : 'Send another code'}
            onPress={() => void resendCode()}
            testID="recovery-resend"
            variant="secondary"
          />
          <GlideButton disabled={busy} fullWidth label="Use a different email" onPress={() => void restart()} testID="recovery-change-email" variant="tertiary" />
        </View>
      </CredentialAuthScreen>
    );
  }

  if (step === 'password') {
    return (
      <CredentialAuthScreen heading="Choose a new password." subheading="Use at least 8 characters." testID="auth-recovery-password">
        <AuthField autoCapitalize="none" autoComplete="new-password" editable={!busy} errorMessage={errorField === 'password' ? errorMessage : null} label="New password" onChangeText={(value) => { setPassword(value); clearError(); }} placeholder="New password" secureTextEntry testID="recovery-password" textContentType="newPassword" value={password} />
        <AuthField autoCapitalize="none" autoComplete="new-password" editable={!busy} errorMessage={errorField === 'confirmation' ? errorMessage : null} label="Confirm new password" onChangeText={(value) => { setConfirmation(value); clearError(); }} onSubmitEditing={() => void setNewPassword()} placeholder="Repeat new password" returnKeyType="done" secureTextEntry testID="recovery-password-confirmation" textContentType="newPassword" value={confirmation} />
        {errorMessage && !['password', 'confirmation'].includes(errorField ?? '') ? <AuthAlert>{errorMessage}</AuthAlert> : null}
        <GlideButton disabled={busy} fullWidth label={busy ? 'Updating password…' : 'Update password'} onPress={() => void setNewPassword()} testID="recovery-password-submit" />
      </CredentialAuthScreen>
    );
  }

  return (
    <CredentialAuthScreen heading="Reset your password." subheading="We will email you a one-time recovery code." testID="auth-forgot-password">
      <AuthField autoCapitalize="none" autoComplete="email" editable={!busy} errorMessage={errorField === 'email' ? errorMessage : null} keyboardType="email-address" label="Email address" onChangeText={(value) => { setEmail(value); clearError(); }} onSubmitEditing={() => void beginRecovery()} placeholder="you@example.com" returnKeyType="done" testID="recovery-email" textContentType="emailAddress" value={email} />
      {errorMessage && errorField !== 'email' ? <AuthAlert>{errorMessage}</AuthAlert> : null}
      <GlideButton disabled={busy} fullWidth label={busy ? 'Sending code…' : 'Send recovery code'} onPress={() => void beginRecovery()} testID="recovery-email-submit" />
      <View style={credentialAuthStyles.footer}>
        <ThemedText type="body" themeColor="textSecondary">
          Remembered it?{' '}
          <Link href={'/sign-in' as never} style={{ color: theme.tint }} testID="recovery-sign-in-link">Sign in</Link>
        </ThemedText>
      </View>
    </CredentialAuthScreen>
  );
}
