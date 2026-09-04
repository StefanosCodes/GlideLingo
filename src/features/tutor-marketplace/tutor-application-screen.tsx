import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  createTutorApplication,
  getOwnTutorApplication,
  isTutorApplicationDraftValid,
  submitTutorApplication,
  type TutorApplication,
  TutorMarketplaceClientError,
} from '@/features/tutor-marketplace/api';
import { isHumanTutorMarketplaceEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'form' }
  | { kind: 'application'; application: TutorApplication }
  | { kind: 'forbidden' }
  | { kind: 'error' };

type DraftForm = {
  headline: string;
  biography: string;
  timeZone: string;
  languages: string;
  specialties: string;
};

const initialForm: DraftForm = {
  headline: '',
  biography: '',
  timeZone: resolveTimeZone(),
  languages: '',
  specialties: '',
};

export function TutorApplicationScreen() {
  const enabled = isHumanTutorMarketplaceEnabled();
  const theme = useTheme();
  const requestSequence = useRef(0);
  const [retryCount, setRetryCount] = useState(0);
  const [screenState, setScreenState] = useState<ScreenState>(enabled ? { kind: 'loading' } : { kind: 'error' });
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<{ message: string; reload: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const sequence = ++requestSequence.current;

    void getOwnTutorApplication(controller.signal)
      .then((application) => {
        if (!controller.signal.aborted && requestSequence.current === sequence) {
          setScreenState({ kind: 'application', application });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestSequence.current !== sequence) return;
        if (error instanceof ApiClientError && error.kind === 'cancelled') return;
        if (error instanceof TutorMarketplaceClientError && error.kind === 'not-found') {
          setScreenState({ kind: 'form' });
          return;
        }
        if (error instanceof TutorMarketplaceClientError && error.kind === 'forbidden') {
          setScreenState({ kind: 'forbidden' });
          return;
        }
        setScreenState({ kind: 'error' });
      });

    return () => {
      controller.abort();
      if (requestSequence.current === sequence) requestSequence.current += 1;
    };
  }, [enabled, retryCount]);

  const normalizedDraft = useMemo(
    () => ({
      headline: form.headline.trim(),
      biography: form.biography.trim(),
      timeZone: form.timeZone.trim(),
      languages: splitList(form.languages).map((language) => language.toLowerCase()),
      specialties: splitList(form.specialties),
    }),
    [form],
  );
  const canCreate = isTutorApplicationDraftValid(normalizedDraft) && !saving;

  if (!enabled) {
    return (
      <ScreenFrame testID="tutor-marketplace-disabled">
        <FeatureUnavailable />
      </ScreenFrame>
    );
  }

  const saveDraft = async () => {
    if (!canCreate) return;
    setSaving(true);
    setActionError(null);
    try {
      const application = await createTutorApplication(normalizedDraft);
      setScreenState({ kind: 'application', application });
    } catch (error) {
      setActionError(actionErrorPresentation(error));
    } finally {
      setSaving(false);
    }
  };

  const submitDraft = async (application: TutorApplication) => {
    if (saving || application.status !== 'draft') return;
    setSaving(true);
    setActionError(null);
    try {
      const submitted = await submitTutorApplication(application.version);
      setScreenState({ kind: 'application', application: submitted });
    } catch (error) {
      setActionError(actionErrorPresentation(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenFrame testID="tutor-application-screen">
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          HUMAN TUTOR MARKETPLACE
        </ThemedText>
        <ThemedText type="display">Teach with GlideLingo.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Tell us what you teach and how you help. Applications are reviewed before any tutor profile becomes visible.
        </ThemedText>
      </View>

      {screenState.kind === 'loading' ? (
        <GlideSurface accessible accessibilityLabel="Loading tutor application" padding="roomy" style={styles.card}>
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.tint} />
            <ThemedText type="headline">Loading your application…</ThemedText>
          </View>
        </GlideSurface>
      ) : null}

      {screenState.kind === 'form' ? (
        <GlideSurface padding="roomy" style={styles.card}>
          <ThemedText type="title2">Tutor application</ThemedText>
          <LabeledInput
            label="Profile headline"
            maxLength={80}
            onChangeText={(headline) => setForm((current) => ({ ...current, headline }))}
            placeholder="Patient conversation tutor"
            value={form.headline}
          />
          <LabeledInput
            label="About your teaching"
            maxLength={1000}
            multiline
            onChangeText={(biography) => setForm((current) => ({ ...current, biography }))}
            placeholder="Describe who you help, your approach, and relevant experience."
            value={form.biography}
          />
          <LabeledInput
            autoCapitalize="none"
            label="Time zone"
            maxLength={64}
            onChangeText={(timeZone) => setForm((current) => ({ ...current, timeZone }))}
            placeholder="America/Chicago"
            supportingText="Use an IANA time zone such as America/Chicago or Europe/Athens."
            value={form.timeZone}
          />
          <LabeledInput
            autoCapitalize="none"
            label="Languages you teach"
            maxLength={256}
            onChangeText={(languages) => setForm((current) => ({ ...current, languages }))}
            placeholder="el, en"
            supportingText="Use language codes separated by commas."
            value={form.languages}
          />
          <LabeledInput
            label="Specialties"
            maxLength={512}
            onChangeText={(specialties) => setForm((current) => ({ ...current, specialties }))}
            placeholder="Conversation, pronunciation"
            supportingText="Separate each specialty with a comma."
            value={form.specialties}
          />
          <GlideButton
            disabled={!canCreate}
            fullWidth
            label={saving ? 'Saving…' : 'Save application'}
            onPress={() => void saveDraft()}
            testID="save-tutor-application"
          />
          {!canCreate && !saving ? (
            <ThemedText type="footnote" themeColor="textTertiary">
              Add a headline, at least 20 characters about your teaching, a valid IANA time zone, language codes such as
              el or en, and specialties of at least two characters.
            </ThemedText>
          ) : null}
        </GlideSurface>
      ) : null}

      {screenState.kind === 'application' ? (
        <ApplicationSummary
          application={screenState.application}
          onSubmit={() => void submitDraft(screenState.application)}
          saving={saving}
        />
      ) : null}

      {screenState.kind === 'forbidden' ? (
        <GlideSurface accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted">
          <ThemedText type="title2">Applications are invitation-only right now.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary">
            This account is not in the private launch group. Nothing was submitted.
          </ThemedText>
        </GlideSurface>
      ) : null}

      {screenState.kind === 'error' ? (
        <GlideSurface accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted">
          <ThemedText type="title2">We could not load the marketplace.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary">
            Check your connection and try again. Your application has not been changed.
          </ThemedText>
          <GlideButton
            label="Try again"
            onPress={() => {
              setScreenState({ kind: 'loading' });
              setRetryCount((current) => current + 1);
            }}
            variant="secondary"
          />
        </GlideSurface>
      ) : null}

      {actionError ? (
        <View style={styles.actionError}>
          <ThemedText accessibilityRole="alert" type="footnote" style={{ color: theme.danger }}>
            {actionError.message}
          </ThemedText>
          {actionError.reload ? (
            <GlideButton
              label="Reload application"
              onPress={() => {
                setActionError(null);
                setScreenState({ kind: 'loading' });
                setRetryCount((current) => current + 1);
              }}
              variant="secondary"
            />
          ) : null}
        </View>
      ) : null}
    </ScreenFrame>
  );
}

function LabeledInput({
  label,
  supportingText,
  multiline = false,
  ...props
}: ComponentProps<typeof TextInput> & { label: string; supportingText?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="headline">{label}</ThemedText>
      {supportingText ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {supportingText}
        </ThemedText>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        editable
        multiline={multiline}
        placeholderTextColor={theme.textTertiary}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text },
        ]}
        {...props}
      />
    </View>
  );
}

function ApplicationSummary({
  application,
  onSubmit,
  saving,
}: {
  application: TutorApplication;
  onSubmit: () => void;
  saving: boolean;
}) {
  const isDraft = application.status === 'draft';
  const presentation = statusPresentation(application.status);
  return (
    <GlideSurface padding="roomy" style={styles.card} variant={application.status === 'approved' ? 'success' : 'card'}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        {presentation.label}
      </ThemedText>
      <ThemedText type="title2">{application.headline}</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">
        {presentation.body}
      </ThemedText>
      <View style={styles.summaryBlock}>
        <ThemedText type="footnote" themeColor="textSecondary">
          About your teaching
        </ThemedText>
        <ThemedText type="body">{application.biography}</ThemedText>
      </View>
      <View style={styles.summaryBlock}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Time zone
        </ThemedText>
        <ThemedText type="body">{application.timeZone}</ThemedText>
      </View>
      <View style={styles.summaryBlock}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Languages
        </ThemedText>
        <ThemedText type="body">{application.languages.join(', ')}</ThemedText>
      </View>
      <View style={styles.summaryBlock}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Specialties
        </ThemedText>
        <ThemedText type="body">{application.specialties.join(', ')}</ThemedText>
      </View>
      {application.decisionReason ? (
        <ThemedText accessibilityRole="alert" type="footnote" themeColor="textSecondary">
          Review note: {application.decisionReason}
        </ThemedText>
      ) : null}
      {isDraft ? (
        <>
          <GlideButton
            disabled={saving}
            fullWidth
            label={saving ? 'Submitting…' : 'Submit for review'}
            onPress={onSubmit}
            testID="submit-tutor-application"
          />
          <ThemedText type="footnote" themeColor="textTertiary">
            This first MVP does not support editing after submission. Review these details before submitting.
          </ThemedText>
        </>
      ) : null}
    </GlideSurface>
  );
}

function FeatureUnavailable() {
  return (
    <GlideSurface padding="roomy" style={styles.card} variant="tinted">
      <ThemedText type="eyebrow" themeColor="textSecondary">
        HUMAN TUTOR MARKETPLACE
      </ThemedText>
      <ThemedText type="title2">Tutor applications are not open yet.</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">
        The marketplace is being prepared for a private launch. No application request was sent.
      </ThemedText>
    </GlideSurface>
  );
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item, index, items) => item.length > 0 && items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function actionErrorPresentation(error: unknown): { message: string; reload: boolean } {
  if (error instanceof TutorMarketplaceClientError && error.kind === 'conflict') {
    return {
      message: 'Your application changed in another session. Reload before trying again.',
      reload: true,
    };
  }
  if (error instanceof TutorMarketplaceClientError && error.kind === 'forbidden') {
    return {
      message: 'This account is not currently allowed to submit a tutor application.',
      reload: false,
    };
  }
  if (error instanceof TutorMarketplaceClientError && error.kind === 'validation') {
    return {
      message: 'Check each field and fix the highlighted requirements before trying again.',
      reload: false,
    };
  }
  return {
    message: 'We could not save that change. Check your connection and try again.',
    reload: false,
  };
}

function statusPresentation(status: TutorApplication['status']): { label: string; body: string } {
  switch (status) {
    case 'draft':
      return { label: 'DRAFT SAVED', body: 'Your private draft is ready to submit for review.' };
    case 'submitted':
      return { label: 'SUBMITTED', body: 'Your application is waiting for a marketplace reviewer.' };
    case 'under_review':
      return { label: 'UNDER REVIEW', body: 'A marketplace reviewer is checking your application.' };
    case 'approved':
      return { label: 'APPROVED', body: 'Your application was approved. Your profile remains private until publishing is available.' };
    case 'rejected':
      return { label: 'NOT APPROVED', body: 'The review is complete. See the review note below.' };
    case 'suspended':
      return { label: 'SUSPENDED', body: 'This tutor application is temporarily unavailable.' };
  }
}

const styles = StyleSheet.create({
  actionError: { alignItems: 'flex-start', gap: Spacing.two },
  card: { gap: Spacing.three, width: '100%' },
  field: { gap: Spacing.one },
  input: {
    borderRadius: Radii.medium,
    borderWidth: 1,
    fontFamily: Fonts.sans,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twoHalf,
  },
  intro: { gap: Spacing.two },
  introCopy: { maxWidth: 580 },
  loadingRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.twoHalf },
  multilineInput: { minHeight: 136, textAlignVertical: 'top' },
  summaryBlock: { gap: Spacing.one },
});
