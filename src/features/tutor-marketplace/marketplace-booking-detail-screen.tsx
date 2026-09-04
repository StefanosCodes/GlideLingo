import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, TextInput, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { createMarketplaceBookingReview, getMarketplaceBooking, reconcileMarketplaceBooking, recoverMarketplaceBookingDelivery, recoverMarketplaceBookingMoney, recoverMarketplaceBookingReconciliation, transitionMarketplaceBooking, type MarketplaceBooking } from '@/features/tutor-marketplace/api';
import { isHumanTutorCommerceEnabled, isHumanTutorLearningBridgeEnabled } from '@/features/tutor-marketplace/config';
import { createMarketplaceClientId } from '@/features/tutor-marketplace/client-operation-id';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; booking: MarketplaceBooking };

export function MarketplaceBookingDetailScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const enabled = isHumanTutorCommerceEnabled();
  const learningBridgeEnabled = isHumanTutorLearningBridgeEnabled();
  const theme = useTheme();
  const sequence = useRef(0);
  const transitionKeys = useRef(new Map<string, string>());
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState<string | null>(null);
  const [newStart, setNewStart] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [operatorReason, setOperatorReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [state, setState] = useState<State>(enabled ? { kind: 'loading' } : { kind: 'error' });
  const disputeDeadline = state.kind === 'ready' && state.booking.disputeDeadlineAt
    ? Date.parse(state.booking.disputeDeadlineAt) : null;
  const disputeOpen = disputeDeadline !== null && Date.now() <= disputeDeadline;
  const reviewOpen = disputeDeadline !== null && Date.now() > disputeDeadline;
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
    setWorking('reconcile'); setActionError(null);
    try { setState({ kind: 'ready', booking: await reconcileMarketplaceBooking(state.booking.bookingId) }); }
    catch { setActionError('Payment status could not be verified yet. Try again without starting a second payment.'); }
    finally { setWorking(null); }
  };
  const transition = async (action: Parameters<typeof transitionMarketplaceBooking>[1], reason: string) => {
    if (working || state.kind !== 'ready') return;
    setWorking(action); setActionError(null);
    const newStartsAt = action === 'reschedule' ? new Date(newStart).toISOString() : null;
    const operationKey = `${state.booking.bookingId}:${action}:${reason}:${newStartsAt ?? ''}`;
    let operationId = transitionKeys.current.get(operationKey);
    if (!operationId) {
      operationId = createMarketplaceClientId();
      transitionKeys.current.set(operationKey, operationId);
    }
    try {
      const booking = await transitionMarketplaceBooking(
        state.booking.bookingId, action, reason, operationId, newStartsAt,
      );
      transitionKeys.current.delete(operationKey);
      setState({ kind: 'ready', booking });
    } catch { setActionError('That booking change could not be applied. Reload before trying again.'); }
    finally { setWorking(null); }
  };
  const review = async () => {
    if (working || state.kind !== 'ready') return;
    setWorking('review'); setActionError(null);
    try {
      await createMarketplaceBookingReview(
        state.booking.bookingId, reviewRating, reviewBody.trim() || null,
      );
      setActionError('Your verified review was saved.');
    }
    catch { setActionError('This booking is not eligible for a review yet.'); }
    finally { setWorking(null); }
  };
  const recoverMoney = async () => {
    if (working || state.kind !== 'ready') return;
    setWorking('recover'); setActionError(null);
    try { setState({ kind: 'ready', booking: await recoverMarketplaceBookingMoney(state.booking.bookingId, operatorReason.trim()) }); }
    catch { setActionError('No recoverable money operation was available for this booking.'); }
    finally { setWorking(null); }
  };
  const recoverReconciliation = async () => {
    if (working || state.kind !== 'ready') return;
    setWorking('recover-reconciliation'); setActionError(null);
    try { setState({ kind: 'ready', booking: await recoverMarketplaceBookingReconciliation(state.booking.bookingId, operatorReason.trim()) }); }
    catch { setActionError('No exhausted payment reconciliation was available for this booking.'); }
    finally { setWorking(null); }
  };
  const recoverDelivery = async () => {
    if (working || state.kind !== 'ready') return;
    setWorking('recover-delivery'); setActionError(null);
    try { setState({ kind: 'ready', booking: await recoverMarketplaceBookingDelivery(state.booking.bookingId, operatorReason.trim()) }); }
    catch { setActionError('No terminal delivery job was available for this booking.'); }
    finally { setWorking(null); }
  };

  return <ScreenFrame testID="marketplace-booking-detail-screen">
    <View style={styles.header}><ThemedText type="eyebrow" themeColor="textSecondary">PROTECTED BOOKING</ThemedText><ThemedText type="display">Tutor lesson</ThemedText></View>
    {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading booking" padding="roomy" style={styles.card}><ActivityIndicator color={theme.tint} /></GlideSurface> : null}
    {state.kind === 'error' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted"><ThemedText type="title2">This booking is unavailable.</ThemedText>{enabled ? <GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} /> : null}</GlideSurface> : null}
    {state.kind === 'ready' ? <GlideSurface padding="roomy" style={styles.card} variant={state.booking.state === 'confirmed' ? 'success' : 'card'}>
      <ThemedText type="title2">{new Date(state.booking.startsAt).toLocaleString()}</ThemedText>
      <ThemedText type="body">Status: {state.booking.state.replaceAll('_', ' ')}</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">${(state.booking.amountMinor / 100).toFixed(2)} USD</ThemedText>
      {state.booking.moneyState ? <ThemedText type="footnote" themeColor="textSecondary">Money status: {state.booking.moneyState.replaceAll('_', ' ')}</ThemedText> : null}
      {state.booking.state === 'payment_ambiguous' ? <ThemedText type="body">Payment confirmation is delayed. Do not start a second checkout.</ThemedText> : null}
      {state.booking.checkoutUrl ? <GlideButton label="Continue secure checkout" onPress={() => void Linking.openURL(state.booking.checkoutUrl!)} /> : null}
      {['payment_pending', 'payment_ambiguous'].includes(state.booking.state) ? <GlideButton disabled={working !== null} label={working === 'reconcile' ? 'Checking…' : 'Check payment status'} onPress={() => void reconcile()} variant="secondary" /> : null}
      {state.booking.meetingUrl ? <GlideButton label="Open approved meeting" onPress={() => void Linking.openURL(state.booking.meetingUrl!)} /> : null}
      {state.booking.ics ? <ThemedText type="footnote" themeColor="textSecondary">A bounded calendar event is ready for this confirmed lesson.</ThemedText> : null}
      {learningBridgeEnabled && state.booking.role !== 'operator' && ['confirmed', 'completed', 'learner_no_show', 'disputed', 'resolved_refund', 'resolved_release'].includes(state.booking.state) ? <GlideButton label="Learning context and follow-up" onPress={() => router.push(`/booking-learning/${state.booking.bookingId}`)} variant="secondary" /> : null}
      {state.booking.state === 'confirmed' && state.booking.role !== 'operator' ? <>
        <TextInput accessibilityLabel="New booking start time" autoCapitalize="none" onChangeText={setNewStart} placeholder="2026-09-10T15:00:00Z" placeholderTextColor={theme.textTertiary} style={[styles.input, { borderColor: theme.border, color: theme.text }]} value={newStart} />
        <GlideButton disabled={working !== null || Number.isNaN(Date.parse(newStart))} label="Reschedule booking" onPress={() => void transition('reschedule', 'Participant requested a new lesson time.')} variant="secondary" />
        <GlideButton disabled={working !== null} label="Cancel booking" onPress={() => void transition('cancel', 'Participant requested booking cancellation.')} variant="secondary" />
        <GlideButton disabled={working !== null} label="Mark lesson complete" onPress={() => void transition('complete', 'Participant confirmed the lesson was completed.')} />
        {state.booking.role === 'learner' ? <GlideButton disabled={working !== null} label="Report tutor no-show" onPress={() => void transition('tutor_no_show', 'Tutor did not attend the scheduled lesson.')} variant="secondary" /> : null}
        {state.booking.role === 'tutor' ? <GlideButton disabled={working !== null} label="Report learner no-show" onPress={() => void transition('learner_no_show', 'Learner did not attend the scheduled lesson.')} variant="secondary" /> : null}
      </> : null}
      {['completed', 'learner_no_show'].includes(state.booking.state) && state.booking.role === 'learner' && disputeOpen ? <>
        <GlideButton disabled={working !== null} label="Open dispute" onPress={() => void transition('dispute', 'Learner requested review within the dispute window.')} variant="secondary" />
        {state.booking.state === 'learner_no_show' ? <ThemedText type="body" themeColor="textSecondary">You can dispute this no-show decision during the protected review window.</ThemedText> : null}
      </> : null}
      {state.booking.state === 'completed' && state.booking.role === 'learner' && disputeOpen ?
        <ThemedText type="body" themeColor="textSecondary">Reviews open after the protected dispute window closes.</ThemedText> : null}
      {state.booking.state === 'completed' && state.booking.role === 'learner' && reviewOpen ? <>
        <ThemedText type="headline">Review rating</ThemedText>
        <View style={styles.ratingRow}>{[1, 2, 3, 4, 5].map((rating) => <GlideButton
          key={rating} label={`${rating} star${rating === 1 ? '' : 's'}`}
          onPress={() => setReviewRating(rating)}
          variant={reviewRating === rating ? 'primary' : 'secondary'}
        />)}</View>
        <TextInput accessibilityLabel="Review details (optional)" maxLength={1000}
          multiline onChangeText={setReviewBody} placeholder="Share helpful details"
          placeholderTextColor={theme.textTertiary}
          style={[styles.input, { borderColor: theme.border, color: theme.text }]}
          value={reviewBody} />
        <GlideButton disabled={working !== null || (reviewBody.trim().length > 0 && reviewBody.trim().length < 8)}
          label="Submit verified review" onPress={() => void review()} variant="secondary" />
      </> : null}
      {state.booking.state === 'disputed' && state.booking.role === 'operator' ? <>
        <TextInput accessibilityLabel="Operator decision reason" maxLength={1000} multiline
          onChangeText={setOperatorReason} placeholder="Document evidence and decision"
          placeholderTextColor={theme.textTertiary}
          style={[styles.input, { borderColor: theme.border, color: theme.text }]}
          value={operatorReason} />
        <GlideButton disabled={working !== null || operatorReason.trim().length < 8} label="Resolve with refund" onPress={() => void transition('resolve_refund', operatorReason.trim())} />
        <GlideButton disabled={working !== null || operatorReason.trim().length < 8} label="Resolve and release payout" onPress={() => void transition('resolve_release', operatorReason.trim())} variant="secondary" />
      </> : null}
      {state.booking.role === 'operator' && state.booking.state !== 'disputed' ? <TextInput accessibilityLabel="Operator action reason" maxLength={1000} multiline
        onChangeText={setOperatorReason} placeholder="Document evidence before an operator action"
        placeholderTextColor={theme.textTertiary}
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
        value={operatorReason} /> : null}
      {state.booking.role === 'operator' && state.booking.state === 'confirmed' && state.booking.hasCalendarConflict ? <GlideButton
        disabled={working !== null || operatorReason.trim().length < 8}
        label="Refund calendar conflict"
        onPress={() => void transition('calendar_conflict_refund', operatorReason.trim())}
        variant="secondary" /> : null}
      {state.booking.role === 'operator' && state.booking.moneyState && (state.booking.moneyState.endsWith('_ambiguous') || state.booking.moneyState.endsWith('_dead')) ? <GlideButton disabled={working !== null || operatorReason.trim().length < 8} label={working === 'recover' ? 'Recovering…' : 'Retry recoverable money operation'} onPress={() => void recoverMoney()} variant="secondary" /> : null}
      {state.booking.role === 'operator' && ['payment_pending', 'payment_ambiguous'].includes(state.booking.state) ? <GlideButton
        disabled={working !== null || operatorReason.trim().length < 8}
        label={working === 'recover-reconciliation' ? 'Requeuing…' : 'Requeue payment reconciliation'}
        onPress={() => void recoverReconciliation()}
        variant="secondary" /> : null}
      {state.booking.role === 'operator' ? <GlideButton
        disabled={working !== null || operatorReason.trim().length < 8}
        label={working === 'recover-delivery' ? 'Requeuing…' : 'Requeue failed reminders or notices'}
        onPress={() => void recoverDelivery()}
        variant="secondary" /> : null}
      {actionError ? <ThemedText accessibilityRole="alert" type="footnote">{actionError}</ThemedText> : null}
    </GlideSurface> : null}
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two, width: '100%' }, header: { gap: Spacing.two, width: '100%' },
  input: { borderRadius: 10, borderWidth: 1, minHeight: 44, paddingHorizontal: Spacing.two },
  ratingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
});
