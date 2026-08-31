import { SignIn } from '@clerk/expo/web';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function SignInRoute() {
  const theme = useTheme();

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
          Continue with Google, Apple, email, or phone. We only ask for the details needed to keep your learning path.
        </ThemedText>
      </View>
      <SignIn
        fallbackRedirectUrl="/"
        oauthFlow="popup"
        routing="hash"
        signUpFallbackRedirectUrl="/"
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
