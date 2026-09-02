import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { Radii, Spacing } from '@/constants/theme';
import {
  bindReferralAttribution,
  classifyReferralBindFailure,
  type ReferralBindStatus,
} from '@/features/affiliates/referral-client';
import {
  affiliateReferralsEnabled,
  captureCurrentReferralHandoff,
  clearReferralHandoff,
  discardCurrentReferralHandoff,
  type ReferralSessionState,
} from '@/features/affiliates/referral-session';
import { referralPresentation } from '@/features/affiliates/referral-presentation';
import { useTheme } from '@/hooks/use-theme';

type ScreenState =
  | 'disabled'
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'waiting-auth'
  | 'loading'
  | 'bound'
  | 'no-attribution'
  | 'authentication'
  | 'retryable'
  | 'unavailable';

export function ReferralHandoffScreen() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const [session] = useState<ReferralSessionState>(() => {
    if (affiliateReferralsEnabled()) return captureCurrentReferralHandoff();
    discardCurrentReferralHandoff();
    return { status: 'missing' };
  });
  const [attempt, setAttempt] = useState(0);
  const [screenState, setScreenState] = useState<ScreenState>(() =>
    affiliateReferralsEnabled()
      ? session.status === 'ready' ? 'loading' : session.status
      : 'disabled',
  );

  useEffect(() => {
    if (!affiliateReferralsEnabled() || session.status !== 'ready') return;
    if (!isLoaded || !isSignedIn || !userId) return;

    let active = true;
    const controller = new AbortController();
    void bindReferralAttribution(session.handoffToken, controller.signal).then(
      ({ status }) => {
        if (!active) return;
        clearReferralHandoff();
        setScreenState(bindStatusToScreenState(status));
      },
      (error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setScreenState(classifyReferralBindFailure(error));
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, isLoaded, isSignedIn, session, userId]);

  const continueNormally = () => {
    clearReferralHandoff();
    router.replace(isSignedIn ? '/subscription' : '/sign-in');
  };
  const visibleState = screenState === 'loading' && isLoaded && !isSignedIn
    ? 'waiting-auth'
    : screenState;

  return (
    <ScrollView
      contentContainerStyle={[styles.screen, { backgroundColor: theme.background }]}
      contentInsetAdjustmentBehavior="automatic"
      testID="referral-handoff-screen">
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ThemedText type="eyebrow" themeColor="textSecondary">REFERRAL HANDOFF</ThemedText>
        <ReferralStateContent
          onContinue={continueNormally}
          onRetry={() => {
            setScreenState('loading');
            setAttempt((value) => value + 1);
          }}
          onSignIn={() => router.push('/sign-in')}
          state={visibleState}
        />
      </View>
    </ScrollView>
  );
}

function ReferralStateContent({
  onContinue,
  onRetry,
  onSignIn,
  state,
}: {
  onContinue: () => void;
  onRetry: () => void;
  onSignIn: () => void;
  state: ScreenState;
}) {
  if (state === 'loading') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.content}>
        <ActivityIndicator accessibilityLabel="Preparing referral handoff" />
        <ThemedText type="title2">Preparing your referral…</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.copy}>
          GlideLingo is securely checking this session.
        </ThemedText>
      </View>
    );
  }

  const presentation = referralPresentation(state);
  const action = state === 'waiting-auth'
    ? { label: 'Continue to sign in', onPress: onSignIn }
    : state === 'retryable'
      ? { label: 'Try referral again', onPress: onRetry }
      : { label: presentation.continueLabel, onPress: onContinue };

  return (
    <View accessibilityLiveRegion={presentation.alert ? 'assertive' : 'polite'} style={styles.content}>
      <ThemedText accessibilityRole={presentation.alert ? 'alert' : undefined} type="title2">
        {presentation.title}
      </ThemedText>
      <ThemedText type="body" themeColor="textSecondary" style={styles.copy}>
        {presentation.body}
      </ThemedText>
      <GlideButton label={action.label} onPress={action.onPress} testID="referral-primary-action" />
      {state === 'retryable' ? (
        <GlideButton label="Continue without referral" onPress={onContinue} variant="secondary" />
      ) : null}
    </View>
  );
}

function bindStatusToScreenState(status: ReferralBindStatus): ScreenState {
  return status === 'bound' ? 'bound' : 'no-attribution';
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', borderRadius: Radii.large, borderWidth: 1, gap: Spacing.three, maxWidth: 620, padding: Spacing.five, width: '100%' },
  content: { alignItems: 'center', gap: Spacing.three, width: '100%' },
  copy: { maxWidth: 500, textAlign: 'center' },
  screen: { alignItems: 'center', flexGrow: 1, justifyContent: 'center', padding: Spacing.threeHalf },
});
