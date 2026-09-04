import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, TextInput, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { createTutorConnectOnboarding, getTutorConnectStatus, saveTutorMeetingUrl, type TutorConnectStatus } from '@/features/tutor-marketplace/api';
import { isHumanTutorCommerceEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; connect: TutorConnectStatus };

export function TutorPayoutsScreen() {
  const enabled = isHumanTutorCommerceEnabled();
  const theme = useTheme();
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>(enabled ? { kind: 'loading' } : { kind: 'error' });
  const [meetingUrl, setMeetingUrl] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const current = ++sequence.current;
    void getTutorConnectStatus(true, controller.signal).then((connect) => {
      if (!controller.signal.aborted && current === sequence.current) setState({ kind: 'ready', connect });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || current !== sequence.current) return;
      if (error instanceof ApiClientError && error.kind === 'cancelled') return;
      setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [enabled, retry]);

  const onboard = async () => {
    if (working) return;
    setWorking('connect'); setMessage(null);
    try { const link = await createTutorConnectOnboarding(); await Linking.openURL(link.url); }
    catch { setMessage('Payout onboarding could not be opened. No account readiness was assumed.'); }
    finally { setWorking(null); }
  };
  const saveMeeting = async () => {
    if (working) return;
    setWorking('meeting'); setMessage(null);
    try { await saveTutorMeetingUrl(meetingUrl.trim()); setMessage('Approved meeting link saved for future bookings.'); }
    catch { setMessage('Use an HTTPS link from an operator-approved meeting host.'); }
    finally { setWorking(null); }
  };

  return <ScreenFrame testID={enabled ? 'tutor-payouts-screen' : 'tutor-payouts-disabled'}>
    <View style={styles.header}><ThemedText type="eyebrow" themeColor="textSecondary">TUTOR COMMERCE</ThemedText><ThemedText type="display">Payouts and lesson room.</ThemedText></View>
    {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading tutor payout status" padding="roomy" style={styles.card}><ActivityIndicator color={theme.tint} /></GlideSurface> : null}
    {state.kind === 'error' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted"><ThemedText type="title2">Tutor commerce is unavailable.</ThemedText>{enabled ? <GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} /> : null}</GlideSurface> : null}
    {state.kind === 'ready' ? <>
      <GlideSurface padding="roomy" style={styles.card} variant={state.connect.status === 'ready' ? 'success' : 'tinted'}>
        <ThemedText type="title2">Stripe payout status: {state.connect.status.replaceAll('_', ' ')}</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">GlideLingo stores only bounded readiness facts. Stripe hosts the sensitive onboarding form.</ThemedText>
        {state.connect.requirementsDue ? <ThemedText type="footnote">{state.connect.requirementsDue} onboarding requirement(s) remain.</ThemedText> : null}
        {state.connect.status !== 'ready' ? <GlideButton disabled={working !== null} label={working === 'connect' ? 'Opening…' : 'Continue Stripe onboarding'} onPress={() => void onboard()} /> : null}
      </GlideSurface>
      <GlideSurface padding="roomy" style={styles.card}>
        <ThemedText type="title2">Approved external meeting link</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">Only confirmed participants receive this protected link. GlideLingo does not host or record calls.</ThemedText>
        <TextInput accessibilityLabel="Approved tutor meeting URL" autoCapitalize="none" autoCorrect={false} maxLength={1000} onChangeText={setMeetingUrl} placeholder="https://meet.example.com/your-room" placeholderTextColor={theme.textTertiary} style={[styles.input, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]} value={meetingUrl} />
        <GlideButton disabled={working !== null || !meetingUrl.trim()} label={working === 'meeting' ? 'Saving…' : 'Save meeting link'} onPress={() => void saveMeeting()} variant="secondary" />
      </GlideSurface>
    </> : null}
    {message ? <ThemedText accessibilityRole="alert" type="footnote">{message}</ThemedText> : null}
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two, width: '100%' }, header: { gap: Spacing.two, width: '100%' },
  input: { borderRadius: Radii.medium, borderWidth: 1, fontFamily: Fonts.sans, fontSize: 15, minHeight: 48, paddingHorizontal: Spacing.two },
});
