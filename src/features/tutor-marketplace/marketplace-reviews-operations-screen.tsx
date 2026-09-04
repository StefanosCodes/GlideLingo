import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  listMarketplaceReviews,
  moderateMarketplaceReview,
  type MarketplaceReview,
} from '@/features/tutor-marketplace/api';
import { useTheme } from '@/hooks/use-theme';

type State =
  | { kind: 'loading' }
  | { kind: 'forbidden' | 'error' }
  | { kind: 'ready'; reviews: MarketplaceReview[]; nextOffset: number | null };

export function MarketplaceReviewsOperationsScreen() {
  const theme = useTheme();
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    setLoadingMore(false);
    void listMarketplaceReviews(controller.signal).then((page) => {
      if (!controller.signal.aborted && current === sequence.current) {
        setState({ kind: 'ready', reviews: page.items, nextOffset: page.nextOffset });
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted || current !== sequence.current) return;
      if (error instanceof ApiClientError && error.kind === 'cancelled') return;
      setState({ kind: error instanceof ApiClientError && error.status === 403 ? 'forbidden' : 'error' });
    });
    return () => controller.abort();
  }, [retry]);

  const loadMore = async () => {
    if (state.kind !== 'ready' || state.nextOffset === null || loadingMore) return;
    const offset = state.nextOffset;
    setLoadingMore(true); setActionError(null);
    try {
      const page = await listMarketplaceReviews(undefined, offset);
      setState((current) => current.kind === 'ready' && current.nextOffset === offset ? {
        kind: 'ready', reviews: [...current.reviews, ...page.items], nextOffset: page.nextOffset,
      } : current);
    } catch { setActionError('More reviews could not be loaded. Existing results are unchanged.'); }
    finally { setLoadingMore(false); }
  };

  const moderate = async (
    review: MarketplaceReview,
    moderationState: 'published' | 'hidden',
    reason: string,
  ) => {
    if (working) return;
    setWorking(review.reviewId);
    setActionError(null);
    try {
      const updated = await moderateMarketplaceReview(review.reviewId, moderationState, reason);
      setState((current) => current.kind === 'ready' ? {
        kind: 'ready',
        reviews: current.reviews.map((item) => item.reviewId === updated.reviewId ? updated : item),
        nextOffset: current.nextOffset,
      } : current);
    } catch {
      setActionError('The moderation decision did not complete. The previous review state is unchanged.');
    } finally {
      setWorking(null);
    }
  };

  return <ScreenFrame testID="marketplace-reviews-operations-screen">
    <View style={styles.heading}>
      <ThemedText type="eyebrow" themeColor="textSecondary">MARKETPLACE OPERATIONS</ThemedText>
      <ThemedText type="display">Verified review moderation</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">
        Decisions require a recorded reason and a server-verified moderation capability.
      </ThemedText>
    </View>
    {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading verified reviews"
      padding="roomy" style={styles.card}><ActivityIndicator color={theme.tint} />
      <ThemedText type="headline">Loading reviews…</ThemedText></GlideSurface> : null}
    {state.kind === 'forbidden' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy"
      style={styles.card}><ThemedText type="title2">This account cannot moderate reviews.</ThemedText>
    </GlideSurface> : null}
    {state.kind === 'error' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy"
      style={styles.card} variant="tinted"><ThemedText type="title2">Reviews could not be loaded.</ThemedText>
      <GlideButton label="Try again" onPress={() => {
        setState({ kind: 'loading' }); setRetry((value) => value + 1);
      }} variant="secondary" /></GlideSurface> : null}
    {state.kind === 'ready' && state.reviews.length === 0 ? <GlideSurface padding="roomy" style={styles.card}>
      <ThemedText type="title2">No verified reviews yet.</ThemedText></GlideSurface> : null}
    {state.kind === 'ready' ? state.reviews.map((review) => <ReviewCard
      key={review.reviewId}
      onModerate={(moderationState, reason) => void moderate(review, moderationState, reason)}
      review={review}
      working={working === review.reviewId}
    />) : null}
    {state.kind === 'ready' && state.nextOffset !== null ? <GlideButton
      disabled={loadingMore}
      label={loadingMore ? 'Loading…' : 'Load more reviews'}
      onPress={() => void loadMore()}
      variant="secondary" /> : null}
    {actionError ? <GlideSurface accessible accessibilityRole="alert" padding="regular" style={styles.card}
      variant="tinted"><ThemedText type="body">{actionError}</ThemedText></GlideSurface> : null}
  </ScreenFrame>;
}

function ReviewCard({ review, working, onModerate }: {
  review: MarketplaceReview;
  working: boolean;
  onModerate: (state: 'published' | 'hidden', reason: string) => void;
}) {
  const theme = useTheme();
  const [reason, setReason] = useState('');
  const reasonValid = reason.trim().length >= 8;
  const nextState = review.moderationState === 'published' ? 'hidden' : 'published';
  return <GlideSurface padding="roomy" style={styles.card}>
    <ThemedText type="title2">{review.rating} / 5 · {review.moderationState}</ThemedText>
    <ThemedText type="body" selectable>{review.body ?? 'No written review.'}</ThemedText>
    {review.moderationReason ? <ThemedText type="footnote" themeColor="textSecondary">
      Last moderation reason: {review.moderationReason}
    </ThemedText> : null}
    <TextInput
      accessibilityLabel={`Moderation reason for ${review.reviewId}`}
      maxLength={1000}
      multiline
      onChangeText={setReason}
      placeholder="Record a clear reason (required)"
      placeholderTextColor={theme.textTertiary}
      style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
      value={reason}
    />
    <GlideButton
      disabled={working || !reasonValid}
      label={working ? 'Saving decision…' : nextState === 'hidden' ? 'Hide review' : 'Publish review'}
      onPress={() => onModerate(nextState, reason.trim())}
      variant="secondary"
    />
  </GlideSurface>;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two, width: '100%' },
  heading: { gap: Spacing.two, width: '100%' },
  input: {
    borderRadius: Radii.medium,
    borderWidth: 1,
    fontFamily: Fonts.sans,
    fontSize: 16,
    minHeight: 96,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twoHalf,
    textAlignVertical: 'top',
  },
});
