import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useTheme, useThemeController } from '@/hooks/use-theme';
import { AppThemeProvider } from '@/providers/app-theme-provider';
import { LearningProvider } from '@/providers/learning-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  if (!fontsLoaded && !fontError) return null;

  return (
    <AppThemeProvider>
      <LearningProvider>
        <AppNavigation />
      </LearningProvider>
    </AppThemeProvider>
  );
}

function AppNavigation() {
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
        <Stack.Screen name="(app)" />
        <Stack.Screen name="course/[id]" />
        <Stack.Screen name="kit" />
      </Stack>
    </NavigationThemeProvider>
  );
}
