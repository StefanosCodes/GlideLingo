import { useClerk } from '@clerk/expo';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function SsoCallbackRoute() {
  const clerk = useClerk();
  const theme = useTheme();
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void clerk
      .handleRedirectCallback({
        signInFallbackRedirectUrl: '/',
        signUpFallbackRedirectUrl: '/',
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [clerk]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="auth-sso-callback">
      {error ? (
        <ThemedText accessibilityRole="alert" type="body" style={{ color: theme.danger }}>
          Sign in could not be completed. Return to the sign-in screen and try again.
        </ThemedText>
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
  screen: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.two,
    justifyContent: 'center',
    padding: Spacing.threeHalf,
  },
});
