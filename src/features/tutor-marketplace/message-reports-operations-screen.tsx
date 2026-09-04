import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Radii, Spacing } from '@/constants/theme';
import {
  getMarketplaceMessageReport,
  listMarketplaceMessageReports,
  recoverMarketplaceConversationNotifications,
  resolveMarketplaceMessageReport,
  type MarketplaceMessageReport,
} from '@/features/tutor-marketplace/api';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | {
  kind: 'ready'; reports: MarketplaceMessageReport[]; nextOffset: number | null;
};

export function MessageReportsOperationsScreen() {
  const theme = useTheme();
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [working, setWorking] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<MarketplaceMessageReport | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolutionReason, setResolutionReason] = useState('');
  const [notificationReason, setNotificationReason] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    setLoadingMore(false);
    void listMarketplaceMessageReports(controller.signal).then((page) => {
      if (!controller.signal.aborted && current === sequence.current) setState({
        kind: 'ready', reports: page.items, nextOffset: page.nextOffset,
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || current !== sequence.current) return;
      if (error instanceof ApiClientError && error.kind === 'cancelled') return;
      setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [retry]);

  const loadMore = async () => {
    if (state.kind !== 'ready' || state.nextOffset === null || loadingMore) return;
    const offset = state.nextOffset;
    setLoadingMore(true); setActionError(null);
    try {
      const page = await listMarketplaceMessageReports(undefined, offset);
      setState((current) => current.kind === 'ready' && current.nextOffset === offset ? {
        kind: 'ready', reports: [...current.reports, ...page.items], nextOffset: page.nextOffset,
      } : current);
    } catch { setActionError('More reports could not be loaded. Existing results are unchanged.'); }
    finally { setLoadingMore(false); }
  };

  const resolve = async (report: MarketplaceMessageReport) => {
    if (working) return;
    setWorking(report.reportId); setActionError(null);
    try {
      const updated = await resolveMarketplaceMessageReport(report.reportId, resolutionReason.trim());
      setState((current) => current.kind === 'ready' ? {
        kind: 'ready', reports: current.reports.map((item) => item.reportId === updated.reportId ? updated : item),
        nextOffset: current.nextOffset,
      } : current);
      setReviewing(updated);
      setResolutionReason('');
    } catch { setActionError('This report could not be resolved. Its previous status is unchanged.'); }
    finally { setWorking(null); }
  };

  const review = async (reportId: string) => {
    if (working) return;
    setWorking(reportId); setActionError(null);
    try { setReviewing(await getMarketplaceMessageReport(reportId)); }
    catch { setActionError('The report context could not be loaded. Access was not broadened.'); }
    finally { setWorking(null); }
  };

  const recoverNotifications = async (report: MarketplaceMessageReport) => {
    if (working) return;
    setWorking(report.reportId); setActionError(null);
    try {
      await recoverMarketplaceConversationNotifications(
        report.conversationId,
        notificationReason.trim(),
      );
      setNotificationReason('');
      setActionError('Failed conversation notifications were requeued for bounded delivery.');
    } catch {
      setActionError('Notifications could not be recovered. No delivery status was inferred.');
    } finally { setWorking(null); }
  };

  return <ScreenFrame testID="message-reports-operations-screen">
    <View style={styles.heading}><ThemedText type="eyebrow" themeColor="textSecondary">MARKETPLACE SAFETY OPERATIONS</ThemedText>
      <ThemedText type="display">Message reports</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">Access is capability-scoped and every report view or resolution is audited.</ThemedText></View>
    {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading message reports" padding="roomy" style={styles.card}>
      <ActivityIndicator color={theme.tint} /><ThemedText type="headline">Loading reports…</ThemedText></GlideSurface> : null}
    {state.kind === 'error' ? <GlideSurface accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted">
      <ThemedText type="title2">Reports could not be loaded.</ThemedText><GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} variant="secondary" />
    </GlideSurface> : null}
    {state.kind === 'ready' && state.reports.length === 0 ? <GlideSurface padding="roomy" style={styles.card} variant="success">
      <ThemedText type="title2">No message reports need review.</ThemedText></GlideSurface> : null}
    {state.kind === 'ready' ? state.reports.map((report) => <GlideSurface key={report.reportId} padding="roomy" style={styles.card}>
      <ThemedText type="eyebrow" themeColor="textSecondary">{report.status.toUpperCase()} · {report.reason.toUpperCase()}</ThemedText>
      {report.details ? <ThemedText type="body">Reporter note: {report.details}</ThemedText> : null}
      {reviewing?.reportId === report.reportId ? reviewing.messages.map((message) => <View key={message.messageId} style={styles.message}>
        <ThemedText type="footnote" themeColor="textSecondary">{message.senderRole.toUpperCase()}</ThemedText>
        <ThemedText type="body" selectable>{message.body}</ThemedText>
      </View>) : null}
      {reviewing?.reportId !== report.reportId ? <GlideButton disabled={working !== null} label={working === report.reportId ? 'Loading context…' : 'Review report'} onPress={() => void review(report.reportId)} variant="secondary" /> : null}
      {report.status === 'open' && reviewing?.reportId === report.reportId ? <TextInput
        accessibilityLabel="Report resolution reason" maxLength={1000} multiline
        onChangeText={setResolutionReason} placeholder="Document the evidence and decision"
        placeholderTextColor={theme.textTertiary}
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
        value={resolutionReason}
      /> : null}
      {report.status === 'open' && reviewing?.reportId === report.reportId ? <GlideButton
        disabled={working !== null || resolutionReason.trim().length < 8}
        label={working === report.reportId ? 'Resolving…' : 'Resolve after review'}
        onPress={() => void resolve(report)} variant="secondary" /> : null}
      {reviewing?.reportId === report.reportId ? <TextInput
        accessibilityLabel="Notification recovery reason" maxLength={1000} multiline
        onChangeText={setNotificationReason} placeholder="Document why delivery should be retried"
        placeholderTextColor={theme.textTertiary}
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
        value={notificationReason}
      /> : null}
      {reviewing?.reportId === report.reportId ? <GlideButton
        disabled={working !== null || notificationReason.trim().length < 8}
        label={working === report.reportId ? 'Recovering…' : 'Retry failed notifications'}
        onPress={() => void recoverNotifications(report)} variant="secondary" /> : null}
    </GlideSurface>) : null}
    {state.kind === 'ready' && state.nextOffset !== null ? <GlideButton disabled={loadingMore}
      label={loadingMore ? 'Loading more reports…' : 'Load more reports'}
      onPress={() => void loadMore()} variant="secondary" /> : null}
    {actionError ? <GlideSurface accessibilityRole="alert" padding="regular" style={styles.card} variant="tinted"><ThemedText type="body">{actionError}</ThemedText></GlideSurface> : null}
  </ScreenFrame>;
}

const styles = StyleSheet.create({ card: { gap: Spacing.two, width: '100%' }, heading: { gap: Spacing.two, width: '100%' }, input: { borderRadius: Radii.medium, borderWidth: 1, minHeight: 88, padding: Spacing.two }, message: { gap: Spacing.one } });
