import { AuthView, useAuthViewState } from '@clerk/expo/native';
import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export default function SignInRoute() {
  const theme = useTheme();
  const { isLoaded, isAuthFlowComplete } = useAuthViewState();

  if (!isLoaded) {
    return (
      <View
        accessibilityLabel="Loading sign in"
        accessibilityRole="progressbar"
        style={[styles.loading, { backgroundColor: theme.background }]}
        testID="auth-loading">
        <ActivityIndicator color={theme.tint} size="large" />
      </View>
    );
  }

  if (isAuthFlowComplete) {
    return <Redirect href="/(app)" />;
  }

  return <AuthView isDismissible={false} mode="signInOrUp" />;
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
});
