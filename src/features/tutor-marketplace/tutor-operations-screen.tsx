import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  changeTutorStatus,
  decideTutorCredential,
  decideTutorApplication,
  getTutorProfileForOperations,
  listTutorApplicationsForReview,
  startTutorApplicationReview,
  type TutorApplication,
  type TutorProfile,
  TutorMarketplaceClientError,
} from '@/features/tutor-marketplace/api';
import { isHumanTutorMarketplaceEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: TutorApplication[] }
  | { kind: 'forbidden' }
  | { kind: 'error' };

export function TutorOperationsScreen() {
  const enabled = isHumanTutorMarketplaceEnabled();
  const theme = useTheme();
  const sequence = useRef(0);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<LoadState>(enabled ? { kind: 'loading' } : { kind: 'error' });
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const request = ++sequence.current;
    void listTutorApplicationsForReview(controller.signal)
      .then((queue) => {
        if (!controller.signal.aborted && sequence.current === request) {
          setState({ kind: 'ready', items: queue.items });
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || sequence.current !== request) return;
        if (caught instanceof ApiClientError && caught.kind === 'cancelled') return;
        setState(
          caught instanceof TutorMarketplaceClientError && caught.kind === 'forbidden'
            ? { kind: 'forbidden' }
            : { kind: 'error' },
        );
      });
    return () => controller.abort();
  }, [enabled, reload]);

  if (!enabled) {
    return <ScreenFrame testID="tutor-operations-disabled"><Unavailable /></ScreenFrame>;
  }

  const mutate = async (application: TutorApplication, operation: () => Promise<TutorApplication>) => {
    if (workingId) return;
    setWorkingId(application.applicationId);
    setError(null);
    try {
      const updated = await operation();
      setState((current) => current.kind === 'ready' ? {
        kind: 'ready',
        items: current.items.map((item) => item.applicationId === updated.applicationId ? updated : item),
      } : current);
    } catch (caught) {
      setError(
        caught instanceof TutorMarketplaceClientError && caught.kind === 'conflict'
          ? 'This application changed. Reload the review queue before deciding.'
          : 'The operator action did not complete. No decision was assumed.',
      );
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <ScreenFrame testID="tutor-operations-screen">
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">MARKETPLACE OPERATIONS</ThemedText>
        <ThemedText type="display">Tutor review queue.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">
          This protected surface never grants operator access; the server checks the capability again for every action.
        </ThemedText>
      </View>
      {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading tutor review queue"
        padding="roomy" style={styles.card}><View style={styles.loadingRow}>
          <ActivityIndicator color={theme.tint} /><ThemedText type="headline">Loading review queue…</ThemedText>
        </View></GlideSurface> : null}
      {state.kind === 'forbidden' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card}
        variant="tinted"><ThemedText type="title2">Operator access required.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">This account does not have marketplace review capability.</ThemedText>
      </GlideSurface> : null}
      {state.kind === 'error' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card}
        variant="tinted"><ThemedText type="title2">The review queue is unavailable.</ThemedText>
        <GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setReload((value) => value + 1); }}
          variant="secondary" /></GlideSurface> : null}
      {state.kind === 'ready' && state.items.length === 0 ? <GlideSurface padding="roomy" style={styles.card}>
        <ThemedText type="title2">No tutor applications need review.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">New submissions will appear here.</ThemedText>
      </GlideSurface> : null}
      {state.kind === 'ready' ? state.items.map((application) => <ReviewCard application={application}
        key={application.applicationId} saving={workingId === application.applicationId}
        onAction={(operation) => void mutate(application, operation)} />) : null}
      {error ? <GlideSurface accessible accessibilityRole="alert" padding="regular" style={styles.card} variant="tinted">
        <ThemedText type="body">{error}</ThemedText><GlideButton label="Reload queue" onPress={() => {
          setError(null); setState({ kind: 'loading' }); setReload((value) => value + 1);
        }} variant="secondary" /></GlideSurface> : null}
    </ScreenFrame>
  );
}

function ReviewCard({ application, saving, onAction }: {
  application: TutorApplication;
  saving: boolean;
  onAction: (operation: () => Promise<TutorApplication>) => void;
}) {
  const theme = useTheme();
  const [reason, setReason] = useState('');
  const [profile, setProfile] = useState<TutorProfile | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [profileWorking, setProfileWorking] = useState(false);
  const reasonValid = reason.trim().length >= 8;
  return <GlideSurface padding="roomy" style={styles.card}>
    <ThemedText type="eyebrow" themeColor="textSecondary">{application.status.replace('_', ' ').toUpperCase()}</ThemedText>
    <ThemedText type="title2">{application.headline}</ThemedText>
    <ThemedText type="body" themeColor="textSecondary">{application.biography}</ThemedText>
    <ThemedText type="footnote">{application.languages.join(', ')} · {application.specialties.join(', ')}</ThemedText>
    {application.status === 'submitted' ? <GlideButton disabled={saving} label={saving ? 'Starting review…' : 'Start review'}
      onPress={() => onAction(() => startTutorApplicationReview(application))} testID={`start-review-${application.applicationId}`} /> : null}
    {application.status === 'under_review' || application.status === 'approved' || application.status === 'suspended' ? <>
      <TextInput accessibilityLabel={`Decision reason for ${application.headline}`} maxLength={500} multiline
        onChangeText={setReason} placeholder="Record a clear reason (required)" placeholderTextColor={theme.textTertiary}
        style={[styles.input, styles.reasonInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
        value={reason} />
      {application.status === 'under_review' ? <View style={styles.actions}>
        <GlideButton disabled={saving || !reasonValid} label="Approve" onPress={() => onAction(() =>
          decideTutorApplication(application, 'approved', reason.trim()))} />
        <GlideButton disabled={saving || !reasonValid} label="Reject" onPress={() => onAction(() =>
          decideTutorApplication(application, 'rejected', reason.trim()))} variant="secondary" />
      </View> : null}
      {application.status === 'approved' ? <GlideButton disabled={saving || !reasonValid} label="Suspend tutor"
        onPress={() => onAction(() => changeTutorStatus(application, 'suspend', reason.trim()))} variant="secondary" /> : null}
      {application.status === 'suspended' ? <GlideButton disabled={saving || !reasonValid} label="Reinstate tutor"
        onPress={() => onAction(() => changeTutorStatus(application, 'reinstate', reason.trim()))} /> : null}
      {application.status === 'approved' || application.status === 'suspended' ? <GlideButton
        disabled={profileWorking} label={profileWorking ? 'Loading workspace…' : profile ? 'Refresh tutor workspace' : 'Inspect tutor workspace'}
        onPress={() => {
          if (profileWorking) return;
          setProfileWorking(true);
          setProfileError(false);
          void getTutorProfileForOperations(application.applicationId).then(setProfile).catch(() => setProfileError(true))
            .finally(() => setProfileWorking(false));
        }} variant="secondary" /> : null}
      {profileError ? <ThemedText accessibilityRole="alert" type="footnote" style={{ color: theme.danger }}>
        The tutor workspace could not be loaded.
      </ThemedText> : null}
      {profile?.credential ? <GlideSurface padding="regular" style={styles.credential} variant="grouped">
        <ThemedText type="headline">{profile.credential.title}</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">{profile.credential.issuer} · {profile.credential.verificationStatus}</ThemedText>
        {profile.credential.verificationStatus === 'unverified' ? <View style={styles.actions}>
          <GlideButton disabled={!reasonValid || profileWorking} label="Verify credential" onPress={() => {
            if (!profile.credential) return;
            setProfileWorking(true);
            void decideTutorCredential(profile.credential, 'verified', reason.trim()).then(setProfile)
              .catch(() => setProfileError(true)).finally(() => setProfileWorking(false));
          }} />
          <GlideButton disabled={!reasonValid || profileWorking} label="Reject credential" onPress={() => {
            if (!profile.credential) return;
            setProfileWorking(true);
            void decideTutorCredential(profile.credential, 'rejected', reason.trim()).then(setProfile)
              .catch(() => setProfileError(true)).finally(() => setProfileWorking(false));
          }} variant="secondary" />
        </View> : null}
      </GlideSurface> : null}
    </> : null}
  </GlideSurface>;
}

function Unavailable() {
  return <GlideSurface padding="roomy" style={styles.card} variant="tinted">
    <ThemedText type="title2">Marketplace operations are not available.</ThemedText>
    <ThemedText type="body" themeColor="textSecondary">No operator request was sent.</ThemedText>
  </GlideSurface>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  card: { gap: Spacing.three, width: '100%' },
  credential: { gap: Spacing.two },
  input: { borderRadius: Radii.medium, borderWidth: 1, fontFamily: Fonts.sans, fontSize: 16,
    minHeight: 48, paddingHorizontal: Spacing.three, paddingVertical: Spacing.twoHalf },
  intro: { gap: Spacing.two },
  loadingRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.twoHalf },
  reasonInput: { minHeight: 96, textAlignVertical: 'top' },
});
