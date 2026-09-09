import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Radii, Spacing } from '@/constants/theme';
import {
  onboardingProgress,
  previousOnboardingStep,
  type OnboardingGoal,
  type OnboardingRhythm,
  weeklyPracticeGoalForRhythm,
} from '@/features/onboarding/onboarding-state';
import {
  type PronunciationStatus,
  usePronunciationPlayer,
} from '@/features/learning-session/audio/use-pronunciation-player';
import { useTheme } from '@/hooks/use-theme';
import { useBilling } from '@/providers/billing-provider';
import { useLearning } from '@/providers/learning-provider';
import { useOnboarding } from '@/providers/onboarding-provider';

const GOALS: { id: OnboardingGoal; label: string; detail: string; destination: string }[] = [
  {
    id: 'travel',
    label: 'Travel with more confidence',
    detail: 'Build toward cafés, directions, and travel exchanges.',
    destination: 'Handle a travel exchange',
  },
  {
    id: 'family',
    label: 'Speak with family or friends',
    detail: 'Build toward talking about yourself and familiar people.',
    destination: 'Talk about family',
  },
  {
    id: 'conversation',
    label: 'Handle everyday conversations',
    detail: 'Build toward introductions and simple exchanges.',
    destination: 'Introduce yourself',
  },
  {
    id: 'foundation',
    label: 'Build a strong foundation',
    detail: 'Begin with letters, sounds, and useful first words.',
    destination: 'Decode Greek letters',
  },
];

const RHYTHMS: { id: OnboardingRhythm; label: string; detail: string }[] = [
  { id: 'three', label: '3 days a week', detail: 'A calm, sustainable starting rhythm.' },
  { id: 'five', label: '5 days a week', detail: 'Frequent practice with room for a pause.' },
  { id: 'daily', label: 'Every day', detail: 'A daily intention, without punishment for a missed day.' },
  { id: 'flexible', label: "I'll decide as I go", detail: 'Keep the path ready without a weekly target.' },
];

const SAMPLE_CHOICES = ['α', 'ε', 'ι'] as const;
const FREE_PLAN_ID = 'free';

function proPlanName(interval: 'monthly' | 'annual' | 'other', fallback: string) {
  if (interval === 'monthly') return 'Pro · Monthly';
  if (interval === 'annual') return 'Pro · Annual';
  return fallback;
}

function purchaseFeedback(status: ReturnType<typeof useBilling>['purchaseState']['status']) {
  if (status === 'cancelled') return 'No changes were made. Choose a plan whenever you are ready.';
  if (status === 'declined') return 'That payment method was not accepted. Try another or continue with Free.';
  if (status === 'sync-unavailable') {
    return 'Checkout completed, but Pro access is still being confirmed. Refresh access before trying again.';
  }
  if (status === 'error') return 'We could not start Pro. Try again or continue with Free.';
  return null;
}

export function OnboardingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { state, storageError, setStep, selectGoal, selectRhythm, completeSample, completeOnboarding } =
    useOnboarding();
  const { setWeeklyPracticeGoal, startCourse } = useLearning();
  const billing = useBilling();
  const [sampleChoice, setSampleChoice] = useState<string | null>(null);
  const [sampleChecked, setSampleChecked] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completionPending, setCompletionPending] = useState(false);
  const pronunciation = usePronunciationPlayer();
  const audioState = pronunciation.stateFor('el-letter-alpha');
  const previousStep = previousOnboardingStep(state.step);
  const selectedPackage = billing.packages.find((item) => item.identifier === selectedPlanId) ?? null;
  const purchasePending = billing.purchaseState.status === 'loading' || billing.purchaseState.status === 'syncing';

  async function finishOnboarding(access: 'free' | 'pro') {
    setCompletionError(null);
    setCompletionPending(true);
    if (!startCourse('el-from-zero')) {
      setCompletionError('The Greek course could not be started. Please try again.');
      setCompletionPending(false);
      return;
    }
    if (state.rhythm) setWeeklyPracticeGoal(weeklyPracticeGoalForRhythm(state.rhythm));
    await completeOnboarding(access);
    router.replace('/');
  }

  async function continueWithSelectedPlan() {
    if (selectedPlanId === FREE_PLAN_ID) {
      await finishOnboarding('free');
      return;
    }
    if (!__DEV__ || !selectedPackage) return;

    const proConfirmed = await billing.purchase(selectedPackage.identifier);
    if (proConfirmed) await finishOnboarding('pro');
  }

  const sharedFrameProps = {
    onBack: previousStep ? () => setStep(previousStep) : undefined,
    progress: state.step === 'welcome' ? undefined : onboardingProgress(state.step),
    storageError,
  };

  if (state.step === 'welcome') {
    return (
      <OnboardingFrame
        {...sharedFrameProps}
        actions={<GlideButton fullWidth label="Build my path" onPress={() => setStep('goal')} testID="onboarding-start" />}>
        <View style={styles.welcomeMark}>
          <Image
            accessibilityIgnoresInvertColors
            contentFit="contain"
            source={require('@/assets/brand/glidelingo-bird.png')}
            style={styles.brandMark}
          />
          <ThemedText type="headline">GlideLingo</ThemedText>
        </View>
        <ScreenIntro
          eyebrow="MODERN GREEK · REAL-WORLD MISSIONS"
          title="Learn the Greek you'll actually use."
          copy="Short guided lessons take you from the alphabet to first conversations."
        />
        <GlideSurface padding="none" style={styles.previewList}>
          <PreviewRow detail="8 min" label="The sound of Greek" />
          <PreviewRow detail="next" label="Introduce yourself" />
          <PreviewRow detail="ahead" label="Order at a café" last />
        </GlideSurface>
      </OnboardingFrame>
    );
  }

  if (state.step === 'goal') {
    return (
      <OnboardingFrame
        {...sharedFrameProps}
        actions={
          <GlideButton
            disabled={!state.goal}
            fullWidth
            label="Continue"
            onPress={() => setStep('rhythm')}
            testID="onboarding-goal-continue"
          />
        }>
        <ScreenIntro
          eyebrow="YOUR DESTINATION"
          title="Where do you want Greek to take you?"
          copy="We'll keep the authored foundations intact and pin a milestone that matters to you."
        />
        <View style={styles.choiceList}>
          {GOALS.map((goal) => (
            <ChoiceRow
              key={goal.id}
              detail={goal.detail}
              label={goal.label}
              onPress={() => selectGoal(goal.id)}
              selected={state.goal === goal.id}
              testID={`onboarding-goal-${goal.id}`}
            />
          ))}
        </View>
      </OnboardingFrame>
    );
  }

  if (state.step === 'rhythm') {
    return (
      <OnboardingFrame
        {...sharedFrameProps}
        actions={
          <GlideButton
            disabled={!state.rhythm}
            fullWidth
            label="See my path"
            onPress={() => setStep('plan')}
            testID="onboarding-rhythm-continue"
          />
        }>
        <ScreenIntro
          eyebrow="YOUR RHYTHM"
          title="What feels realistic?"
          copy="Most lessons take 8–12 focused minutes. Missing a day never removes what you've completed."
        />
        <View style={styles.choiceList}>
          {RHYTHMS.map((rhythm) => (
            <ChoiceRow
              key={rhythm.id}
              detail={rhythm.detail}
              label={rhythm.label}
              onPress={() => selectRhythm(rhythm.id)}
              selected={state.rhythm === rhythm.id}
              testID={`onboarding-rhythm-${rhythm.id}`}
            />
          ))}
        </View>
      </OnboardingFrame>
    );
  }

  if (state.step === 'plan') {
    const goal = GOALS.find((item) => item.id === state.goal) ?? GOALS[0];
    const rhythm = RHYTHMS.find((item) => item.id === state.rhythm) ?? RHYTHMS[0];

    return (
      <OnboardingFrame
        {...sharedFrameProps}
        actions={<GlideButton fullWidth label="Try the first sound" onPress={() => setStep('sample')} />}>
        <ScreenIntro
          eyebrow="YOUR GREEK PATH"
          title="Start with the sounds. Build toward real exchanges."
          copy={`${rhythm.label}, beginning with one 8-minute lesson.`}
        />
        <GlideSurface padding="roomy" variant="tinted" style={styles.planCard}>
          <PathMilestone index="01" kicker="NOW" title="Decode Greek letters" detail="First lesson · 8 min" />
          <View style={[styles.pathLine, { backgroundColor: theme.border }]} />
          <PathMilestone index="02" kicker="NEXT" title="Introduce yourself" />
          <View style={[styles.pathLine, { backgroundColor: theme.border }]} />
          <PathMilestone index="03" kicker="YOUR DESTINATION" title={goal.destination} />
        </GlideSurface>
        <GlideButton label="Edit my answers" onPress={() => setStep('goal')} variant="tertiary" />
      </OnboardingFrame>
    );
  }

  if (state.step === 'sample') {
    const correct = sampleChoice === 'α';
    return (
      <OnboardingFrame
        {...sharedFrameProps}
        actions={
          sampleChecked && correct ? (
            <GlideButton fullWidth label="Continue" onPress={completeSample} testID="onboarding-sample-continue" />
          ) : sampleChecked ? (
            <GlideButton
              fullWidth
              label="Try again"
              onPress={() => {
                setSampleChoice(null);
                setSampleChecked(false);
              }}
              testID="onboarding-sample-retry"
            />
          ) : (
            <GlideButton
              disabled={!sampleChoice}
              fullWidth
              label="Check answer"
              onPress={() => setSampleChecked(true)}
              testID="onboarding-sample-check"
            />
          )
        }>
        <ScreenIntro
          eyebrow="FIRST SOUND"
          title="Greek is more familiar than it looks."
          copy="Listen once, then connect the sound to a letter."
        />
        <View style={styles.sampleHero}>
          <ThemedText accessibilityLabel="Greek letter alpha" style={styles.alpha}>
            α
          </ThemedText>
          <ThemedText type="body" themeColor="textSecondary">
            like the a in father
          </ThemedText>
          <SampleAudioControl
            audioId="el-letter-alpha"
            error={audioState.error}
            onPlay={pronunciation.play}
            phrase="Greek letter alpha"
            status={audioState.status}
          />
        </View>
        <View style={styles.sampleQuestion}>
          <ThemedText type="title3">Which letter is the a in father?</ThemedText>
          <View style={styles.sampleChoices}>
            {SAMPLE_CHOICES.map((choice) => (
              <SampleChoice
                key={choice}
                checked={sampleChecked}
                correct={choice === 'α'}
                label={choice}
                onPress={() => {
                  setSampleChoice(choice);
                  setSampleChecked(false);
                }}
                selected={sampleChoice === choice}
              />
            ))}
          </View>
          {sampleChecked ? (
            <GlideSurface accessibilityRole="alert" padding="regular" variant={correct ? 'success' : 'tinted'}>
              <ThemedText type="headline">{correct ? 'That connection is right.' : 'A useful contrast.'}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {correct
                  ? 'α maps to a sound you already know.'
                  : `${sampleChoice} has a different sound. The a in father is α.`}
              </ThemedText>
            </GlideSurface>
          ) : null}
        </View>
      </OnboardingFrame>
    );
  }

  if (state.step === 'result') {
    return (
      <OnboardingFrame
        {...sharedFrameProps}
        actions={<GlideButton fullWidth label="See my options" onPress={() => setStep('paywall')} />}>
        <View style={styles.resultGlyph}>
          <ThemedText style={styles.resultAlpha}>α</ThemedText>
        </View>
        <ScreenIntro
          eyebrow="FIRST CONNECTION"
          title="You mapped α to a familiar sound."
          copy="The first lesson builds this into words like καλημέρα."
        />
        <ThemedText type="footnote" themeColor="textSecondary">
          This was one successful connection—not a mastery claim. Your path will build and revisit it.
        </ThemedText>
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame
      {...sharedFrameProps}
      actions={
        <View style={styles.paywallActions}>
          {billing.isPro ? (
            <GlideButton
              disabled={completionPending}
              fullWidth
              label="Continue with Pro"
              onPress={() => void finishOnboarding('pro')}
              testID="onboarding-pro-continue"
            />
          ) : (
            <GlideButton
              disabled={!selectedPlanId || purchasePending || completionPending}
              fullWidth
              label={
                completionPending
                  ? 'Preparing your first mission…'
                  : purchasePending
                    ? billing.purchaseState.status === 'syncing'
                      ? 'Confirming Pro access…'
                      : 'Opening secure checkout…'
                    : selectedPlanId === FREE_PLAN_ID
                      ? 'Continue with Free'
                      : selectedPackage
                        ? `Choose ${proPlanName(selectedPackage.interval, selectedPackage.title)}`
                        : 'Choose a plan'
              }
              onPress={() => void continueWithSelectedPlan()}
              testID={selectedPlanId === FREE_PLAN_ID ? 'onboarding-free-continue' : 'onboarding-plan-continue'}
            />
          )}
        </View>
      }>
      <ScreenIntro
        eyebrow={billing.isPro ? 'YOUR PLAN' : __DEV__ ? 'CHOOSE YOUR PLAN' : 'YOUR FIRST MISSION'}
        title={
          billing.isPro
            ? 'Your Pro access is active.'
            : __DEV__
              ? 'Choose how you want to begin.'
              : 'Your first Greek mission is ready.'
        }
        copy={
          billing.isPro
            ? 'Pro access is active for this account. Your first full lesson is ready.'
            : __DEV__
              ? 'Start free with the first complete mission, or add Pro tutor help. You can change your plan later.'
              : 'Begin with a complete guided lesson. Your progress stays connected to your account.'
        }
      />

      {!billing.isPro ? (
        <View style={styles.choiceList}>
          <ChoiceRow
            detail="Complete the first Greek mission with guided listening and practice."
            label="Free"
            meta="$0"
            onPress={() => setSelectedPlanId(FREE_PLAN_ID)}
            selected={selectedPlanId === FREE_PLAN_ID}
            testID="onboarding-plan-free"
          />
          {__DEV__ ? billing.packages.map((item) => (
            <ChoiceRow
              key={item.identifier}
              detail="Everything in Free, plus on-demand tutor help inside lessons."
              label={proPlanName(item.interval, item.title)}
              meta={item.priceLabel}
              onPress={() => setSelectedPlanId(item.identifier)}
              selected={selectedPlanId === item.identifier}
              testID={`onboarding-package-${item.identifier}`}
            />
          )) : null}
        </View>
      ) : null}

      {!billing.isPro && __DEV__ && (billing.status === 'loading' || billing.packages.length === 0) ? (
        <GlideSurface padding="regular" variant="tinted" style={styles.planNotice}>
          {billing.status === 'loading' ? <ActivityIndicator color={theme.tint} /> : null}
          <View style={styles.planNoticeCopy}>
            <ThemedText type="headline">
              {billing.status === 'loading' ? 'Loading Pro options…' : 'Pro is temporarily unavailable.'}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              You can continue with Free now, or refresh the Pro options.
            </ThemedText>
          </View>
          {billing.status !== 'loading' ? (
            <GlideButton label="Refresh Pro options" onPress={() => void billing.refresh()} variant="secondary" />
          ) : null}
        </GlideSurface>
      ) : null}

      {purchaseFeedback(billing.purchaseState.status) ? (
        <GlideSurface accessibilityRole="alert" padding="regular" variant="tinted">
          <ThemedText type="headline">
            {billing.purchaseState.status === 'cancelled' ? 'Checkout cancelled' : 'Pro needs another try'}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {purchaseFeedback(billing.purchaseState.status)}
          </ThemedText>
        </GlideSurface>
      ) : null}

      {!billing.isPro && __DEV__ ? (
        <GlideSurface padding="regular" style={styles.sandboxNote} variant="tinted">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            SANDBOX CHECKOUT
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            This development build uses test billing. No real charge is created.
          </ThemedText>
        </GlideSurface>
      ) : null}

      {completionError ? (
        <ThemedText accessibilityRole="alert" type="footnote" style={{ color: theme.danger }}>
          {completionError}
        </ThemedText>
      ) : null}

      {!billing.isPro ? (
        <GlideButton
          disabled={purchasePending}
          label={Platform.OS === 'web' ? 'Refresh existing access' : 'Restore purchases'}
          onPress={() => void billing.restore()}
          variant="tertiary"
        />
      ) : null}
    </OnboardingFrame>
  );
}

function OnboardingFrame({
  children,
  actions,
  onBack,
  progress,
  storageError,
}: PropsWithChildren<{
  actions: ReactNode;
  onBack?: () => void;
  progress?: number;
  storageError: string | null;
}>) {
  const insets = useSafeAreaInsets();
  const top = Platform.OS === 'web' ? Spacing.four : insets.top + Spacing.two;
  const bottom = Math.max(insets.bottom, Spacing.three);

  return (
    <View style={styles.screen} testID="onboarding-screen">
      <View style={[styles.header, { paddingTop: top }]}>
        <View style={styles.headerRow}>
          {onBack ? <GlideButton label="Back" onPress={onBack} variant="tertiary" /> : <View />}
          {progress !== undefined ? (
            <ThemedText type="caption" themeColor="textTertiary">
              {Math.round(progress * 100)}%
            </ThemedText>
          ) : null}
        </View>
        {progress !== undefined ? <ProgressBar value={progress} /> : null}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {children}
        {storageError ? (
          <ThemedText accessibilityRole="alert" type="footnote" themeColor="textSecondary">
            {storageError}
          </ThemedText>
        ) : null}
      </ScrollView>
      <View style={[styles.actionBar, { paddingBottom: bottom }]}>{actions}</View>
    </View>
  );
}

function ScreenIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <View style={styles.intro}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        {eyebrow}
      </ThemedText>
      <ThemedText accessibilityRole="header" type="display">
        {title}
      </ThemedText>
      <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
        {copy}
      </ThemedText>
    </View>
  );
}

function ChoiceRow({
  label,
  detail,
  meta,
  selected,
  onPress,
  testID,
}: {
  label: string;
  detail: string;
  meta?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? theme.tintSoft : theme.surface,
          borderColor: selected ? theme.textSecondary : theme.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <View style={styles.choiceCopy}>
        <View style={styles.choiceHeading}>
          <ThemedText type="headline">{label}</ThemedText>
          {meta ? <ThemedText type="headline">{meta}</ThemedText> : null}
        </View>
        <ThemedText type="footnote" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      <View
        style={[
          styles.choiceIndicator,
          { backgroundColor: selected ? theme.tint : 'transparent', borderColor: selected ? theme.tint : theme.border },
        ]}>
        {selected ? (
          <ThemedText accessibilityElementsHidden type="caption" themeColor="textInverse">
            ✓
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

function PreviewRow({ label, detail, last = false }: { label: string; detail: string; last?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.previewRow, !last && { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <ThemedText type="callout">{label}</ThemedText>
      <ThemedText type="caption" themeColor="textTertiary">
        {detail.toUpperCase()}
      </ThemedText>
    </View>
  );
}

function PathMilestone({ index, kicker, title, detail }: { index: string; kicker: string; title: string; detail?: string }) {
  return (
    <View style={styles.milestone}>
      <View style={styles.milestoneIndex}>
        <ThemedText type="caption" themeColor="textSecondary">
          {index}
        </ThemedText>
      </View>
      <View style={styles.milestoneCopy}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          {kicker}
        </ThemedText>
        <ThemedText type="title3">{title}</ThemedText>
        {detail ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {detail}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

function SampleChoice({
  label,
  selected,
  checked,
  correct,
  onPress,
}: {
  label: string;
  selected: boolean;
  checked: boolean;
  correct: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const borderColor = checked && correct ? theme.success : selected ? theme.text : theme.border;
  return (
    <Pressable
      accessibilityLabel={`Greek letter ${label}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sampleChoice,
        {
          backgroundColor: selected ? theme.tintSoft : theme.surface,
          borderColor,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <ThemedText style={styles.sampleChoiceText}>{label}</ThemedText>
    </Pressable>
  );
}

function SampleAudioControl({
  audioId,
  phrase,
  status,
  error,
  onPlay,
}: {
  audioId: string;
  phrase: string;
  status: PronunciationStatus;
  error: string | null;
  onPlay: (audioId: string) => void;
}) {
  const label =
    status === 'loading' ? 'Loading pronunciation…' : status === 'playing' ? 'Playing pronunciation' : error ? 'Retry audio' : 'Play sound';

  return (
    <View style={styles.audioControl}>
      <GlideButton
        disabled={status === 'loading'}
        label={label}
        onPress={() => onPlay(audioId)}
        variant="secondary"
      />
      {error ? (
        <ThemedText accessibilityRole="alert" type="footnote" themeColor="textSecondary">
          {error}
        </ThemedText>
      ) : null}
      <ThemedText type="caption" themeColor="textTertiary">
        {phrase}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBar: {
    alignSelf: 'center',
    backgroundColor: 'transparent',
    paddingHorizontal: Spacing.threeHalf,
    paddingTop: Spacing.two,
    width: '100%',
    maxWidth: 560,
  },
  alpha: { fontSize: 82, lineHeight: 90 },
  audioControl: { alignItems: 'center', gap: Spacing.one },
  brandMark: { height: 40, width: 40 },
  choice: {
    alignItems: 'center',
    borderRadius: Radii.large,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.three,
    minHeight: 72,
    padding: Spacing.three,
  },
  choiceCopy: { flex: 1, gap: Spacing.one },
  choiceHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: Spacing.two, justifyContent: 'space-between' },
  choiceIndicator: {
    alignItems: 'center',
    borderRadius: Radii.capsule,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  choiceList: { gap: Spacing.two },
  content: {
    alignSelf: 'center',
    flexGrow: 1,
    gap: Spacing.four,
    maxWidth: 560,
    paddingBottom: Spacing.four,
    paddingHorizontal: Spacing.threeHalf,
    paddingTop: Spacing.four,
    width: '100%',
  },
  header: { alignSelf: 'center', gap: Spacing.two, paddingHorizontal: Spacing.threeHalf, width: '100%', maxWidth: 560 },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 40 },
  intro: { gap: Spacing.two },
  introCopy: { maxWidth: 520 },
  milestone: { alignItems: 'flex-start', flexDirection: 'row', gap: Spacing.three },
  milestoneCopy: { flex: 1, gap: Spacing.half },
  milestoneIndex: { alignItems: 'center', justifyContent: 'center', minHeight: 24, width: 28 },
  pathLine: { height: Spacing.four, marginLeft: 13, width: StyleSheet.hairlineWidth },
  paywallActions: { gap: Spacing.one },
  planNotice: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  planNoticeCopy: { flex: 1, gap: Spacing.half },
  planCard: { gap: 0 },
  previewList: { marginTop: Spacing.two },
  previewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: Spacing.three,
  },
  resultAlpha: { fontSize: 52, lineHeight: 60 },
  resultGlyph: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  sampleChoice: {
    alignItems: 'center',
    borderRadius: Radii.large,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 72,
  },
  sampleChoiceText: { fontSize: 32, lineHeight: 40 },
  sampleChoices: { flexDirection: 'row', gap: Spacing.two },
  sampleHero: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
  sampleQuestion: { gap: Spacing.three },
  screen: { flex: 1 },
  sandboxNote: { gap: Spacing.half },
  welcomeMark: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
});
