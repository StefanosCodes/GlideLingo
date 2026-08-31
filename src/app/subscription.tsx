import { useRouter } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useBilling } from '@/providers/billing-provider';

const benefits = ['The complete learning path', 'Speaking and listening practice', 'Your Pro access across devices'];

export default function SubscriptionScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { mode, status, isPro, packages, errorMessage, purchase, refresh, restore, resetMockAccess } = useBilling();
  const loading = status === 'loading';

  return (
    <ScreenFrame chrome={false} includeTabInset={false} testID="subscription-screen">
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          GLIDELINGO PRO · {mode === 'mock' ? 'MVP PREVIEW' : mode === 'unavailable' ? 'UNAVAILABLE' : 'REVENUECAT'}
        </ThemedText>
        <ThemedText type="display">Keep the full path open.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.copy}>
          Choose a simple monthly or annual plan. Your purchase stays connected to your GlideLingo account, not your email
          address or phone number.
        </ThemedText>
      </View>

      <GlideSurface
        accessibilityLabel={loading ? 'Checking subscription access' : isPro ? 'Pro is active' : 'Free plan'}
        padding="roomy"
        variant={isPro ? 'success' : 'tinted'}
        style={styles.card}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          CURRENT ACCESS
        </ThemedText>
        <ThemedText type="title2">{loading ? 'Checking…' : isPro ? 'Pro is active' : 'Free plan'}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {mode === 'mock'
            ? 'Mock billing was explicitly enabled for development, so access changes only in memory for this account.'
            : mode === 'unavailable'
              ? 'This build has no platform RevenueCat key. Purchases stay disabled rather than granting preview access.'
              : 'Access is derived from RevenueCat’s active “pro” entitlement for this signed-in account.'}
        </ThemedText>
      </GlideSurface>

      <View style={styles.benefits}>
        {benefits.map((benefit) => (
          <View key={benefit} style={styles.benefitRow}>
            <ThemedText type="headline">✓</ThemedText>
            <ThemedText type="body">{benefit}</ThemedText>
          </View>
        ))}
      </View>

      {!isPro && status !== 'signed-out' && mode !== 'unavailable' ? (
        <View style={styles.plans}>
          {packages.map((item) => (
            <GlideSurface key={item.identifier} padding="roomy" style={styles.card}>
              <View style={styles.planHeading}>
                <View style={styles.planCopy}>
                  <ThemedText type="title3">{item.title}</ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {item.description}
                  </ThemedText>
                </View>
                <ThemedText type="headline">{item.priceLabel}</ThemedText>
              </View>
              <GlideButton
                disabled={loading}
                fullWidth
                label={mode === 'mock' ? 'Simulate purchase' : `Choose ${item.title}`}
                onPress={() => void purchase(item.identifier)}
                testID={`purchase-${item.identifier}`}
              />
            </GlideSurface>
          ))}
          {!loading && status !== 'error' && packages.length === 0 ? (
            <GlideSurface padding="roomy" style={styles.card}>
              <ThemedText type="title3">No subscription offering is available.</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                Make the monthly and annual packages current in RevenueCat, then refresh this screen.
              </ThemedText>
              <GlideButton label="Refresh offerings" onPress={() => void refresh()} variant="secondary" />
            </GlideSurface>
          ) : null}
        </View>
      ) : null}

      {errorMessage ? (
        <GlideSurface accessibilityRole="alert" padding="regular">
          <ThemedText type="headline" style={{ color: theme.danger }}>
            Purchase status unavailable
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {errorMessage}
          </ThemedText>
        </GlideSurface>
      ) : null}

      <View style={styles.actions}>
        {mode === 'unavailable' ? null : mode === 'mock' && isPro ? (
          <GlideButton label="Reset mock access" onPress={resetMockAccess} variant="secondary" />
        ) : (
          <GlideButton
            disabled={loading || status === 'signed-out'}
            label={Platform.OS === 'web' ? 'Refresh access' : 'Restore purchases'}
            onPress={() => void restore()}
            variant="secondary"
          />
        )}
        {status === 'error' && mode !== 'unavailable' ? (
          <GlideButton label="Try again" onPress={() => void refresh()} variant="secondary" />
        ) : null}
        <GlideButton label="Back" onPress={() => router.back()} variant="tertiary" />
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two },
  copy: { maxWidth: 560 },
  card: { gap: Spacing.three },
  benefits: { gap: Spacing.two },
  benefitRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  plans: { gap: Spacing.three },
  planHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: Spacing.three, justifyContent: 'space-between' },
  planCopy: { flex: 1, gap: Spacing.one },
  actions: { gap: Spacing.two },
});
