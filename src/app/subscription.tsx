import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

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
    ? 'Checking your plan…'
    : status === 'error'
      ? 'We couldn’t check your plan'
      : isPro
        ? 'Pro is active'
        : 'Free plan';
  const accessDescription = mode === 'mock'
    ? 'Test mode is on. Plan changes stay on this device and no charge is made.'
    : mode === 'unavailable'
      ? 'Purchases are not available in this build.'
      : status === 'error'
        ? 'Your plan has not changed. Check your connection and try again.'
        : isPro
          ? 'Tutor help is ready whenever you need it inside a lesson.'
          : 'Keep learning for free, or choose Pro for tutor help inside lessons.';

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/profile');
  }

  return (
    <ScreenFrame chrome={false} includeTabInset={false} testID="subscription-screen">
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          GLIDELINGO PRO{mode === 'mock' ? ' · TEST MODE' : ''}
        </ThemedText>
        <ThemedText type="display">Get tutor help when you need it.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.copy}>
          Choose Pro for lesson tutor assistance. Your purchase stays connected to your GlideLingo account, not your
          email address or phone number.
        </ThemedText>
      </View>

      <GlideSurface
        accessibilityLabel={accessLabel}
        padding="roomy"
        variant={isPro ? 'success' : 'tinted'}
        style={styles.card}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          CURRENT ACCESS
        </ThemedText>
        <ThemedText type="title2">{accessLabel}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {accessDescription}
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
                    : `Choose ${planName(item.interval, item.title)}`
                }
                onPress={() => void purchase(item.identifier)}
                testID={`purchase-${item.identifier}`}
              />
            </GlideSurface>
          ))}
          {packages.length === 0 ? (
            <GlideSurface padding="roomy" style={styles.card}>
              <ThemedText type="title3">Plans are temporarily unavailable.</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                We couldn’t load the available plans. Try again in a moment.
              </ThemedText>
              <GlideButton label="Reload plans" onPress={() => void refresh()} variant="secondary" />
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

      <View style={styles.actions}>
        {status === 'error' && mode !== 'unavailable' ? (
          <GlideButton disabled={actionBusy} label="Try again" onPress={() => void refresh()} variant="secondary" />
        ) : mode === 'unavailable' ? null : mode === 'mock' && isPro ? (
          <GlideButton label="Return to Free plan" onPress={resetMockAccess} variant="secondary" />
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
              label="Restore purchases"
              onPress={() => void restore()}
              variant="secondary"
            />
          </>
        )}
        <GlideButton label="Back" onPress={goBack} variant="tertiary" />
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
