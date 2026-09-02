import '@/providers/install-local-storage';

import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { setApiAccessTokenProvider } from '@/api/auth-token';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { FirstNameCompletionGate } from '@/features/auth/first-name-completion-gate';
import { useTheme, useThemeController } from '@/hooks/use-theme';
import { AppThemeProvider } from '@/providers/app-theme-provider';
import { BillingProvider } from '@/providers/billing-provider';
import { GlideLingoClerkProvider } from '@/providers/clerk-provider';
import { useAuth } from '@/providers/clerk-runtime';
import { LearningProvider } from '@/providers/learning-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  if (!fontsLoaded && !fontError) return null;

  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  return (
    <AppThemeProvider>
      {publishableKey ? (
        <GlideLingoClerkProvider publishableKey={publishableKey}>
          <ClerkApp />
        </GlideLingoClerkProvider>
      ) : (
        <MissingClerkConfiguration />
      )}
    </AppThemeProvider>
  );
}

function ClerkApp() {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const getTokenRef = useRef(getToken);
  useLayoutEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(
    () => setApiAccessTokenProvider(() => getTokenRef.current()),
    [],
  );

  if (!isLoaded) {
    return (
      <BillingProvider userId={null}>
        <AuthLoadingScreen />
      </BillingProvider>
    );
  }

  const signedIn = isSignedIn && Boolean(userId);

  return (
    <BillingProvider userId={signedIn ? userId : null}>
      {signedIn && userId ? (
        <LearningProvider key={userId} storageScope={userId}>
          <FirstNameCompletionGate>
            <AppNavigation signedIn />
          </FirstNameCompletionGate>
        </LearningProvider>
      ) : (
        <AppNavigation signedIn={false} />
      )}
    </BillingProvider>
  );
}

function AuthLoadingScreen() {
  const colors = useTheme();

  return (
    <View
      accessibilityLabel="Checking GlideLingo session"
      accessibilityRole="progressbar"
      style={[styles.authLoadingScreen, { backgroundColor: colors.background }]}
      testID="auth-session-loading"
    >
      <ActivityIndicator color={colors.tint} size="large" />
      <ThemedText type="body" themeColor="textSecondary">
        Checking your GlideLingo session…
      </ThemedText>
    </View>
  );
}

function AppNavigation({ signedIn }: { signedIn: boolean }) {
  const colors = useTheme();
  const { scheme } = useThemeController();
  const isDark = scheme === 'dark';
  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      border: colors.border,
      card: colors.surface,
      primary: colors.tint,
      text: colors.text,
      notification: colors.danger,
    },
  };

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
          <Stack.Screen name="course/[id]" />
          <Stack.Screen name="lesson/[id]" />
          <Stack.Screen name="rhythm" />
          <Stack.Screen name="kit" />
          <Stack.Screen name="diagnostics" />
          <Stack.Screen name="subscription" />
        </Stack.Protected>
        <Stack.Screen name="sso-callback" />
        <Stack.Screen name="referral" />
      </Stack>
    </NavigationThemeProvider>
  );
}

function MissingClerkConfiguration() {
  const colors = useTheme();

  return (
    <View style={[styles.configurationScreen, { backgroundColor: colors.background }]}>
      <ThemedText type="title2">Authentication needs one local setting.</ThemedText>
      <ThemedText type="body" themeColor="textSecondary" style={styles.configurationCopy}>
        Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to the root .env file, then restart GlideLingo.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  authLoadingScreen: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.two,
    justifyContent: 'center',
    padding: Spacing.threeHalf,
  },
  configurationCopy: { maxWidth: 520, textAlign: 'center' },
  configurationScreen: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.two,
    justifyContent: 'center',
    padding: Spacing.threeHalf,
  },
});
