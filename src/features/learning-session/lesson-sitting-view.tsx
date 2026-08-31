import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ProgressBar } from '@/components/ui/progress-bar';
import { findLesson, nextLesson } from '@/constants/catalog';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { CheckBeat, DoneBeat, HearBeat, NoticeBeat } from '@/features/learning-session/sitting-beats';
import { LessonAskDrawer } from '@/features/learning-session/lesson-tutor/lesson-ask-drawer';
import {
  isLessonTutorEnabled,
  useLessonTutor,
} from '@/features/learning-session/lesson-tutor/use-lesson-tutor';
import {
  type CheckObservation,
  type LessonMode,
  summarizeLessonCompletion,
} from '@/features/learning-progress/evidence-policy';
import { useTheme } from '@/hooks/use-theme';
import { type LessonCompletionResult, useLearning } from '@/providers/learning-provider';

export function LessonSittingView({
  lessonId,
  mode = 'learn',
  onClose,
}: {
  lessonId: string;
  mode?: LessonMode;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { enrolledCourse, completedLessonIds, lessonEvidence, completeLesson, openLesson } = useLearning();
  const found = findLesson(lessonId);
  const beats = useMemo(
    () => (mode === 'review' ? (found?.lesson.reviewBeats ?? []) : (found?.lesson.beats ?? [])),
    [found?.lesson.beats, found?.lesson.reviewBeats, mode],
  );
  const total = Math.max(beats.length, 1);
  const following = mode === 'learn' && enrolledCourse
    ? nextLesson(enrolledCourse, completedLessonIds.includes(lessonId) ? completedLessonIds : [...completedLessonIds, lessonId])
    : null;
  const followingAuthored = following?.lesson.beats?.length ? following : null;
  const previousEvidence = lessonEvidence.find((record) => record.lessonId === lessonId);
  const [step, setStep] = useState(0);
  const [askOpen, setAskOpen] = useState(false);
  const [selectedChoices, setSelectedChoices] = useState<Record<number, string | null>>({});
  const [checkObservations, setCheckObservations] = useState<Record<number, CheckObservation>>({});
  const [practiceResult, setPracticeResult] = useState<LessonCompletionResult | null>(null);
  const completionRecorded = useRef(false);
  const web = Platform.OS === 'web';
  const top = web ? Spacing.three : insets.top + Spacing.two;
  const done = beats.length > 0 && step >= beats.length;
  const beat = !done ? beats[step] : undefined;
  const selectedChoice = selectedChoices[step] ?? null;
  const tutor = useLessonTutor(lessonId, {
    lesson_id: lessonId,
    selected_choice: selectedChoice,
    visible_step_index: step,
  });
  const tutorAvailable = isLessonTutorEnabled() && mode === 'learn' && beats.length > 0 && !done;
  const progress = done || beats.length === 0 ? 1 : step / total;
  const completionInput = useMemo(
    () => ({
      lessonId,
      mode,
      capability: found?.lesson.capability,
      introducedModes: found?.lesson.introducedModes ?? [],
      checks: Object.values(checkObservations).sort((left, right) => left.beatIndex - right.beatIndex),
    }),
    [checkObservations, found?.lesson.capability, found?.lesson.introducedModes, lessonId, mode],
  );
  const previewEvidence = summarizeLessonCompletion(completionInput, previousEvidence?.lastPracticedAt ?? 0, previousEvidence);
  const closureEvidence = practiceResult?.evidence ?? previewEvidence;

  function recordAttempt(correct: boolean) {
    const currentBeat = beats[step];
    if (currentBeat?.type !== 'check') return;
    setCheckObservations((current) => {
      const previous = current[step];
      const attempts = (previous?.attempts ?? 0) + 1;
      return {
        ...current,
        [step]: {
          beatIndex: step,
          capabilityId: currentBeat.evidence?.capabilityId,
          level: currentBeat.evidence?.level,
          attempts,
          correct: previous?.correct || correct,
          correctOnFirstTry: previous ? previous.correctOnFirstTry : correct,
        },
      };
    });
  }

  function advance() {
    const nextStep = step + 1;
    if (nextStep >= beats.length && !completionRecorded.current) {
      completionRecorded.current = true;
      setPracticeResult(completeLesson(completionInput));
    }
    setStep(nextStep);
  }

  function finishAndOpenNext() {
    tutor.cancel();
    if (followingAuthored?.lesson) {
      openLesson(followingAuthored.lesson.id, 'learn');
      return;
    }
    onClose();
  }

  function finishAndHome() {
    tutor.cancel();
    onClose();
  }

  function leaveLesson() {
    tutor.cancel();
    onClose();
  }

  const completionCopy = (() => {
    if (closureEvidence.lastCheckpoint === 'recovered') {
      return {
        kicker: 'USEFUL RECOVERY',
        summary: 'You rebuilt the sound pattern after another try.',
        evidence:
          closureEvidence.state === 'demonstrated'
            ? 'Your earlier demonstration remains. This recovery will shape what returns next.'
            : 'That is practice evidence. A fresh first attempt can demonstrate it.',
      };
    }
    if (closureEvidence.state === 'demonstrated' && closureEvidence.capability) {
      return {
        kicker: mode === 'review' ? 'REVIEW COMPLETE' : 'CHECKPOINT PASSED',
        summary: closureEvidence.capability.canDo,
        evidence:
          mode === 'review'
            ? 'You recalled the varied pattern without the lesson model. Retention still needs a wider gap.'
            : 'Demonstrated in a fresh pattern. A delayed review will check whether it sticks.',
      };
    }
    return {
      kicker: 'PRACTICE COMPLETE',
      summary: 'You worked through the first Greek sound pattern.',
      evidence: 'This records practice, not mastery. The next checkpoint will ask for less support.',
    };
  })();

  return (
    <ThemedView style={[styles.screen, web && styles.webLayout]}>
      <View style={styles.lessonPane}>
        <View style={[styles.chrome, { paddingTop: top, borderBottomColor: theme.separator }]}>
          <Pressable
            accessibilityLabel="Leave sitting"
            accessibilityRole="button"
            hitSlop={8}
            onPress={leaveLesson}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.close,
              { backgroundColor: pressed || hovered ? theme.backgroundSelected : 'transparent' },
            ]}>
            <ThemedText type="title3" themeColor="textSecondary">
              ✕
            </ThemedText>
          </Pressable>
          <ProgressBar style={styles.bar} value={progress} />
          <ThemedText type="caption" themeColor="textTertiary" style={styles.count}>
            {beats.length ? `${Math.min(step + 1, total)} / ${total}` : '—'}
          </ThemedText>
          {tutorAvailable ? (
            <Pressable
              accessibilityLabel="Ask about this lesson"
              accessibilityRole="button"
              onPress={() => setAskOpen(true)}
              style={styles.askAction}>
              <ThemedText type="footnote">Ask</ThemedText>
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.body, { paddingBottom: insets.bottom + Spacing.four }]}>
          {!found ? (
            <ThemedText type="title">Lesson not found</ThemedText>
          ) : beats.length === 0 ? (
            <View style={styles.empty}>
              <ThemedText type="eyebrow" themeColor="textSecondary">
                {found.module.title.toUpperCase()}
              </ThemedText>
              <ThemedText type="title">{found.lesson.title}</ThemedText>
              <ThemedText type="body" themeColor="textSecondary" style={styles.emptyCopy}>
                {mode === 'review'
                  ? 'This capability does not have a separate review variation yet.'
                  : 'This sitting is listed on the path. The beats have not been authored yet.'}
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={leaveLesson} style={styles.textAction}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Leave
                </ThemedText>
              </Pressable>
            </View>
          ) : done ? (
            <DoneBeat
              evidence={completionCopy.evidence}
              kicker={completionCopy.kicker}
              nextTitle={followingAuthored?.lesson.title ?? null}
              onNext={finishAndOpenNext}
              onHome={finishAndHome}
              rhythmResult={practiceResult}
              summary={completionCopy.summary}
            />
          ) : beat?.type === 'hear' ? (
            <HearBeat key={step} beat={beat} onContinue={advance} />
          ) : beat?.type === 'notice' ? (
            <NoticeBeat key={step} text={beat.text} onContinue={advance} />
          ) : beat?.type === 'check' ? (
            <CheckBeat
              key={step}
              beat={beat}
              onAttempt={recordAttempt}
              onContinue={advance}
              onSelectChoice={(choice) =>
                setSelectedChoices((current) => ({ ...current, [step]: choice }))
              }
              selectedChoice={selectedChoice}
            />
          ) : null}
        </View>
      </View>
      {askOpen && tutorAvailable && found ? (
        <LessonAskDrawer
          lessonTitle={found.lesson.title}
          onClose={() => setAskOpen(false)}
          onRetry={tutor.retry}
          onSend={tutor.send}
          state={tutor.state}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  webLayout: { flexDirection: 'row' },
  lessonPane: { flex: 1 },
  chrome: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  close: {
    alignItems: 'center',
    borderRadius: Radii.small,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  bar: { flex: 1 },
  count: { fontFamily: Fonts.sansMedium, minWidth: 36, textAlign: 'right' },
  askAction: { alignItems: 'center', justifyContent: 'center', minHeight: 40, minWidth: 44 },
  body: { flex: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four },
  emptyCopy: { maxWidth: 420, textAlign: 'center' },
  textAction: { justifyContent: 'center', minHeight: 44 },
});
