import { useClerk, useUser } from '@clerk/expo';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { authErrorMessage } from './auth-error-message';
import { accountIdentity } from './auth-profile';

export function AccountSummary() {
  const theme = useTheme();
  const { signOut } = useClerk();
  const { isLoaded, user } = useUser();
  const [signingOut, setSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isLoaded || !user) return null;

  const identity = accountIdentity(user);

  const handleSignOut = async () => {
    if (signingOut) return;

    setSigningOut(true);
    setErrorMessage(null);

    try {
      await signOut();
    } catch (error) {
      setErrorMessage(authErrorMessage(error, 'We could not sign you out. Please try again.'));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <GlideSurface padding="roomy" style={styles.card} testID="account-summary">
      <View style={styles.heading}>
        <View style={styles.identity}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            ACCOUNT
          </ThemedText>
          <ThemedText type="title3">{identity.displayName}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {identity.contact}
          </ThemedText>
        </View>
        <View
          accessibilityLabel={identity.verificationLabel.toLowerCase()}
          style={[
            styles.badge,
            { backgroundColor: identity.verified ? theme.successSoft : theme.warningSoft },
          ]}>
          <ThemedText
            type="caption"
            style={{ color: identity.verified ? theme.success : theme.warning }}>
            {identity.verificationLabel}
          </ThemedText>
        </View>
      </View>
      <GlideButton
        disabled={signingOut}
        label={signingOut ? 'Signing out…' : 'Sign out'}
        onPress={() => void handleSignOut()}
        size="regular"
        testID="sign-out"
        variant="secondary"
      />
      {errorMessage ? (
        <ThemedText accessibilityRole="alert" type="footnote" style={{ color: theme.danger }}>
          {errorMessage}
        </ThemedText>
      ) : null}
    </GlideSurface>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: Radii.capsule, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  card: { gap: Spacing.three },
  heading: { alignItems: 'flex-start', flexDirection: 'row', gap: Spacing.three, justifyContent: 'space-between' },
  identity: { flex: 1, gap: Spacing.half },
});
