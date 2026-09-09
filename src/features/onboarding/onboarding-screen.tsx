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

export function OnboardingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { state, storageError, setStep, selectGoal, selectRhythm, completeSample, completeOnboarding } =
    useOnboarding();
  const { setWeeklyPracticeGoal, startCourse } = useLearning();
  const billing = useBilling();
  const [sampleChoice, setSampleChoice] = useState<string | null>(null);
  const [sampleChecked, setSampleChecked] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completionPending, setCompletionPending] = useState(false);
  const pronunciation = usePronunciationPlayer();
  const audioState = pronunciation.stateFor('el-letter-alpha');
  const previousStep = previousOnboardingStep(state.step);
  const selectedPackage =
    billing.packages.find((item) => item.identifier === selectedPackageId) ?? billing.packages[0] ?? null;

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
          ) : billing.mode === 'mock' ? (
            <GlideButton
              disabled={!selectedPackage || billing.status === 'loading' || completionPending}
              fullWidth
              label="Unlock Pro preview"
              onPress={() => selectedPackage && void billing.purchase(selectedPackage.identifier)}
              testID="onboarding-purchase"
            />
          ) : null}
          {!billing.isPro ? (
            <GlideButton
              disabled={billing.status === 'loading' || completionPending}
              fullWidth
              label="Continue with the free first mission"
              onPress={() => void finishOnboarding('free')}
              testID="onboarding-free-continue"
              variant="tertiary"
            />
          ) : null}
        </View>
      }>
      <ScreenIntro
        eyebrow={`GLIDELINGO PRO${billing.mode === 'mock' ? ' · DESIGN PREVIEW' : ' · NOT YET FOR SALE'}`}
        title={billing.isPro ? 'Your Pro access is active.' : 'Keep your Greek moving.'}
        copy={
          billing.isPro
            ? 'Pro access is active for this account. Your first full lesson is ready.'
            : billing.mode === 'mock'
              ? 'Preview the Pro decision in development, or begin with the free first mission.'
              : 'Paid onboarding stays disabled until the Pro course boundary and complete renewal terms are ready. Begin with the free first mission.'
        }
      />

      <View style={styles.benefits}>
        <BenefitRow>One complete authored mission free</BenefitRow>
        <BenefitRow>Guided listening and practice</BenefitRow>
        <BenefitRow>Account-linked progress and access</BenefitRow>
      </View>

      {billing.status === 'loading' ? (
        <View accessibilityLabel="Checking subscription options" accessibilityRole="progressbar" style={styles.loadingPlans}>
          <ActivityIndicator color={theme.tint} />
          <ThemedText type="footnote" themeColor="textSecondary">
            Checking subscription options…
          </ThemedText>
        </View>
      ) : null}

      {!billing.isPro && billing.mode === 'mock' && billing.status !== 'loading' ? (
        <View style={styles.choiceList}>
          {billing.packages.map((item) => (
            <ChoiceRow
              key={item.identifier}
              detail={item.description}
              label={item.title}
              meta={item.priceLabel}
              onPress={() => setSelectedPackageId(item.identifier)}
              selected={selectedPackage?.identifier === item.identifier}
              testID={`onboarding-package-${item.identifier}`}
            />
          ))}
          {billing.packages.length === 0 && billing.status !== 'error' ? (
            <GlideSurface padding="roomy" style={styles.emptyPlan}>
              <ThemedText type="title3">Plans are temporarily unavailable.</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                You can refresh the store or continue with the free first mission.
              </ThemedText>
              <GlideButton label="Refresh plans" onPress={() => void billing.refresh()} variant="secondary" />
            </GlideSurface>
          ) : null}
        </View>
      ) : null}

      {billing.errorMessage ? (
        <GlideSurface accessibilityRole="alert" padding="regular">
          <ThemedText type="headline" style={{ color: theme.danger }}>
            Subscription status unavailable
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {billing.errorMessage}
          </ThemedText>
          <GlideButton label="Try again" onPress={() => void billing.refresh()} variant="secondary" />
        </GlideSurface>
      ) : null}

      {!billing.isPro && billing.mode !== 'mock' ? (
        <GlideSurface padding="roomy" style={styles.emptyPlan} variant="tinted">
          <ThemedText type="title3">Start with the free first mission.</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            This onboarding screen will not start a real purchase until the paid course boundary and complete package terms ship together.
          </ThemedText>
        </GlideSurface>
      ) : null}

      {completionError ? (
        <ThemedText accessibilityRole="alert" type="footnote" style={{ color: theme.danger }}>
          {completionError}
        </ThemedText>
      ) : null}

      <View style={styles.storeActions}>
        <GlideButton
          disabled={billing.status === 'loading'}
          label={Platform.OS === 'web' ? 'Refresh access' : 'Restore purchases'}
          onPress={() => void billing.restore()}
          variant="tertiary"
        />
        <ThemedText type="caption" themeColor="textTertiary" style={styles.termsCopy}>
          {billing.mode === 'mock'
            ? 'Development preview only. No store charge is created.'
            : 'No onboarding purchase will be started from this screen.'}
        </ThemedText>
      </View>
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

function BenefitRow({ children }: PropsWithChildren) {
  return (
    <View style={styles.benefitRow}>
      <ThemedText type="headline">✓</ThemedText>
      <ThemedText type="body">{children}</ThemedText>
    </View>
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
  benefitRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  benefits: { gap: Spacing.two },
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
  emptyPlan: { gap: Spacing.two },
  header: { alignSelf: 'center', gap: Spacing.two, paddingHorizontal: Spacing.threeHalf, width: '100%', maxWidth: 560 },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 40 },
  intro: { gap: Spacing.two },
  introCopy: { maxWidth: 520 },
  loadingPlans: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two, minHeight: 48 },
  milestone: { alignItems: 'flex-start', flexDirection: 'row', gap: Spacing.three },
  milestoneCopy: { flex: 1, gap: Spacing.half },
  milestoneIndex: { alignItems: 'center', justifyContent: 'center', minHeight: 24, width: 28 },
  pathLine: { height: Spacing.four, marginLeft: 13, width: StyleSheet.hairlineWidth },
  paywallActions: { gap: Spacing.one },
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
  storeActions: { alignItems: 'center', gap: Spacing.one },
  termsCopy: { maxWidth: 420, textAlign: 'center' },
  welcomeMark: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
});
