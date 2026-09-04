import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { getMarketplaceBooking, reconcileMarketplaceBooking, type MarketplaceBooking } from '@/features/tutor-marketplace/api';
import { isHumanTutorCommerceEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; booking: MarketplaceBooking };

export function MarketplaceBookingDetailScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const enabled = isHumanTutorCommerceEnabled();
  const theme = useTheme();
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [state, setState] = useState<State>(enabled ? { kind: 'loading' } : { kind: 'error' });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const current = ++sequence.current;
    void getMarketplaceBooking(bookingId, controller.signal).then((booking) => {
      if (!controller.signal.aborted && current === sequence.current) setState({ kind: 'ready', booking });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || current !== sequence.current) return;
      if (error instanceof ApiClientError && error.kind === 'cancelled') return;
      setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [bookingId, enabled, retry]);

  const reconcile = async () => {
    if (working || state.kind !== 'ready') return;
    setWorking(true); setActionError(null);
    try { setState({ kind: 'ready', booking: await reconcileMarketplaceBooking(state.booking.bookingId) }); }
    catch { setActionError('Payment status could not be verified yet. Try again without starting a second payment.'); }
    finally { setWorking(false); }
  };

  return <ScreenFrame testID="marketplace-booking-detail-screen">
    <View style={styles.header}><ThemedText type="eyebrow" themeColor="textSecondary">PROTECTED BOOKING</ThemedText><ThemedText type="display">Tutor lesson</ThemedText></View>
    {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading booking" padding="roomy" style={styles.card}><ActivityIndicator color={theme.tint} /></GlideSurface> : null}
    {state.kind === 'error' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted"><ThemedText type="title2">This booking is unavailable.</ThemedText>{enabled ? <GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} /> : null}</GlideSurface> : null}
    {state.kind === 'ready' ? <GlideSurface padding="roomy" style={styles.card} variant={state.booking.state === 'confirmed' ? 'success' : 'card'}>
      <ThemedText type="title2">{new Date(state.booking.startsAt).toLocaleString()}</ThemedText>
      <ThemedText type="body">Status: {state.booking.state.replaceAll('_', ' ')}</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">${(state.booking.amountMinor / 100).toFixed(2)} USD</ThemedText>
      {state.booking.state === 'payment_ambiguous' ? <ThemedText type="body">Payment confirmation is delayed. Do not start a second checkout.</ThemedText> : null}
      {state.booking.checkoutUrl ? <GlideButton label="Continue secure checkout" onPress={() => void Linking.openURL(state.booking.checkoutUrl!)} /> : null}
      {['payment_pending', 'payment_ambiguous'].includes(state.booking.state) ? <GlideButton disabled={working} label={working ? 'Checking…' : 'Check payment status'} onPress={() => void reconcile()} variant="secondary" /> : null}
      {state.booking.meetingUrl ? <GlideButton label="Open approved meeting" onPress={() => void Linking.openURL(state.booking.meetingUrl!)} /> : null}
      {state.booking.ics ? <ThemedText type="footnote" themeColor="textSecondary">A bounded calendar event is ready for this confirmed lesson.</ThemedText> : null}
      {actionError ? <ThemedText accessibilityRole="alert" type="footnote">{actionError}</ThemedText> : null}
    </GlideSurface> : null}
  </ScreenFrame>;
}

const styles = StyleSheet.create({ card: { gap: Spacing.two, width: '100%' }, header: { gap: Spacing.two, width: '100%' } });
