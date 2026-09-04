import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { getMarketplaceOperatorCapabilities, type MarketplaceOperatorCapability } from '@/features/tutor-marketplace/api';
import { isHumanTutorCommerceEnabled, isHumanTutorMessagingEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type CapabilityState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; capabilities: MarketplaceOperatorCapability[] };

export function MarketplaceOperationsHubScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<CapabilityState>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    void getMarketplaceOperatorCapabilities(controller.signal)
      .then((capabilities) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', capabilities });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [retry]);
  const has = (capability: MarketplaceOperatorCapability) =>
    state.kind === 'ready' && state.capabilities.includes(capability);
  const applicationAccess = has('review_tutor_applications') || has('manage_tutor_status') ||
    has('verify_tutor_credentials');
  return <ScreenFrame testID="marketplace-operations-hub-screen">
    <View style={styles.heading}>
      <ThemedText type="eyebrow" themeColor="textSecondary">CAPABILITY-SCOPED</ThemedText>
      <ThemedText type="display">Marketplace operations</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">The server verifies your specific operator capability for every queue and action. Opening this hub grants no additional access.</ThemedText>
    </View>
    <GlideSurface padding="roomy" style={styles.card}>
      {state.kind === 'loading' ? <ActivityIndicator accessibilityLabel="Loading operator capabilities" color={theme.tint} /> : null}
      {state.kind === 'error' ? <View accessibilityRole="alert" style={styles.error}>
        <ThemedText type="title2">Operator tools are unavailable.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">No capabilities are inferred while the server cannot be reached.</ThemedText>
        <GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} variant="secondary" />
      </View> : null}
      {state.kind === 'ready' && state.capabilities.length === 0 ? <ThemedText type="body">This account has no marketplace operator tools.</ThemedText> : null}
      {applicationAccess ? <GlideButton label="Tutor applications" onPress={() => router.push('/marketplace-operations/tutor-applications')} variant="secondary" /> : null}
      {isHumanTutorMessagingEnabled() && has('review_message_reports') ? <GlideButton label="Message safety reports" onPress={() => router.push('/marketplace-operations/message-reports')} variant="secondary" /> : null}
      {isHumanTutorCommerceEnabled() ? <>
        {has('manage_bookings') ? <GlideButton label="Booking operations" onPress={() => router.push('/marketplace-operations/bookings')} variant="secondary" /> : null}
        {has('moderate_reviews') ? <GlideButton label="Review moderation" onPress={() => router.push('/marketplace-operations/reviews')} variant="secondary" /> : null}
      </> : null}
    </GlideSurface>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two, width: '100%' },
  error: { gap: Spacing.two, width: '100%' },
  heading: { gap: Spacing.two, width: '100%' },
});
