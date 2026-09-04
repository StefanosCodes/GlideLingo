import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { GlideSwitch } from '@/components/ui/glide-switch';
import { Radii, Spacing } from '@/constants/theme';
import {
  getMarketplaceMessageEmailPreference,
  listMarketplaceConversations,
  setMarketplaceMessageEmailPreference,
  type MarketplaceConversation,
} from '@/features/tutor-marketplace/api';
import {
  isHumanTutorMarketplaceAcquisitionEnabled,
  isHumanTutorMessagingEnabled,
} from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; conversations: MarketplaceConversation[]; nextCursor: string | null };

export function MarketplaceMessagesScreen() {
  const enabled = isHumanTutorMessagingEnabled();
  const acquisitionEnabled = isHumanTutorMarketplaceAcquisitionEnabled();
  const router = useRouter();
  const theme = useTheme();
  const sequence = useRef(0);
  const preferenceBusy = useRef(false);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>(enabled ? { kind: 'loading' } : { kind: 'error' });
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const current = ++sequence.current;
    void Promise.all([
      listMarketplaceConversations(controller.signal),
      getMarketplaceMessageEmailPreference(controller.signal),
    ]).then(([page, preference]) => {
        if (!controller.signal.aborted && current === sequence.current) {
          setState({ kind: 'ready', conversations: page.items, nextCursor: page.nextCursor });
          setEmailEnabled(preference);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || current !== sequence.current) return;
        if (error instanceof ApiClientError && error.kind === 'cancelled') return;
        setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [enabled, retry]);

  const loadMore = async () => {
    if (state.kind !== 'ready' || state.nextCursor === null || loadingMore) return;
    const cursor = state.nextCursor;
    const request = ++sequence.current;
    setLoadingMore(true);
    setPageError(false);
    try {
      const page = await listMarketplaceConversations(undefined, cursor);
      if (request !== sequence.current) return;
      setState((current) => current.kind === 'ready' && current.nextCursor === cursor ? {
        kind: 'ready',
        conversations: [...current.conversations, ...page.items.filter((conversation) =>
          !current.conversations.some((existing) => existing.conversationId === conversation.conversationId))],
        nextCursor: page.nextCursor,
      } : current);
    } catch {
      if (request === sequence.current) setPageError(true);
    } finally {
      if (request === sequence.current) setLoadingMore(false);
    }
  };

  const updatePreference = async (value: boolean) => {
    if (preferenceBusy.current) return;
    preferenceBusy.current = true;
    const previous = emailEnabled;
    setEmailEnabled(value); setSavingPreference(true); setPreferenceError(null);
    try { setEmailEnabled(await setMarketplaceMessageEmailPreference(value)); }
    catch {
      setEmailEnabled(previous);
      setPreferenceError('Email preference could not be saved. Your previous setting was restored.');
    }
    finally { preferenceBusy.current = false; setSavingPreference(false); }
  };

  if (!enabled) {
    return <ScreenFrame><GlideSurface accessibilityRole="alert" padding="roomy"><ThemedText type="title2">Messaging is not available.</ThemedText></GlideSurface></ScreenFrame>;
  }

  return (
    <ScreenFrame testID="marketplace-messages-screen">
      <View style={styles.heading}>
        <ThemedText type="eyebrow" themeColor="textSecondary">HUMAN TUTOR MESSAGES</ThemedText>
        <ThemedText type="display">Conversations</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">
          Messages are text only. Before a booking, contact details and external links are not allowed.
        </ThemedText>
      </View>
      {emailEnabled !== null ? <GlideSurface padding="roomy" style={styles.card}>
        <View style={styles.preferenceRow}><View style={styles.preferenceCopy}>
          <ThemedText type="title3">New-message email</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">Email includes no message text or lesson details.</ThemedText>
        </View><GlideSwitch accessibilityLabel="New-message email" onValueChange={(value) => void updatePreference(value)}
          testID="message-email-preference" value={emailEnabled} /></View>
        {savingPreference ? <ThemedText type="footnote" themeColor="textSecondary">Saving preference…</ThemedText> : null}
        {preferenceError ? <ThemedText accessibilityRole="alert" type="footnote">{preferenceError}</ThemedText> : null}
      </GlideSurface> : null}
      {state.kind === 'loading' ? (
        <GlideSurface accessible accessibilityLabel="Loading tutor conversations" padding="roomy" style={styles.card}>
          <ActivityIndicator color={theme.tint} /><ThemedText type="headline">Loading conversations…</ThemedText>
        </GlideSurface>
      ) : null}
      {state.kind === 'error' ? (
        <GlideSurface accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted">
          <ThemedText type="title2">Conversations could not be loaded.</ThemedText>
          <GlideButton label="Try again" onPress={() => {
            setLoadingMore(false); setPageError(false); setState({ kind: 'loading' });
            setRetry((value) => value + 1);
          }} variant="secondary" />
        </GlideSurface>
      ) : null}
      {state.kind === 'ready' && state.conversations.length === 0 ? (
        <GlideSurface padding="roomy" style={styles.card} variant="tinted">
          <ThemedText type="title2">No conversations yet.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary">{acquisitionEnabled ? 'Open a tutor profile to start a safe, private conversation.' : 'New tutor conversations are paused. Existing conversations remain available.'}</ThemedText>
          {acquisitionEnabled ? <GlideButton label="Find a tutor" onPress={() => router.push('/tutors')} variant="secondary" /> : null}
        </GlideSurface>
      ) : null}
      {state.kind === 'ready' ? state.conversations.map((conversation) => (
        <Pressable
          accessibilityHint="Opens this tutor marketplace conversation"
          accessibilityRole="button"
          key={conversation.conversationId}
          onPress={() => router.push(`/messages/${conversation.conversationId}`)}
          style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.68 : 1 }]}>
          <ThemedText type="title3">{conversation.participantRole === 'learner' ? 'Tutor conversation' : 'Learner conversation'}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {conversation.state === 'open' ? 'Open' : 'Closed'} · updated {new Date(conversation.updatedAt).toLocaleString()}
          </ThemedText>
        </Pressable>
      )) : null}
      {state.kind === 'ready' && state.nextCursor !== null ? <GlideButton
        disabled={loadingMore}
        label={loadingMore ? 'Loading more conversations…' : 'Load more conversations'}
        onPress={() => void loadMore()}
        variant="secondary"
      /> : null}
      {pageError ? <ThemedText accessibilityRole="alert" type="footnote">More conversations could not be loaded. Existing results are unchanged.</ThemedText> : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two, width: '100%' },
  heading: { gap: Spacing.two, width: '100%' },
  preferenceCopy: { flex: 1, gap: Spacing.one },
  preferenceRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two, justifyContent: 'space-between' },
  row: { borderRadius: Radii.large, borderWidth: 1, gap: Spacing.one, padding: Spacing.three, width: '100%' },
});
