import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  blockMarketplaceParticipant,
  listMarketplaceMessages,
  reportMarketplaceMessage,
  sendMarketplaceMessage,
  type MarketplaceMessage,
  TutorMarketplaceClientError,
} from '@/features/tutor-marketplace/api';
import { isHumanTutorMessagingEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; messages: MarketplaceMessage[] };

function createClientMessageId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (value) return value;
  return `00000000-0000-4000-8000-${Date.now().toString().padStart(12, '0').slice(-12)}`;
}

export function MarketplaceMessageThreadScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const enabled = isHumanTutorMessagingEnabled();
  const theme = useTheme();
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>(enabled ? { kind: 'loading' } : { kind: 'error' });
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState<'send' | 'block' | 'report' | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const current = ++sequence.current;
    void listMarketplaceMessages(conversationId, undefined, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted && current === sequence.current) setState({ kind: 'ready', messages: page.items });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || current !== sequence.current) return;
        if (error instanceof ApiClientError && error.kind === 'cancelled') return;
        setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [conversationId, enabled, retry]);

  const send = async () => {
    const body = draft.trim();
    if (working || !body) return;
    setWorking('send'); setActionMessage(null);
    try {
      const message = await sendMarketplaceMessage(conversationId, createClientMessageId(), body);
      setState((current) => current.kind === 'ready' ? { kind: 'ready', messages: [...current.messages, message] } : current);
      setDraft('');
    } catch (error) {
      setActionMessage(error instanceof TutorMarketplaceClientError && error.kind === 'limited'
        ? 'You have sent several messages quickly. Wait a minute before trying again.'
        : error instanceof TutorMarketplaceClientError && error.kind === 'validation'
          ? 'Before booking, messages cannot include contact details or links.'
          : 'That message was not sent. Your draft is still here.');
    } finally { setWorking(null); }
  };

  const block = async () => {
    if (working) return;
    setWorking('block'); setActionMessage(null);
    try { await blockMarketplaceParticipant(conversationId); setActionMessage('Participant blocked. New messages are disabled.'); }
    catch { setActionMessage('The participant could not be blocked. Try again.'); }
    finally { setWorking(null); }
  };

  const report = async () => {
    if (working || state.kind !== 'ready') return;
    const target = [...state.messages].reverse().find((message) => message.kind === 'user' && !message.isOwn);
    setWorking('report'); setActionMessage(null);
    try { await reportMarketplaceMessage(conversationId, target?.messageId ?? null, 'unsafe', null); setActionMessage('Report sent for review.'); }
    catch { setActionMessage('The report could not be sent. Try again.'); }
    finally { setWorking(null); }
  };

  if (!enabled) return <ScreenFrame><GlideSurface accessibilityRole="alert" padding="roomy"><ThemedText type="title2">Messaging is not available.</ThemedText></GlideSurface></ScreenFrame>;

  return <ScreenFrame testID="marketplace-message-thread-screen">
    <View style={styles.heading}><ThemedText type="eyebrow" themeColor="textSecondary">PRIVATE CONVERSATION</ThemedText>
      <ThemedText type="display">Tutor messages</ThemedText></View>
    {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading messages" padding="roomy" style={styles.card}>
      <ActivityIndicator color={theme.tint} /><ThemedText type="headline">Loading messages…</ThemedText>
    </GlideSurface> : null}
    {state.kind === 'error' ? <GlideSurface accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted">
      <ThemedText type="title2">Messages could not be loaded.</ThemedText>
      <GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} variant="secondary" />
    </GlideSurface> : null}
    {state.kind === 'ready' ? <>
      {state.messages.length === 0 ? <GlideSurface padding="roomy" style={styles.card} variant="tinted"><ThemedText type="body">No messages yet.</ThemedText></GlideSurface> : null}
      {state.messages.map((message) => <GlideSurface key={message.messageId} padding="regular" style={styles.card} variant={message.kind === 'system' ? 'tinted' : 'card'}>
        <ThemedText type="eyebrow" themeColor="textSecondary">{message.kind === 'system' ? 'GLIDELINGO' : message.isOwn ? 'YOU' : message.senderRole.toUpperCase()}</ThemedText>
        <ThemedText type="body" selectable>{message.body}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">{new Date(message.createdAt).toLocaleString()}</ThemedText>
      </GlideSurface>)}
      <GlideSurface padding="roomy" style={styles.card}>
        <ThemedText type="footnote" themeColor="textSecondary">Text only · 2,000 characters maximum</ThemedText>
        <TextInput accessibilityLabel="Message" maxLength={2000} multiline onChangeText={setDraft}
          placeholder="Write a message" placeholderTextColor={theme.textTertiary}
          style={[styles.input, { borderColor: theme.border, color: theme.text }]} value={draft} />
        <GlideButton disabled={working !== null || draft.trim().length === 0} label={working === 'send' ? 'Sending…' : 'Send message'} onPress={() => void send()} />
      </GlideSurface>
      <GlideSurface padding="roomy" style={styles.card}>
        <ThemedText type="title3">Safety controls</ThemedText>
        <View style={styles.actions}><GlideButton disabled={working !== null} label="Report latest message" onPress={() => void report()} variant="secondary" />
          <GlideButton disabled={working !== null} label="Block participant" onPress={() => void block()} variant="tertiary" /></View>
      </GlideSurface>
    </> : null}
    {actionMessage ? <GlideSurface accessibilityRole="alert" padding="regular" style={styles.card} variant="tinted"><ThemedText type="body">{actionMessage}</ThemedText></GlideSurface> : null}
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  card: { gap: Spacing.two, width: '100%' },
  heading: { gap: Spacing.two, width: '100%' },
  input: { borderRadius: Radii.medium, borderWidth: 1, fontFamily: Fonts.sans, fontSize: 16, minHeight: 112, padding: Spacing.two, textAlignVertical: 'top' },
});
