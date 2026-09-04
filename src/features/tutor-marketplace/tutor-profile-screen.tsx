import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  getOwnTutorProfile,
  saveTutorCredential,
  saveTutorOffering,
  setTutorPublication,
  type TutorProfile,
  TutorMarketplaceClientError,
  updateTutorProfileDraft,
} from '@/features/tutor-marketplace/api';
import { isHumanTutorMarketplaceEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type LoadState = { kind: 'loading' } | { kind: 'ready'; profile: TutorProfile } | { kind: 'error' };

export function TutorProfileScreen() {
  const enabled = isHumanTutorMarketplaceEnabled();
  const theme = useTheme();
  const requestSequence = useRef(0);
  const [retryCount, setRetryCount] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>(enabled ? { kind: 'loading' } : { kind: 'error' });
  const [working, setWorking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    void getOwnTutorProfile(controller.signal)
      .then((profile) => {
        if (!controller.signal.aborted && requestSequence.current === sequence) {
          setLoadState({ kind: 'ready', profile });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestSequence.current !== sequence) return;
        if (error instanceof ApiClientError && error.kind === 'cancelled') return;
        setLoadState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [enabled, retryCount]);

  if (!enabled) {
    return (
      <ScreenFrame testID="tutor-profile-disabled">
        <Unavailable />
      </ScreenFrame>
    );
  }

  const run = async (name: string, operation: () => Promise<TutorProfile>) => {
    if (working) return;
    setWorking(name);
    setActionError(null);
    try {
      setLoadState({ kind: 'ready', profile: await operation() });
    } catch (error) {
      setActionError(
        error instanceof TutorMarketplaceClientError && error.kind === 'conflict'
          ? 'This tutor profile changed in another session. Reload before trying again.'
          : 'We could not save that change. Your previous version is still safe.',
      );
    } finally {
      setWorking(null);
    }
  };

  return (
    <ScreenFrame testID="tutor-profile-screen">
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">TUTOR WORKSPACE</ThemedText>
        <ThemedText type="display">Prepare your tutor profile.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary">
          Your profile and lesson stay private until every publishing requirement is complete.
        </ThemedText>
      </View>

      {loadState.kind === 'loading' ? (
        <GlideSurface accessible accessibilityLabel="Loading tutor profile" padding="roomy" style={styles.card}>
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.tint} />
            <ThemedText type="headline">Loading your tutor workspace…</ThemedText>
          </View>
        </GlideSurface>
      ) : null}

      {loadState.kind === 'error' ? (
        <GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted">
          <ThemedText type="title2">We could not load your tutor workspace.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary">
            Only approved tutors can prepare a profile. Check your connection or application status and try again.
          </ThemedText>
          <GlideButton label="Try again" onPress={() => {
            setLoadState({ kind: 'loading' });
            setRetryCount((value) => value + 1);
          }} variant="secondary" />
        </GlideSurface>
      ) : null}

      {loadState.kind === 'ready' ? (
        <>
          <ProfileEditor profile={loadState.profile} saving={working === 'profile'} onSave={(input) =>
            void run('profile', () => updateTutorProfileDraft(input, loadState.profile.version))
          } />
          <CredentialEditor profile={loadState.profile} saving={working === 'credential'} onSave={(input) =>
            void run('credential', () => saveTutorCredential(input, loadState.profile.credential?.version ?? 0))
          } />
          <OfferingEditor profile={loadState.profile} saving={working === 'offering'} onSave={(input) =>
            void run('offering', () => saveTutorOffering(input, loadState.profile.offering?.version ?? 0))
          } />
          <PublicationControl profile={loadState.profile} saving={working === 'publication'} onChange={(publish) =>
            void run('publication', () => setTutorPublication(loadState.profile, publish))
          } />
        </>
      ) : null}

      {actionError ? (
        <GlideSurface accessible accessibilityRole="alert" padding="regular" style={styles.card} variant="tinted">
          <ThemedText type="body">{actionError}</ThemedText>
          <GlideButton label="Reload workspace" onPress={() => {
            setActionError(null);
            setLoadState({ kind: 'loading' });
            setRetryCount((value) => value + 1);
          }} variant="secondary" />
        </GlideSurface>
      ) : null}
    </ScreenFrame>
  );
}

function ProfileEditor({ profile, saving, onSave }: {
  profile: TutorProfile;
  saving: boolean;
  onSave: (input: Pick<TutorProfile, 'headline' | 'biography' | 'timeZone'>) => void;
}) {
  const [headline, setHeadline] = useState(profile.headline);
  const [biography, setBiography] = useState(profile.biography);
  const [timeZone, setTimeZone] = useState(profile.timeZone);
  const locked = profile.applicationStatus !== 'approved' || profile.isPublished;
  const valid = headline.trim().length >= 3 && biography.trim().length >= 20 && timeZone.trim().length > 0;
  return (
    <GlideSurface padding="roomy" style={styles.card}>
      <ThemedText type="title2">Private profile draft</ThemedText>
      <LabeledInput editable={!locked} label="Tutor headline" maxLength={80} onChangeText={setHeadline} value={headline} />
      <LabeledInput editable={!locked} label="Tutor biography" maxLength={1000} multiline onChangeText={setBiography} value={biography} />
      <LabeledInput autoCapitalize="none" editable={!locked} label="Tutor time zone" maxLength={64} onChangeText={setTimeZone} value={timeZone} />
      <GlideButton disabled={locked || !valid || saving} label={saving ? 'Saving profile…' : 'Save profile draft'} onPress={() => onSave({
        headline: headline.trim(), biography: biography.trim(), timeZone: timeZone.trim(),
      })} testID="save-tutor-profile" />
    </GlideSurface>
  );
}

function CredentialEditor({ profile, saving, onSave }: {
  profile: TutorProfile;
  saving: boolean;
  onSave: (input: { credentialType: 'certificate'; title: string; issuer: string }) => void;
}) {
  const [title, setTitle] = useState(profile.credential?.title ?? '');
  const [issuer, setIssuer] = useState(profile.credential?.issuer ?? '');
  const locked = profile.applicationStatus !== 'approved' || profile.isPublished ||
    (profile.credential?.verificationStatus !== undefined && profile.credential.verificationStatus !== 'unverified');
  return (
    <GlideSurface padding="roomy" style={styles.card}>
      <ThemedText type="title2">Optional credential</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">
        Credentials are shown as verified only after an authorized reviewer confirms them.
      </ThemedText>
      <LabeledInput editable={!locked} label="Credential title" maxLength={100} onChangeText={setTitle} value={title} />
      <LabeledInput editable={!locked} label="Credential issuer" maxLength={100} onChangeText={setIssuer} value={issuer} />
      <GlideButton disabled={locked || saving || title.trim().length < 3 || issuer.trim().length < 2}
        label={saving ? 'Saving credential…' : 'Save credential'} onPress={() => onSave({
          credentialType: 'certificate', title: title.trim(), issuer: issuer.trim(),
        })} testID="save-tutor-credential" />
      {profile.credential ? <ThemedText type="footnote" themeColor="textSecondary">
        Status: {profile.credential.verificationStatus}
      </ThemedText> : null}
    </GlideSurface>
  );
}

function OfferingEditor({ profile, saving, onSave }: {
  profile: TutorProfile;
  saving: boolean;
  onSave: (input: { title: string; durationMinutes: 25; amountMinor: number; currency: 'USD' }) => void;
}) {
  const [title, setTitle] = useState(profile.offering?.title ?? '25-minute conversation lesson');
  const [price, setPrice] = useState(profile.offering ? String(profile.offering.amountMinor / 100) : '25');
  const amountMinor = Math.round(Number(price) * 100);
  const locked = profile.applicationStatus !== 'approved' || profile.isPublished;
  const valid = title.trim().length >= 3 && Number.isInteger(amountMinor) && amountMinor >= 500 && amountMinor <= 50_000;
  return (
    <GlideSurface padding="roomy" style={styles.card}>
      <ThemedText type="title2">Lesson offering draft</ThemedText>
      <LabeledInput editable={!locked} label="Lesson title" maxLength={100} onChangeText={setTitle} value={title} />
      <LabeledInput accessibilityHint="Enter a price from 5 to 500 US dollars" editable={!locked} keyboardType="decimal-pad"
        label="Price in USD" maxLength={7} onChangeText={setPrice} value={price} />
      <ThemedText type="footnote" themeColor="textSecondary">
        25 minutes · 20% marketplace commission · free cancellation until 12 hours before start
      </ThemedText>
      <GlideButton disabled={locked || !valid || saving} label={saving ? 'Saving offering…' : 'Save offering draft'}
        onPress={() => onSave({ title: title.trim(), durationMinutes: 25, amountMinor, currency: 'USD' })}
        testID="save-tutor-offering" />
    </GlideSurface>
  );
}

function PublicationControl({ profile, saving, onChange }: {
  profile: TutorProfile;
  saving: boolean;
  onChange: (publish: boolean) => void;
}) {
  const canPublish = profile.publicationBlockers.length === 0 && profile.offering !== null;
  return (
    <GlideSurface padding="roomy" style={styles.card} variant={profile.isPublished ? 'success' : 'tinted'}>
      <ThemedText type="title2">Publication</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">
        {profile.isPublished
          ? 'Your profile is published. Unpublishing also returns the offering to draft.'
          : profile.applicationStatus === 'suspended'
            ? 'This tutor workspace is suspended and remains private. An authorized operator must reinstate it before editing or publishing.'
          : profile.publicationBlockers.includes('payout_not_ready')
            ? 'Payout onboarding is not complete. You can prepare this workspace, but publishing and paid lessons remain locked.'
            : 'Complete the remaining profile requirements before publishing.'}
      </ThemedText>
      <GlideButton disabled={saving || (!profile.isPublished && !canPublish)}
        label={saving ? 'Saving publication…' : profile.isPublished ? 'Unpublish profile' : 'Publish profile'}
        onPress={() => onChange(!profile.isPublished)} testID="set-tutor-publication" />
    </GlideSurface>
  );
}

function LabeledInput({ label, multiline = false, ...props }: ComponentProps<typeof TextInput> & { label: string }) {
  const theme = useTheme();
  return <View style={styles.field}>
    <ThemedText type="headline">{label}</ThemedText>
    <TextInput accessibilityLabel={label} multiline={multiline} placeholderTextColor={theme.textTertiary}
      style={[styles.input, multiline && styles.multilineInput, {
        backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text,
      }]} {...props} />
  </View>;
}

function Unavailable() {
  return <GlideSurface padding="roomy" style={styles.card} variant="tinted">
    <ThemedText type="title2">Tutor profiles are not available yet.</ThemedText>
    <ThemedText type="body" themeColor="textSecondary">No marketplace request was sent.</ThemedText>
  </GlideSurface>;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.three, width: '100%' },
  field: { gap: Spacing.one },
  input: { borderRadius: Radii.medium, borderWidth: 1, fontFamily: Fonts.sans, fontSize: 16,
    minHeight: 48, paddingHorizontal: Spacing.three, paddingVertical: Spacing.twoHalf },
  intro: { gap: Spacing.two },
  loadingRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.twoHalf },
  multilineInput: { minHeight: 136, textAlignVertical: 'top' },
});
