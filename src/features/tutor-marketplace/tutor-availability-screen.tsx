import { useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, TextInput, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Radii, Spacing } from '@/constants/theme';
import { completeTutorCalendarOAuth, getOwnManualAvailability, getTutorCalendarConnection, previewOwnManualSlots, refreshTutorCalendar, replaceOwnManualAvailability, revokeTutorCalendar, startTutorCalendarOAuth, type CalendarConnection, type ManualAvailability, type TutorSlot } from '@/features/tutor-marketplace/api';
import { isHumanTutorGoogleCalendarEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | {
  kind: 'ready';
  availability: ManualAvailability;
  preview: TutorSlot[];
  previewFreshness: 'current' | 'stale' | 'reconnect_required';
};

export function TutorAvailabilityScreen() {
  const calendarEnabled = isHumanTutorGoogleCalendarEnabled();
  const { code: calendarCode, state: calendarState } = useLocalSearchParams<{ code?: string; state?: string }>();
  const theme = useTheme();
  const sequence = useRef(0);
  const completedOAuthState = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [calendar, setCalendar] = useState<CalendarConnection | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarError, setCalendarError] = useState(false);
  const [weekday, setWeekday] = useState('0');
  const [startLocal, setStartLocal] = useState('09:00');
  const [endLocal, setEndLocal] = useState('12:00');
  const [dialects, setDialects] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    const starts = new Date();
    const ends = new Date(starts.getTime() + 14 * 24 * 60 * 60 * 1000);
    void Promise.all([
      getOwnManualAvailability(controller.signal),
      previewOwnManualSlots(starts.toISOString(), ends.toISOString(), controller.signal),
    ]).then(([availability, preview]) => {
      if (controller.signal.aborted || current !== sequence.current) return;
      const first = availability.rules[0];
      if (first) { setWeekday(String(first.weekday)); setStartLocal(first.startLocal.slice(0, 5)); setEndLocal(first.endLocal.slice(0, 5)); }
      setDialects(availability.dialects.join(', '));
      setState({
        kind: 'ready', availability, preview: preview.slots, previewFreshness: preview.freshness,
      });
    }).catch(() => {
      if (!controller.signal.aborted && current === sequence.current) setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!calendarEnabled) return;
    const controller = new AbortController();
    void getTutorCalendarConnection(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setCalendar(value); })
      .catch(() => { if (!controller.signal.aborted) setCalendarError(true); });
    return () => controller.abort();
  }, [calendarEnabled, retry]);

  useEffect(() => {
    if (!calendarEnabled || !calendarCode || !calendarState || completedOAuthState.current === calendarState) return;
    completedOAuthState.current = calendarState;
    setCalendarBusy(true);
    void completeTutorCalendarOAuth(calendarState, calendarCode, calendarRedirectUri())
      .then((value) => setCalendar(value))
      .catch(() => setCalendarError(true))
      .finally(() => setCalendarBusy(false));
  }, [calendarCode, calendarEnabled, calendarState]);

  const connectCalendar = async () => {
    if (calendarBusy) return;
    setCalendarBusy(true); setCalendarError(false);
    try {
      const result = await startTutorCalendarOAuth(calendarRedirectUri());
      await Linking.openURL(result.authorizationUrl);
    } catch { setCalendarError(true); } finally { setCalendarBusy(false); }
  };

  const refreshCalendar = async () => {
    if (calendarBusy) return;
    setCalendarBusy(true); setCalendarError(false);
    try { setCalendar(await refreshTutorCalendar()); } catch { setCalendarError(true); }
    finally { setCalendarBusy(false); }
  };

  const disconnectCalendar = async () => {
    if (calendarBusy) return;
    setCalendarBusy(true); setCalendarError(false);
    try { setCalendar(await revokeTutorCalendar()); } catch { setCalendarError(true); }
    finally { setCalendarBusy(false); }
  };

  const save = async () => {
    if (state.kind !== 'ready' || saving) return;
    setSaving(true);
    try {
      const effectiveFrom = new Date().toISOString().slice(0, 10);
      const availability = await replaceOwnManualAvailability({
        expectedProfileVersion: state.availability.profileVersion,
        leadTimeMinutes: state.availability.leadTimeMinutes,
        bufferBeforeMinutes: state.availability.bufferBeforeMinutes,
        bufferAfterMinutes: state.availability.bufferAfterMinutes,
        dialects: dialects.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
        rules: [{ weekday: Number(weekday), startLocal, endLocal, effectiveFrom, effectiveUntil: null }],
        exceptions: state.availability.exceptions,
      });
      const starts = new Date();
      const ends = new Date(starts.getTime() + 14 * 24 * 60 * 60 * 1000);
      const preview = await previewOwnManualSlots(starts.toISOString(), ends.toISOString());
      setState({
        kind: 'ready', availability, preview: preview.slots, previewFreshness: preview.freshness,
      });
    } catch {
      setState({ kind: 'error' });
    } finally { setSaving(false); }
  };

  if (state.kind === 'loading') return <ScreenFrame><GlideSurface accessible accessibilityLabel="Loading tutor availability" padding="roomy" style={styles.card}><ActivityIndicator color={theme.tint} /><ThemedText type="headline">Loading availability…</ThemedText></GlideSurface></ScreenFrame>;
  if (state.kind === 'error') return <ScreenFrame><GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted"><ThemedText type="title2">Availability could not be loaded.</ThemedText><GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} variant="secondary" /></GlideSurface></ScreenFrame>;
  return <ScreenFrame testID="tutor-availability-screen"><View style={styles.header}><ThemedText type="eyebrow" themeColor="textSecondary">TUTOR AVAILABILITY</ThemedText><ThemedText type="display">Set dependable weekly hours.</ThemedText><ThemedText type="body" themeColor="textSecondary">Times use {state.availability.timeZone}. Lead time and lesson buffers are enforced by the server.</ThemedText></View>
    <GlideSurface padding="roomy" style={styles.card}><Field label="Weekday (Monday is 0)" onChangeText={setWeekday} value={weekday} /><Field label="Start time (HH:MM)" onChangeText={setStartLocal} value={startLocal} /><Field label="End time (HH:MM)" onChangeText={setEndLocal} value={endLocal} /><Field label="Dialects (comma separated)" onChangeText={setDialects} value={dialects} /><GlideButton disabled={saving || !/^[0-6]$/.test(weekday) || !/^\d{2}:\d{2}$/.test(startLocal) || !/^\d{2}:\d{2}$/.test(endLocal)} label={saving ? 'Saving hours…' : 'Save weekly hours'} onPress={() => void save()} /></GlideSurface>
    {calendarEnabled ? <GlideSurface accessible={calendarError} accessibilityRole={calendarError ? 'alert' : undefined} padding="roomy" style={styles.card} variant={calendarError ? 'tinted' : undefined}>
      <ThemedText type="title2">Google Calendar free/busy</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">Only busy time ranges are used. Event names, descriptions, attendees, and locations are never retained.</ThemedText>
      {calendarError ? <ThemedText type="body">Calendar status could not be updated. Manual hours remain saved, but calendar-backed slots are not treated as current.</ThemedText> : null}
      {calendar?.status === 'reconnect_required' ? <ThemedText type="body">Google access was revoked. Reconnect before calendar-backed slots can appear.</ThemedText> : null}
      {calendar?.status === 'stale' ? <ThemedText type="body">Calendar availability is stale. Refresh it before learners can use these slots.</ThemedText> : null}
      {!calendar || calendar.status === 'disconnected' || calendar.status === 'reconnect_required' ?
        <GlideButton disabled={calendarBusy} label={calendarBusy ? 'Connecting…' : 'Connect Google Calendar'} onPress={() => void connectCalendar()} variant="secondary" /> :
        <><GlideButton disabled={calendarBusy} label={calendarBusy ? 'Refreshing…' : 'Refresh calendar'} onPress={() => void refreshCalendar()} variant="secondary" /><GlideButton disabled={calendarBusy} label="Disconnect calendar" onPress={() => void disconnectCalendar()} variant="secondary" /></>}
    </GlideSurface> : null}
    <GlideSurface padding="roomy" style={styles.card}><ThemedText type="title2">Two-week preview</ThemedText>{state.previewFreshness === 'stale' ? <ThemedText type="body" themeColor="textSecondary">Calendar availability is stale, so no calendar-backed time is shown as bookable.</ThemedText> : state.previewFreshness === 'reconnect_required' ? <ThemedText type="body" themeColor="textSecondary">Reconnect Google Calendar before calendar-backed times can appear.</ThemedText> : state.preview.length === 0 ? <ThemedText type="body" themeColor="textSecondary">No slots yet. Add an active offering and hours to preview availability.</ThemedText> : state.preview.slice(0, 10).map((slot) => <ThemedText key={slot.startsAt} type="body">{new Date(slot.startsAt).toLocaleString()}</ThemedText>)}</GlideSurface>
  </ScreenFrame>;
}

function Field({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
  const theme = useTheme();
  return <View style={styles.field}><ThemedText type="headline">{label}</ThemedText><TextInput accessibilityLabel={label} autoCapitalize="none" maxLength={80} onChangeText={onChangeText} style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]} value={value} /></View>;
}

const styles = StyleSheet.create({ card: { gap: Spacing.two, width: '100%' }, field: { gap: Spacing.one }, header: { gap: Spacing.two, width: '100%' }, input: { borderRadius: Radii.medium, borderWidth: 1, minHeight: 48, paddingHorizontal: Spacing.three } });

function calendarRedirectUri(): string {
  if (Platform.OS === 'web' && typeof globalThis.location?.origin === 'string') {
    return `${globalThis.location.origin}/tutor/availability`;
  }
  return Linking.createURL('/tutor/availability');
}
