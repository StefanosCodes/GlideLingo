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

type SearchFilters = Parameters<typeof listPublicTutors>[0];
type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; tutors: PublicTutor[]; nextCursor: string | null };

export function TutorDiscoveryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const enabled = isHumanTutorMarketplaceEnabled();
  const sequence = useRef(0);
  const [language, setLanguage] = useState('');
  const [dialect, setDialect] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [maximumPrice, setMaximumPrice] = useState('');
  const [minimumRating, setMinimumRating] = useState('');
  const [availableBefore, setAvailableBefore] = useState('');
  const [duration, setDuration] = useState<25 | 50 | undefined>();
  const [verifiedCredential, setVerifiedCredential] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [state, setState] = useState<State>(enabled ? { kind: 'loading' } : { kind: 'error' });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const current = ++sequence.current;
    void listPublicTutors(filters, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && current === sequence.current) setState({ kind: 'ready', tutors: result.items, nextCursor: result.nextCursor });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || current !== sequence.current) return;
        if (error instanceof ApiClientError && error.kind === 'cancelled') return;
        setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [enabled, filters, retry]);

  const search = () => {
    const price = Number(maximumPrice);
    const rating = Number(minimumRating);
    const availabilityDeadline = Date.parse(availableBefore);
    setState({ kind: 'loading' });
    setLoadingMore(false);
    setPageError(false);
    setRetry((value) => value + 1);
    setFilters({
      ...(language.trim() ? { language: language.trim().toLowerCase() } : {}),
      ...(dialect.trim() ? { dialect: dialect.trim().toLowerCase() } : {}),
      ...(specialty.trim() ? { specialty: specialty.trim() } : {}),
      ...(duration ? { durationMinutes: duration } : {}),
      ...(maximumPrice && Number.isFinite(price) ? { maximumAmountMinor: Math.round(price * 100) } : {}),
      ...(minimumRating && Number.isFinite(rating) ? { minimumRating: rating } : {}),
      ...(availableBefore && Number.isFinite(availabilityDeadline)
        ? { availableBefore: new Date(availabilityDeadline).toISOString() }
        : {}),
      ...(verifiedCredential ? { verifiedCredential: true } : {}),
      ...(favorite ? { favorite: true } : {}),
    });
  };

  const loadMore = async () => {
    if (state.kind !== 'ready' || !state.nextCursor || loadingMore) return;
    const cursor = state.nextCursor;
    const request = ++sequence.current;
    setLoadingMore(true);
    setPageError(false);
    try {
      const result = await listPublicTutors({ ...filters, cursor });
      if (request !== sequence.current) return;
      setState((current) => {
        if (current.kind !== 'ready' || current.nextCursor !== cursor) return current;
        const existing = new Set(current.tutors.map((tutor) => tutor.tutorId));
        return {
          kind: 'ready',
          tutors: [...current.tutors, ...result.items.filter((tutor) => !existing.has(tutor.tutorId))],
          nextCursor: result.nextCursor,
        };
      });
    } catch {
      if (request === sequence.current) setPageError(true);
    } finally {
      if (request === sequence.current) setLoadingMore(false);
    }
  };

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
        onChangeText={setLanguage} onSubmitEditing={search}
        placeholder="For example: el" placeholderTextColor={theme.textTertiary} returnKeyType="search"
        style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
        value={language} />
      <FilterInput label="Filter by dialect code" value={dialect} onChangeText={setDialect} theme={theme} />
      <FilterInput label="Filter by specialty" value={specialty} onChangeText={setSpecialty} theme={theme} />
      <FilterInput label="Maximum price in USD" value={maximumPrice} onChangeText={setMaximumPrice} theme={theme} />
      <FilterInput label="Minimum rating from 1 to 5" value={minimumRating} onChangeText={setMinimumRating} theme={theme} />
      <FilterInput label="Available before (ISO date and time)" value={availableBefore} onChangeText={setAvailableBefore} theme={theme} />
      <GlideButton label={duration ? `Duration: ${duration} minutes` : 'Duration: any'} onPress={() => setDuration((value) => value === undefined ? 25 : value === 25 ? 50 : undefined)} variant="secondary" />
      <GlideButton label={verifiedCredential ? 'Verified credential: required' : 'Verified credential: any'} onPress={() => setVerifiedCredential((value) => !value)} variant="secondary" />
      <GlideButton label={favorite ? 'Favorites only' : 'All tutors'} onPress={() => setFavorite((value) => !value)} variant="secondary" />
      <GlideButton label="Search tutors" onPress={search} />
    </GlideSurface>
    {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading tutors" padding="roomy" style={styles.card}>
      <ActivityIndicator color={theme.tint} /><ThemedText type="headline">Loading tutors…</ThemedText>
    </GlideSurface> : null}
    {state.kind === 'error' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted">
      <ThemedText type="title2">Tutors could not be loaded.</ThemedText>
      <GlideButton label="Try again" onPress={() => {
        setLoadingMore(false); setPageError(false); setState({ kind: 'loading' });
        setRetry((value) => value + 1);
      }} variant="secondary" />
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
    {state.kind === 'ready' && state.nextCursor ? <GlideButton disabled={loadingMore}
      label={loadingMore ? 'Loading more tutors…' : 'Load more tutors'} onPress={() => void loadMore()}
      variant="secondary" /> : null}
    {pageError ? <GlideSurface accessible accessibilityRole="alert" padding="regular" style={styles.card}
      variant="tinted"><ThemedText type="body">More tutors could not be loaded. The current results are unchanged.</ThemedText>
    </GlideSurface> : null}
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

function FilterInput({ label, value, onChangeText, theme }: { label: string; value: string; onChangeText: (value: string) => void; theme: ReturnType<typeof useTheme> }) {
  return <TextInput accessibilityLabel={label} autoCapitalize="none" maxLength={64} onChangeText={onChangeText} placeholder={label} placeholderTextColor={theme.textTertiary} style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]} value={value} />;
}
