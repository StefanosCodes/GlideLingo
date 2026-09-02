import { SignIn } from '@clerk/expo/web';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getDesktopOAuthTransport } from '@/features/auth/desktop-oauth-transport';
import { DESKTOP_AUTH_CALLBACK_URL, selectWebOauthFlow } from '@/features/auth/oauth-flow';
import { SIGN_IN_METHODS_COPY } from '@/features/auth/sign-in-copy';
import { useTheme } from '@/hooks/use-theme';

export default function SignInRoute() {
  const theme = useTheme();
  const oauthFlow = selectWebOauthFlow({
    protocol: typeof window === 'undefined' ? '' : window.location.protocol,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  });
  const desktopCallbackUrl = oauthFlow === 'redirect'
    ? DESKTOP_AUTH_CALLBACK_URL
    : undefined;
  const usesDesktopOAuthTransport = Boolean(getDesktopOAuthTransport());

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="auth-sign-in">
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          GLIDELINGO ACCOUNT
        </ThemedText>
        <ThemedText type="display" style={styles.centeredCopy}>
          Keep your language moving.
        </ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.centeredCopy}>
          {SIGN_IN_METHODS_COPY}
        </ThemedText>
      </View>
      <SignIn
        fallbackRedirectUrl="/"
        forceRedirectUrl={usesDesktopOAuthTransport ? undefined : desktopCallbackUrl}
        oauthFlow={oauthFlow}
        routing="hash"
        signUpFallbackRedirectUrl="/"
        signUpForceRedirectUrl={usesDesktopOAuthTransport ? undefined : desktopCallbackUrl}
        withSignUp
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centeredCopy: { maxWidth: 460, textAlign: 'center' },
  intro: { alignItems: 'center', gap: Spacing.two },
  screen: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.four,
    justifyContent: 'center',
    padding: Spacing.threeHalf,
  },
});
