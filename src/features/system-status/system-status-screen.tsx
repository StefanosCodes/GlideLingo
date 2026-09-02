import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing, type ThemeColor } from '@/constants/theme';
import {
  AuthSessionProofError,
  getAuthSessionProof,
  getSystemStatus,
  getSystemStatusRuntimeDetails,
  SystemStatusError,
} from '@/features/system-status/api';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/providers/clerk-runtime';

type ViewState =
  | { kind: 'checking' }
  | { kind: 'ready'; requestId: string | null; status: number }
  | { kind: 'not-ready'; requestId: string | null; status: number | null }
  | { kind: 'unreachable'; requestId: string | null; status: number | null }
  | { kind: 'configuration' };

type StatusPresentation = {
  body: string;
  color: ThemeColor;
  title: string;
};

type AuthProofViewState =
  | { kind: 'checking' }
  | { kind: 'verified'; requestId: string | null; status: number }
  | { kind: 'mismatch'; requestId: string | null; status: number }
  | { kind: 'unauthorized'; requestId: string | null; status: number | null }
  | { kind: 'unavailable'; requestId: string | null; status: number | null };

export function SystemStatusScreen() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const runtime = useMemo(() => getSystemStatusRuntimeDetails(), []);
  const requestSequence = useRef(0);
  const [retryCount, setRetryCount] = useState(0);
  const [viewState, setViewState] = useState<ViewState>({ kind: 'checking' });
  const [authProofState, setAuthProofState] = useState<AuthProofViewState>({ kind: 'checking' });

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++requestSequence.current;

    void getSystemStatus(controller.signal)
      .then((result) => {
        if (controller.signal.aborted || requestSequence.current !== sequence) return;
        setViewState({ kind: 'ready', requestId: result.requestId, status: result.status });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestSequence.current !== sequence) return;

        if (!(error instanceof SystemStatusError)) {
          setViewState({ kind: 'unreachable', requestId: null, status: null });
          return;
        }
        if (error.kind === 'cancelled') return;
        if (error.kind === 'configuration') {
          setViewState({ kind: 'configuration' });
          return;
        }
        if (error.kind === 'not-ready') {
          setViewState({ kind: 'not-ready', requestId: error.requestId, status: error.status });
          return;
        }
        setViewState({ kind: 'unreachable', requestId: error.requestId, status: error.status });
      });

    return () => {
      controller.abort();
      if (requestSequence.current === sequence) requestSequence.current += 1;
    };
  }, [retryCount]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !userId) return;

    const controller = new AbortController();

    void getAuthSessionProof(userId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setAuthProofState({
          kind: result.matchesCurrentUser ? 'verified' : 'mismatch',
          requestId: result.requestId,
          status: result.status,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof AuthSessionProofError && error.kind === 'cancelled') return;
        if (error instanceof AuthSessionProofError && error.kind === 'unauthorized') {
          setAuthProofState({
            kind: 'unauthorized',
            requestId: error.requestId,
            status: error.status,
          });
          return;
        }
        setAuthProofState({
          kind: 'unavailable',
          requestId: error instanceof AuthSessionProofError ? error.requestId : null,
          status: error instanceof AuthSessionProofError ? error.status : null,
        });
      });

    return () => controller.abort();
  }, [isLoaded, isSignedIn, retryCount, userId]);

  const presentation = getStatusPresentation(viewState);
  const requestId = 'requestId' in viewState ? viewState.requestId : null;
  const responseStatus = 'status' in viewState ? viewState.status : null;
  const isChecking = viewState.kind === 'checking';
  const displayedAuthProofState: AuthProofViewState =
    isLoaded && (!isSignedIn || !userId)
      ? { kind: 'unauthorized', requestId: null, status: null }
      : authProofState;
  const authPresentation = getAuthProofPresentation(displayedAuthProofState);
  const isAuthChecking = displayedAuthProofState.kind === 'checking';

  return (
    <ScreenFrame chrome={false} includeTabInset={false} contentStyle={styles.content} testID="system-status-screen">
      <Pressable
        accessibilityLabel="Back to Prompt Kit"
        accessibilityRole="button"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/kit'))}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Back to Prompt Kit
        </ThemedText>
      </Pressable>

      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          INTERNAL DIAGNOSTICS
        </ThemedText>
        <ThemedText type="display">System status</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Confirm that this client can reach the API and that PostgreSQL is ready before debugging product features.
        </ThemedText>
      </View>

      <GlideSurface
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${presentation.title}. ${presentation.body}`}
        padding="roomy"
        variant={viewState.kind === 'ready' ? 'success' : 'card'}
        style={styles.statusSurface}>
        <View style={styles.statusTitleRow}>
          {isChecking ? <ActivityIndicator accessibilityLabel="Checking system status" color={theme.tint} /> : null}
          <ThemedText type="title2" themeColor={presentation.color} style={styles.statusTitle}>
            {presentation.title}
          </ThemedText>
        </View>
        <ThemedText type="body" themeColor="textSecondary">
          {presentation.body}
        </ThemedText>
      </GlideSurface>

      <GlideSurface
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${authPresentation.title}. ${authPresentation.body}`}
        padding="roomy"
        variant={displayedAuthProofState.kind === 'verified' ? 'success' : 'card'}
        style={styles.statusSurface}>
        <View style={styles.statusTitleRow}>
          {isAuthChecking ? (
            <ActivityIndicator accessibilityLabel="Checking authenticated API session" color={theme.tint} />
          ) : null}
          <ThemedText type="title2" themeColor={authPresentation.color} style={styles.statusTitle}>
            {authPresentation.title}
          </ThemedText>
        </View>
        <ThemedText type="body" themeColor="textSecondary">
          {authPresentation.body}
        </ThemedText>
        {'requestId' in displayedAuthProofState && displayedAuthProofState.requestId ? (
          <ThemedText type="footnote" themeColor="textTertiary" selectable>
            Auth request ID: {displayedAuthProofState.requestId}
          </ThemedText>
        ) : null}
      </GlideSurface>

      <View style={styles.detailsSection}>
        <View style={styles.sectionCopy}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            CONNECTION
          </ThemedText>
          <ThemedText type="title2">Resolved runtime</ThemedText>
        </View>
        <GlideSurface padding="none" variant="grouped">
          <DetailRow label="API origin" value={runtime.origin ?? 'Not resolved'} />
          <DetailRow label="Platform" value={runtime.platform} last={responseStatus === null && !requestId} />
          {responseStatus !== null ? (
            <DetailRow label="HTTP status" value={String(responseStatus)} last={!requestId} />
          ) : null}
          {requestId ? <DetailRow label="Request ID" value={requestId} last /> : null}
        </GlideSurface>
      </View>

      <View style={styles.actions}>
        <GlideButton
          disabled={isChecking || isAuthChecking}
          fullWidth
          label={isChecking || isAuthChecking ? 'Checking…' : 'Retry diagnostics'}
          onPress={() => {
            setViewState({ kind: 'checking' });
            setAuthProofState({ kind: 'checking' });
            setRetryCount((current) => current + 1);
          }}
          testID="system-status-retry"
        />
        <ThemedText type="footnote" themeColor="textTertiary">
          This screen displays only connection and identity-match metadata. It never displays credentials, session
          tokens, user IDs, or raw backend exceptions.
        </ThemedText>
      </View>
    </ScreenFrame>
  );
}

function getAuthProofPresentation(state: AuthProofViewState): StatusPresentation {
  switch (state.kind) {
    case 'checking':
      return {
        body: 'Asking FastAPI to verify the current Clerk session and comparing its subject locally.',
        color: 'text',
        title: 'Checking authenticated session…',
      };
    case 'verified':
      return {
        body: 'FastAPI verified the bearer session and returned the same Clerk user as this client.',
        color: 'success',
        title: 'Authenticated session verified',
      };
    case 'mismatch':
      return {
        body: 'FastAPI verified a different Clerk subject. Sign out, sign back in, and retry before continuing.',
        color: 'danger',
        title: 'Identity mismatch',
      };
    case 'unauthorized':
      return {
        body: 'FastAPI did not accept the current Clerk session. Sign out, sign back in, and retry.',
        color: 'danger',
        title: 'Session not authorized',
      };
    case 'unavailable':
      return {
        body: 'The authenticated session proof did not return the expected response. Check API and Clerk configuration.',
        color: 'warning',
        title: 'Session proof unavailable',
      };
  }
}

function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.detailRow,
        !last && { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}>
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.detailLabel}>
        {label}
      </ThemedText>
      <ThemedText type="code" selectable style={styles.detailValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function getStatusPresentation(state: ViewState): StatusPresentation {
  switch (state.kind) {
    case 'checking':
      return {
        body: 'Contacting the API and running its database readiness check.',
        color: 'text',
        title: 'Checking…',
      };
    case 'ready':
      return {
        body: 'The API is reachable and PostgreSQL passed its readiness check.',
        color: 'success',
        title: 'Full stack ready',
      };
    case 'not-ready':
      return {
        body: 'The API responded, but its database dependency is not ready yet. Start PostgreSQL, then retry.',
        color: 'warning',
        title: 'Database not ready',
      };
    case 'configuration':
      return {
        body: 'Set EXPO_PUBLIC_API_BASE_URL to an absolute API URL. Production builds require HTTPS.',
        color: 'danger',
        title: 'Configuration invalid',
      };
    case 'unreachable':
      return {
        body:
          state.status === null
            ? 'The client could not reach the API. Check that it is running and reachable from this device.'
            : 'The API responded, but the readiness endpoint did not return the expected result.',
        color: 'danger',
        title: 'API unavailable',
      };
  }
}

const styles = StyleSheet.create({
  actions: { gap: Spacing.twoHalf },
  back: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44 },
  content: { gap: Spacing.five },
  detailLabel: { width: 96 },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    minHeight: 56,
    paddingVertical: Spacing.twoHalf,
  },
  detailsSection: { gap: Spacing.three },
  detailValue: { flex: 1, textAlign: 'right' },
  intro: { gap: Spacing.two },
  introCopy: { maxWidth: 560 },
  pressed: { opacity: 0.58 },
  sectionCopy: { gap: Spacing.one },
  statusSurface: { gap: Spacing.twoHalf },
  statusTitle: { flex: 1 },
  statusTitleRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.twoHalf },
});
