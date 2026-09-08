import { SignIn } from '@clerk/expo/web';
import { StyleSheet, View } from 'react-native';

import { Fonts, Radii, Spacing } from '@/constants/theme';
import { selectWebOauthFlow } from '@/features/auth/oauth-flow';
import { useTheme } from '@/hooks/use-theme';

export default function SignInRoute() {
  const theme = useTheme();
  const oauthFlow = selectWebOauthFlow({
    protocol: typeof window === 'undefined' ? '' : window.location.protocol,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  });

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="auth-sign-in">
      <SignIn
        appearance={{
          theme: 'simple',
          variables: {
            borderRadius: `${Radii.medium}px`,
            colorBackground: theme.surface,
            colorBorder: theme.border,
            colorDanger: theme.danger,
            colorForeground: theme.text,
            colorInput: theme.backgroundElement,
            colorInputForeground: theme.text,
            colorMuted: theme.surfaceSecondary,
            colorMutedForeground: theme.textSecondary,
            colorPrimary: theme.tint,
            colorRing: theme.accentStrong,
            colorSuccess: theme.success,
            fontFamily: Fonts.sans,
            fontSize: '15px',
          },
          elements: {
            rootBox: { maxWidth: '420px', width: '100%' },
            cardBox: {
              border: `1px solid ${theme.border}`,
              borderRadius: `${Radii.large}px`,
              boxShadow: `0 1px 2px ${theme.shadow}`,
              width: '100%',
            },
            card: {
              borderRadius: `${Radii.large}px`,
              gap: `${Spacing.three}px`,
              padding: `${Spacing.four}px`,
            },
            headerTitle: {
              fontFamily: Fonts.display,
              fontSize: '26px',
              letterSpacing: '-0.78px',
              lineHeight: '32px',
            },
            headerSubtitle: {
              color: theme.textSecondary,
              fontSize: '14px',
              lineHeight: '20px',
            },
            socialButtonsBlockButton: {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              borderRadius: `${Radii.medium}px`,
              boxShadow: 'none',
              color: theme.text,
              fontFamily: Fonts.sansMedium,
              height: '48px',
            },
            dividerLine: { backgroundColor: theme.separator },
            dividerText: { color: theme.textSecondary, fontSize: '13px' },
            formFieldLabel: {
              color: theme.text,
              fontFamily: Fonts.sansMedium,
              fontSize: '14px',
              lineHeight: '20px',
            },
            formFieldAction: { color: theme.textSecondary, fontFamily: Fonts.sansMedium },
            formFieldInput: {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
              borderRadius: `${Radii.medium}px`,
              boxShadow: 'none',
              color: theme.text,
              fontFamily: Fonts.sans,
              fontSize: '16px',
              height: '48px',
              '&:focus-visible': {
                borderColor: theme.accentStrong,
                boxShadow: `0 0 0 2px ${theme.accentSoft}`,
              },
            },
            formButtonPrimary: {
              backgroundColor: theme.tint,
              borderRadius: `${Radii.medium}px`,
              boxShadow: 'none',
              color: theme.textInverse,
              fontFamily: Fonts.sansMedium,
              fontSize: '14px',
              height: '48px',
              '&:hover, &:focus, &:active': { backgroundColor: theme.tintPressed },
            },
            footer: { backgroundColor: 'transparent' },
          },
        }}
        fallbackRedirectUrl="/"
        oauthFlow={oauthFlow}
        routing="hash"
        signUpFallbackRedirectUrl="/"
        withSignUp
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.threeHalf,
  },
});
