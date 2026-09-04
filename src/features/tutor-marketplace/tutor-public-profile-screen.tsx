import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { createBookingCheckout, createMarketplaceConversation, getPublicTutor, listPublicTutorSlots, setPublicTutorFavorite, type PublicTutor, type TutorSlot } from '@/features/tutor-marketplace/api';
import { isHumanTutorCommerceEnabled, isHumanTutorMessagingEnabled } from '@/features/tutor-marketplace/config';
import { createMarketplaceClientId } from '@/features/tutor-marketplace/client-operation-id';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | {
  kind: 'ready';
  tutor: PublicTutor;
  slots: TutorSlot[];
  slotFreshness: 'current' | 'stale' | 'reconnect_required';
  selectedOfferingId: string;
};

export function TutorPublicProfileScreen() {
  const { tutorId } = useLocalSearchParams<{ tutorId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null);
  const favoriteInFlight = useRef(false);
  const idempotencyKeys = useRef(new Map<string, string>());
  const [actionError, setActionError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    void getPublicTutor(tutorId, controller.signal).then(async (tutor) => {
      const selectedOfferingId = tutor.offerings?.[0]?.offeringId ?? tutor.offeringId;
      const slots = await listPublicTutorSlots(
        tutorId, startsAt.toISOString(), endsAt.toISOString(), controller.signal,
        selectedOfferingId,
      );
      if (!controller.signal.aborted && current === sequence.current) {
        setState({ kind: 'ready', tutor, slots: slots.slots, slotFreshness: slots.freshness, selectedOfferingId });
      }
    }).catch(() => {
      if (!controller.signal.aborted && current === sequence.current) setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [retry, tutorId]);

  if (state.kind === 'loading') return <ScreenFrame><GlideSurface accessible accessibilityLabel="Loading tutor profile" padding="roomy" style={styles.card}>
    <ActivityIndicator color={theme.tint} /><ThemedText type="headline">Loading tutor…</ThemedText>
  </GlideSurface></ScreenFrame>;
  if (state.kind === 'error') return <ScreenFrame><GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted">
    <ThemedText type="title2">This tutor is unavailable.</ThemedText><GlideButton label="Try again" onPress={() => setRetry((value) => value + 1)} variant="secondary" />
  </GlideSurface></ScreenFrame>;

  const toggleFavorite = async () => {
    if (favoriteInFlight.current) return;
    favoriteInFlight.current = true;
    const targetTutorId = state.tutor.tutorId;
    const desiredFavorite = !state.tutor.isFavorite;
    setActionError(null);
    setSavingFavorite(true);
    try {
      const tutor = await setPublicTutorFavorite(targetTutorId, desiredFavorite);
      setState((current) => current.kind === 'ready' && current.tutor.tutorId === targetTutorId ? {
        ...current,
        tutor: { ...current.tutor, isFavorite: tutor.isFavorite },
      } : current);
    } catch {
      setActionError('Your favorite could not be updated. Try again.');
    } finally {
      favoriteInFlight.current = false;
      setSavingFavorite(false);
    }
  };
  const startConversation = async () => {
    if (startingConversation) return;
    setStartingConversation(true); setActionError(null);
    try {
      const conversation = await createMarketplaceConversation(state.tutor.tutorId);
      router.push(`/messages/${conversation.conversationId}`);
    } catch {
      setActionError('A conversation could not be opened. Try again.');
    } finally { setStartingConversation(false); }
  };
  const book = async (slot: TutorSlot) => {
    if (bookingSlot) return;
    setBookingSlot(slot.startsAt); setActionError(null);
    const operationKey = `${state.tutor.tutorId}:${state.selectedOfferingId}:${slot.startsAt}`;
    let idempotencyKey = idempotencyKeys.current.get(operationKey);
    if (!idempotencyKey) {
      idempotencyKey = createMarketplaceClientId();
      idempotencyKeys.current.set(operationKey, idempotencyKey);
    }
    let booking;
    try {
      booking = await createBookingCheckout(
        state.tutor.tutorId, slot.startsAt, idempotencyKey, state.selectedOfferingId,
      );
      idempotencyKeys.current.delete(operationKey);
      router.push(`/bookings/${booking.bookingId}`);
    } catch {
      setActionError('Checkout could not be started. Your card was not assumed charged; retry safely.');
      setBookingSlot(null);
      return;
    }
    if (booking.checkoutUrl) {
      try {
        await Linking.openURL(booking.checkoutUrl);
      } catch {
        setActionError('Your booking was created, but checkout could not be opened. Continue it from the booking page.');
      }
    }
    setBookingSlot(null);
  };
  const selectOffering = async (offeringId: string) => {
    if (offeringId === state.selectedOfferingId) return;
    const targetTutorId = state.tutor.tutorId;
    const current = ++sequence.current;
    setActionError(null);
    try {
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + 14 * 24 * 60 * 60 * 1000);
      const slots = await listPublicTutorSlots(
        targetTutorId, startsAt.toISOString(), endsAt.toISOString(), undefined, offeringId,
      );
      if (current === sequence.current) setState((latest) =>
        latest.kind === 'ready' && latest.tutor.tutorId === targetTutorId ? {
          ...latest,
          selectedOfferingId: offeringId,
          slots: slots.slots,
          slotFreshness: slots.freshness,
        } : latest);
    } catch {
      if (current === sequence.current) setActionError('Availability could not be updated. Try again.');
    }
  };
  const tutorOfferings = state.tutor.offerings?.length ? state.tutor.offerings : [{
    offeringId: state.tutor.offeringId, title: state.tutor.offeringTitle,
    durationMinutes: state.tutor.durationMinutes, amountMinor: state.tutor.amountMinor,
    currency: state.tutor.currency,
  }];
  const selectedOffering = tutorOfferings.find(
    (offering) => offering.offeringId === state.selectedOfferingId,
  ) ?? tutorOfferings[0];
  return <ScreenFrame testID="tutor-public-profile-screen">
    <View style={styles.header}><ThemedText type="eyebrow" themeColor="textSecondary">PUBLIC TUTOR PROFILE</ThemedText>
      <ThemedText type="display">{state.tutor.headline}</ThemedText>
      <ThemedText type="body">{state.tutor.biography}</ThemedText></View>
    <GlideSurface padding="roomy" style={styles.card}>
      <ThemedText type="title2">Choose a lesson</ThemedText>
      {tutorOfferings.map((offering) => <GlideButton
        key={offering.offeringId}
        label={`${offering.title} · ${offering.durationMinutes} min · $${(offering.amountMinor / 100).toFixed(2)}`}
        onPress={() => void selectOffering(offering.offeringId)}
        variant={offering.offeringId === state.selectedOfferingId ? 'primary' : 'secondary'}
      />)}
      {selectedOffering ? <ThemedText type="body" themeColor="textSecondary">Times below are for {selectedOffering.title} · {state.tutor.timeZone}</ThemedText> : null}
      <ThemedText type="body">Languages: {state.tutor.languages.join(', ')}</ThemedText>
      {state.tutor.dialects.length ? <ThemedText type="body">Dialects: {state.tutor.dialects.join(', ')}</ThemedText> : null}
      {state.tutor.verifiedCredentials.map((credential) => <ThemedText key={credential} type="footnote">Verified credential: {credential}</ThemedText>)}
      <GlideButton disabled={savingFavorite} label={state.tutor.isFavorite ? 'Remove from favorites' : 'Save tutor'}
        onPress={() => void toggleFavorite()} variant="secondary" />
      {isHumanTutorMessagingEnabled() ? <GlideButton disabled={startingConversation}
        label={startingConversation ? 'Opening messages…' : 'Message tutor'} onPress={() => void startConversation()} /> : null}
      {actionError ? <ThemedText accessibilityRole="alert" type="footnote">{actionError}</ThemedText> : null}
    </GlideSurface>
    <GlideSurface padding="roomy" style={styles.card}>
      <ThemedText type="title2">Available times</ThemedText>
      {state.slotFreshness === 'stale' ? <ThemedText type="body" themeColor="textSecondary">Calendar availability is temporarily stale. No time is shown as bookable until it refreshes.</ThemedText> :
        state.slotFreshness === 'reconnect_required' ? <ThemedText type="body" themeColor="textSecondary">This tutor needs to reconnect their calendar before calendar-backed times can appear.</ThemedText> :
        state.slots.length === 0 ? <ThemedText type="body" themeColor="textSecondary">No manual slots are available in the next two weeks.</ThemedText> :
        state.slots.map((slot) => <View key={slot.startsAt} style={styles.slotRow}>
          <ThemedText type="body">{new Date(slot.startsAt).toLocaleString()}</ThemedText>
          {isHumanTutorCommerceEnabled() ? <GlideButton disabled={bookingSlot !== null}
            label={bookingSlot === slot.startsAt ? 'Holding time…' : 'Book'}
            onPress={() => void book(slot)} size="regular" variant="secondary" /> : null}
        </View>)}
    </GlideSurface>
  </ScreenFrame>;
}


const styles = StyleSheet.create({
  card: { gap: Spacing.two, width: '100%' },
  header: { gap: Spacing.two, width: '100%' },
  slotRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two, justifyContent: 'space-between' },
});
