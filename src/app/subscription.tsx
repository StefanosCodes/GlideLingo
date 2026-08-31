import { useRouter } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useBilling } from '@/providers/billing-provider';

const benefits = [
  'On-demand tutor help inside lessons',
  'Clear explanations when a step feels confusing',
  'Tutor access connected to your GlideLingo account',
];

function planName(interval: 'monthly' | 'annual' | 'other', fallback: string) {
  if (interval === 'monthly') return 'Monthly Pro';
  if (interval === 'annual') return 'Annual Pro';
  return fallback;
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    mode,
    status,
    isPro,
    packages,
    purchaseState,
    managementState,
    errorMessage,
    manage,
    purchase,
    refresh,
    restore,
    resetMockAccess,
  } = useBilling();
  const loading = status === 'loading';
  const purchaseLoading = purchaseState.status === 'loading' || purchaseState.status === 'syncing';
  const managementLoading = managementState.status === 'loading';
  const actionBusy = loading || purchaseLoading || managementLoading;
  const accessLabel = loading
    ? 'Checking…'
    : status === 'error'
      ? 'Access verification unavailable'
      : isPro
        ? 'Pro is active'
        : 'Free plan';

  return (
    <ScreenFrame chrome={false} includeTabInset={false} testID="subscription-screen">
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          GLIDELINGO PRO · {mode === 'mock' ? 'MVP PREVIEW' : mode === 'unavailable' ? 'UNAVAILABLE' : 'REVENUECAT'}
        </ThemedText>
        <ThemedText type="display">Get tutor help when you need it.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.copy}>
          Choose monthly or annual Pro for lesson tutor assistance. Your purchase stays connected to your GlideLingo
          account, not your email address or phone number.
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
        <ThemedText type="title2">{accessLabel}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {mode === 'mock'
            ? 'Mock billing was explicitly enabled for development, so access changes only in memory for this account.'
            : mode === 'unavailable'
              ? 'This build has no platform RevenueCat key. Purchases stay disabled rather than granting preview access.'
              : 'Tutor access is enabled only after the GlideLingo server verifies RevenueCat’s active “pro” entitlement for this signed-in account.'}
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

      {status === 'free' && mode !== 'unavailable' ? (
        <View style={styles.plans}>
          {packages.map((item) => (
            <GlideSurface key={item.identifier} padding="roomy" style={styles.card}>
              <View style={styles.planHeading}>
                <View style={styles.planCopy}>
                  <ThemedText type="title3">{planName(item.interval, item.title)}</ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {item.description}
                  </ThemedText>
                </View>
                <ThemedText type="headline">{item.priceLabel}</ThemedText>
              </View>
              <GlideButton
                disabled={actionBusy}
                fullWidth
                label={
                  purchaseLoading && purchaseState.packageIdentifier === item.identifier
                    ? purchaseState.status === 'syncing'
                      ? 'Confirming Pro access…'
                      : 'Opening secure checkout…'
                    : mode === 'mock'
                      ? `Simulate ${planName(item.interval, item.title)}`
                      : `Choose ${planName(item.interval, item.title)}`
                }
                onPress={() => void purchase(item.identifier)}
                testID={`purchase-${item.identifier}`}
              />
            </GlideSurface>
          ))}
          {packages.length === 0 ? (
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

      {purchaseState.status !== 'idle' && purchaseState.status !== 'loading' ? (
        <GlideSurface
          accessibilityRole={
            purchaseState.status === 'declined' ||
            purchaseState.status === 'error' ||
            purchaseState.status === 'sync-unavailable'
              ? 'alert'
              : undefined
          }
          padding="regular"
          variant={purchaseState.status === 'success' ? 'success' : 'tinted'}>
          <ThemedText
            type="headline"
            style={
              purchaseState.status === 'declined' ||
              purchaseState.status === 'error' ||
              purchaseState.status === 'sync-unavailable'
                ? { color: theme.danger }
                : undefined
            }>
            {purchaseState.status === 'success'
              ? 'Purchase confirmed'
              : purchaseState.status === 'syncing'
                ? 'Purchase complete · confirming access'
              : purchaseState.status === 'cancelled'
                ? 'Checkout cancelled'
                : purchaseState.status === 'declined'
                  ? 'Payment not accepted'
                  : purchaseState.status === 'sync-unavailable'
                    ? 'Purchase complete · access not confirmed'
                  : 'Purchase not confirmed'}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {purchaseState.message}
          </ThemedText>
        </GlideSurface>
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
          <>
            {isPro && mode === 'revenuecat' ? (
              <GlideButton
                disabled={actionBusy}
                label={managementLoading ? 'Opening subscription management…' : 'Manage subscription'}
                onPress={() => void manage()}
                variant="secondary"
              />
            ) : null}
            <GlideButton
              disabled={actionBusy || status === 'signed-out'}
              label={Platform.OS === 'web' ? 'Refresh access' : 'Restore purchases'}
              onPress={() => void restore()}
              variant="secondary"
            />
          </>
        )}
        {status === 'error' && mode !== 'unavailable' ? (
          <GlideButton label="Try again" onPress={() => void refresh()} variant="secondary" />
        ) : null}
        <GlideButton label="Back" onPress={() => router.back()} variant="tertiary" />
      </View>

      {managementState.status !== 'idle' && managementState.status !== 'loading' ? (
        <GlideSurface
          accessibilityRole={managementState.status === 'error' ? 'alert' : undefined}
          padding="regular"
          variant="tinted">
          <ThemedText type="footnote" themeColor="textSecondary">
            {managementState.message}
          </ThemedText>
        </GlideSurface>
      ) : null}
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
