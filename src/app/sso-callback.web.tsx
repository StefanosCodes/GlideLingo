import { useClerk } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { Spacing } from '@/constants/theme';
import { wasSsoCallbackCancelled } from '@/features/auth/sso-callback-recovery';
import { useTheme } from '@/hooks/use-theme';

type CallbackState = 'completing' | 'cancelled' | 'failed';

export default function SsoCallbackRoute() {
  const clerk = useClerk();
  const router = useRouter();
  const theme = useTheme();
  const [callbackState, setCallbackState] = useState<CallbackState>(() =>
    typeof window !== 'undefined' && wasSsoCallbackCancelled(window.location.href)
      ? 'cancelled'
      : 'completing',
  );

  useEffect(() => {
    if (callbackState !== 'completing') return;

    let active = true;
    void clerk
      .handleRedirectCallback({
        signInFallbackRedirectUrl: '/',
        signUpFallbackRedirectUrl: '/',
      })
      .catch(() => {
        if (active) setCallbackState('failed');
      });
    return () => {
      active = false;
    };
  }, [callbackState, clerk]);

  const returnToSignIn = () => router.replace('/sign-in');

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="auth-sso-callback">
      {callbackState === 'cancelled' ? (
        <View style={styles.recovery}>
          <ThemedText accessibilityRole="alert" type="title2">
            Sign in was cancelled.
          </ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.centeredCopy}>
            Your account was not changed. Return to sign in whenever you are ready.
          </ThemedText>
          <GlideButton
            label="Return to sign in"
            onPress={returnToSignIn}
            testID="auth-callback-cancelled-return"
          />
        </View>
      ) : callbackState === 'failed' ? (
        <View style={styles.recovery}>
          <ThemedText accessibilityRole="alert" type="title2" style={{ color: theme.danger }}>
            Sign in could not be completed.
          </ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.centeredCopy}>
            The sign-in response could not be verified. Return to sign in and start a new attempt.
          </ThemedText>
          <GlideButton
            label="Try sign in again"
            onPress={returnToSignIn}
            testID="auth-callback-failed-retry"
          />
        </View>
      ) : (
        <>
          <ActivityIndicator accessibilityLabel="Completing sign in" color={theme.tint} size="large" />
          <ThemedText type="body" themeColor="textSecondary">
            Completing sign in…
          </ThemedText>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centeredCopy: { maxWidth: 460, textAlign: 'center' },
  recovery: { alignItems: 'center', gap: Spacing.twoHalf },
  screen: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.two,
    justifyContent: 'center',
    padding: Spacing.threeHalf,
  },
});
