import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { createMarketplaceConversation, getPublicTutor, listPublicTutorSlots, setPublicTutorFavorite, type PublicTutor, type TutorSlot } from '@/features/tutor-marketplace/api';
import { isHumanTutorMessagingEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | {
  kind: 'ready';
  tutor: PublicTutor;
  slots: TutorSlot[];
  slotFreshness: 'current' | 'stale' | 'reconnect_required';
};

export function TutorPublicProfileScreen() {
  const { tutorId } = useLocalSearchParams<{ tutorId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    void Promise.all([
      getPublicTutor(tutorId, controller.signal),
      listPublicTutorSlots(tutorId, startsAt.toISOString(), endsAt.toISOString(), controller.signal),
    ]).then(([tutor, slots]) => {
      if (!controller.signal.aborted && current === sequence.current) {
        setState({ kind: 'ready', tutor, slots: slots.slots, slotFreshness: slots.freshness });
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
    if (savingFavorite) return;
    setSavingFavorite(true);
    try {
      const tutor = await setPublicTutorFavorite(state.tutor.tutorId, !state.tutor.isFavorite);
      setState({ ...state, tutor });
    } finally {
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
  return <ScreenFrame testID="tutor-public-profile-screen">
    <View style={styles.header}><ThemedText type="eyebrow" themeColor="textSecondary">PUBLIC TUTOR PROFILE</ThemedText>
      <ThemedText type="display">{state.tutor.headline}</ThemedText>
      <ThemedText type="body">{state.tutor.biography}</ThemedText></View>
    <GlideSurface padding="roomy" style={styles.card}>
      <ThemedText type="title2">{state.tutor.offeringTitle}</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">{state.tutor.durationMinutes} minutes · ${(state.tutor.amountMinor / 100).toFixed(2)} USD · {state.tutor.timeZone}</ThemedText>
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
        state.slots.slice(0, 8).map((slot) => <ThemedText key={slot.startsAt} type="body">{new Date(slot.startsAt).toLocaleString()}</ThemedText>)}
    </GlideSurface>
  </ScreenFrame>;
}

const styles = StyleSheet.create({ card: { gap: Spacing.two, width: '100%' }, header: { gap: Spacing.two, width: '100%' } });
