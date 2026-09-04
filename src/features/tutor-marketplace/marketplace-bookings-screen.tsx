import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { listMarketplaceBookings, type MarketplaceBooking } from '@/features/tutor-marketplace/api';
import { isHumanTutorCommerceEnabled, isHumanTutorMarketplaceAcquisitionEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; bookings: MarketplaceBooking[] };

export function MarketplaceBookingsScreen() {
  const enabled = isHumanTutorCommerceEnabled();
  const router = useRouter();
  const theme = useTheme();
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>(enabled ? { kind: 'loading' } : { kind: 'error' });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const current = ++sequence.current;
    void listMarketplaceBookings(controller.signal).then((bookings) => {
      if (!controller.signal.aborted && current === sequence.current) setState({ kind: 'ready', bookings });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || current !== sequence.current) return;
      if (error instanceof ApiClientError && error.kind === 'cancelled') return;
      setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [enabled, retry]);

  return <ScreenFrame testID={enabled ? 'marketplace-bookings-screen' : 'marketplace-bookings-disabled'}>
    <View style={styles.header}><ThemedText type="eyebrow" themeColor="textSecondary">HUMAN TUTOR BOOKINGS</ThemedText>
      <ThemedText type="display">Lessons and payment status.</ThemedText></View>
    {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading tutor bookings" padding="roomy" style={styles.card}>
      <ActivityIndicator color={theme.tint} /><ThemedText type="headline">Loading bookings…</ThemedText>
    </GlideSurface> : null}
    {state.kind === 'error' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted">
      <ThemedText type="title2">Bookings are unavailable.</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">No payment status is inferred while the server cannot be reached.</ThemedText>
      {enabled ? <GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} variant="secondary" /> : null}
    </GlideSurface> : null}
    {state.kind === 'ready' && state.bookings.length === 0 ? <GlideSurface padding="roomy" style={styles.card}>
      <ThemedText type="title2">No tutor bookings yet.</ThemedText>{isHumanTutorMarketplaceAcquisitionEnabled() ? <GlideButton label="Find a tutor" onPress={() => router.push('/tutors')} variant="secondary" /> : <ThemedText type="body" themeColor="textSecondary">New tutor discovery is currently paused. Existing bookings and support remain available.</ThemedText>}
    </GlideSurface> : null}
    {state.kind === 'ready' ? state.bookings.map((booking) => <GlideSurface key={booking.bookingId} padding="roomy" style={styles.card}>
      <ThemedText type="title2">{new Date(booking.startsAt).toLocaleString()}</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">{booking.role === 'tutor' ? 'Tutor' : 'Learner'} · {booking.state.replaceAll('_', ' ')} · ${(booking.amountMinor / 100).toFixed(2)} USD</ThemedText>
      <GlideButton label="View booking" onPress={() => router.push(`/bookings/${booking.bookingId}`)} variant="secondary" />
    </GlideSurface>) : null}
  </ScreenFrame>;
}

const styles = StyleSheet.create({ card: { gap: Spacing.two, width: '100%' }, header: { gap: Spacing.two, width: '100%' } });
