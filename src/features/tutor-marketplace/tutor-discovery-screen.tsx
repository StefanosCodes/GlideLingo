import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Radii, Spacing } from '@/constants/theme';
import { listPublicTutors, type PublicTutor } from '@/features/tutor-marketplace/api';
import { isHumanTutorMarketplaceEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; tutors: PublicTutor[] };

export function TutorDiscoveryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const enabled = isHumanTutorMarketplaceEnabled();
  const sequence = useRef(0);
  const [language, setLanguage] = useState('');
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>(enabled ? { kind: 'loading' } : { kind: 'error' });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const current = ++sequence.current;
    void listPublicTutors(query ? { language: query } : {}, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && current === sequence.current) setState({ kind: 'ready', tutors: result.items });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || current !== sequence.current) return;
        if (error instanceof ApiClientError && error.kind === 'cancelled') return;
        setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [enabled, query, retry]);

  if (!enabled) return <ScreenFrame><ThemedText type="title2">Tutor discovery is not available yet.</ThemedText></ScreenFrame>;

  return <ScreenFrame testID="tutor-discovery-screen">
    <View style={styles.header}>
      <ThemedText type="eyebrow" themeColor="textSecondary">HUMAN TUTORS</ThemedText>
      <ThemedText type="display">Find a tutor who fits your goals.</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">Results are deterministic and show only approved, payout-ready tutors with published lessons.</ThemedText>
    </View>
    <GlideSurface padding="regular" style={styles.filters}>
      <ThemedText type="headline">Language code</ThemedText>
      <TextInput accessibilityLabel="Filter by language code" autoCapitalize="none" maxLength={32}
        onChangeText={setLanguage} onSubmitEditing={() => { setState({ kind: 'loading' }); setQuery(language.trim().toLowerCase()); setRetry((value) => value + 1); }}
        placeholder="For example: el" placeholderTextColor={theme.textTertiary} returnKeyType="search"
        style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
        value={language} />
      <GlideButton label="Search tutors" onPress={() => { setState({ kind: 'loading' }); setQuery(language.trim().toLowerCase()); setRetry((value) => value + 1); }} />
    </GlideSurface>
    {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading tutors" padding="roomy" style={styles.card}>
      <ActivityIndicator color={theme.tint} /><ThemedText type="headline">Loading tutors…</ThemedText>
    </GlideSurface> : null}
    {state.kind === 'error' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted">
      <ThemedText type="title2">Tutors could not be loaded.</ThemedText>
      <GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} variant="secondary" />
    </GlideSurface> : null}
    {state.kind === 'ready' && state.tutors.length === 0 ? <GlideSurface padding="roomy" style={styles.card} variant="tinted">
      <ThemedText type="title2">No tutors match these filters yet.</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">Try another language or return later as approved tutors add hours.</ThemedText>
    </GlideSurface> : null}
    {state.kind === 'ready' ? state.tutors.map((tutor) => <Pressable accessibilityHint="Opens the tutor's public profile"
      accessibilityRole="button" key={tutor.tutorId} onPress={() => router.push(`/tutors/${tutor.tutorId}`)}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      <GlideSurface padding="roomy" style={styles.card}>
        <ThemedText type="title2">{tutor.headline}</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">{tutor.languages.join(', ')} · {tutor.durationMinutes} min · ${(tutor.amountMinor / 100).toFixed(2)} USD</ThemedText>
        <ThemedText numberOfLines={3} type="body">{tutor.biography}</ThemedText>
      </GlideSurface>
    </Pressable>) : null}
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two, width: '100%' },
  filters: { gap: Spacing.two, width: '100%' },
  header: { gap: Spacing.two, width: '100%' },
  input: { borderRadius: Radii.medium, borderWidth: 1, minHeight: 48, paddingHorizontal: Spacing.three },
  pressable: { borderRadius: Radii.large, width: '100%' },
  pressed: { opacity: 0.78 },
});
