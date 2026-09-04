import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Radii, Spacing } from '@/constants/theme';
import { getOwnManualAvailability, previewOwnManualSlots, replaceOwnManualAvailability, type ManualAvailability, type TutorSlot } from '@/features/tutor-marketplace/api';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; availability: ManualAvailability; preview: TutorSlot[] };

export function TutorAvailabilityScreen() {
  const theme = useTheme();
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
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
      setState({ kind: 'ready', availability, preview: preview.slots });
    }).catch(() => {
      if (!controller.signal.aborted && current === sequence.current) setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [retry]);

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
      setState({ kind: 'ready', availability, preview: preview.slots });
    } catch {
      setState({ kind: 'error' });
    } finally { setSaving(false); }
  };

  if (state.kind === 'loading') return <ScreenFrame><GlideSurface accessible accessibilityLabel="Loading tutor availability" padding="roomy" style={styles.card}><ActivityIndicator color={theme.tint} /><ThemedText type="headline">Loading availability…</ThemedText></GlideSurface></ScreenFrame>;
  if (state.kind === 'error') return <ScreenFrame><GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted"><ThemedText type="title2">Availability could not be loaded.</ThemedText><GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} variant="secondary" /></GlideSurface></ScreenFrame>;
  return <ScreenFrame testID="tutor-availability-screen"><View style={styles.header}><ThemedText type="eyebrow" themeColor="textSecondary">TUTOR AVAILABILITY</ThemedText><ThemedText type="display">Set dependable weekly hours.</ThemedText><ThemedText type="body" themeColor="textSecondary">Times use {state.availability.timeZone}. Lead time and lesson buffers are enforced by the server.</ThemedText></View>
    <GlideSurface padding="roomy" style={styles.card}><Field label="Weekday (Monday is 0)" onChangeText={setWeekday} value={weekday} /><Field label="Start time (HH:MM)" onChangeText={setStartLocal} value={startLocal} /><Field label="End time (HH:MM)" onChangeText={setEndLocal} value={endLocal} /><Field label="Dialects (comma separated)" onChangeText={setDialects} value={dialects} /><GlideButton disabled={saving || !/^[0-6]$/.test(weekday) || !/^\d{2}:\d{2}$/.test(startLocal) || !/^\d{2}:\d{2}$/.test(endLocal)} label={saving ? 'Saving hours…' : 'Save weekly hours'} onPress={() => void save()} /></GlideSurface>
    <GlideSurface padding="roomy" style={styles.card}><ThemedText type="title2">Two-week preview</ThemedText>{state.preview.length === 0 ? <ThemedText type="body" themeColor="textSecondary">No slots yet. Add an active offering and hours to preview availability.</ThemedText> : state.preview.slice(0, 10).map((slot) => <ThemedText key={slot.startsAt} type="body">{new Date(slot.startsAt).toLocaleString()}</ThemedText>)}</GlideSurface>
  </ScreenFrame>;
}

function Field({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
  const theme = useTheme();
  return <View style={styles.field}><ThemedText type="headline">{label}</ThemedText><TextInput accessibilityLabel={label} autoCapitalize="none" maxLength={80} onChangeText={onChangeText} style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]} value={value} /></View>;
}

const styles = StyleSheet.create({ card: { gap: Spacing.two, width: '100%' }, field: { gap: Spacing.one }, header: { gap: Spacing.two, width: '100%' }, input: { borderRadius: Radii.medium, borderWidth: 1, minHeight: 48, paddingHorizontal: Spacing.three } });
