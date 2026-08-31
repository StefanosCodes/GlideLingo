import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { type SittingBeat } from '@/constants/catalog';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { PronunciationControl } from '@/features/learning-session/pronunciation-control';
import { usePronunciationPlayer } from '@/features/learning-session/audio/use-pronunciation-player';
import { useTheme } from '@/hooks/use-theme';

type PressState = { pressed: boolean; hovered?: boolean };

export function HearBeat({
  beat,
  onContinue,
}: {
  beat: Extract<SittingBeat, { type: 'hear' }>;
  onContinue: () => void;
}) {
  const pronunciation = usePronunciationPlayer();
  const playback = pronunciation.stateFor(beat.audioId);

  return (
    <View style={styles.stage}>
      <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.kicker}>
        HEAR THIS SOUND
      </ThemedText>
      <ThemedText type="display" style={styles.stimulus}>
        {beat.greek}
      </ThemedText>
      <ThemedText type="body" themeColor="textSecondary" style={styles.gloss}>
        {beat.gloss}
      </ThemedText>
      <PronunciationControl
        audioId={beat.audioId}
        error={playback.error}
        onPlay={pronunciation.play}
        phrase={beat.greek}
        status={playback.status}
      />
      <GlideButton label="Continue" onPress={onContinue} style={styles.continue} />
    </View>
  );
}

export function NoticeBeat({ text, onContinue }: { text: string; onContinue: () => void }) {
  return (
    <View style={styles.stage}>
      <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.kicker}>
        NOTICE
      </ThemedText>
      <ThemedText type="title" style={styles.notice}>
        {text}
      </ThemedText>
      <GlideButton label="Continue" onPress={onContinue} style={styles.continue} />
    </View>
  );
}

export function CheckBeat({
  beat,
  onContinue,
  onAttempt,
  onSelectChoice,
  selectedChoice,
}: {
  beat: Extract<SittingBeat, { type: 'check' }>;
  onContinue: () => void;
  onAttempt: (correct: boolean) => void;
  onSelectChoice: (choice: string) => void;
  selectedChoice: string | null;
}) {
  const theme = useTheme();
  const pronunciation = usePronunciationPlayer();
  const correct = selectedChoice !== null && selectedChoice === beat.answer;
  const playback = beat.audioId ? pronunciation.stateFor(beat.audioId) : null;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onKey(event: KeyboardEvent) {
      const index = Number(event.key) - 1;
      if (index < 0 || index >= beat.choices.length || selectedChoice === beat.answer) return;
      const choice = beat.choices[index] ?? null;
      if (choice) {
        onSelectChoice(choice);
        onAttempt(choice === beat.answer);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [beat.answer, beat.choices, onAttempt, onSelectChoice, selectedChoice]);

  return (
    <View style={styles.stage}>
      <ThemedText type="title2" style={styles.prompt}>
        {beat.prompt}
      </ThemedText>

      {beat.greek ? (
        <View style={[styles.card, { borderColor: theme.border }]}>
          <ThemedText type="display" style={styles.cardGreek}>
            {beat.greek}
          </ThemedText>
          {beat.audioId && playback ? (
            <PronunciationControl
              audioId={beat.audioId}
              error={playback.error}
              onPlay={pronunciation.play}
              phrase={beat.greek}
              status={playback.status}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.choices}>
        {beat.choices.map((choice, index) => {
          const selected = selectedChoice === choice;
          const showCorrect = selectedChoice !== null && choice === beat.answer && (correct || selected);
          const showWrong = selected && choice !== beat.answer;
          return (
            <Pressable
              key={choice}
              accessibilityLabel={`${index + 1}. ${choice}`}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: correct }}
              disabled={correct}
              onPress={() => {
                onSelectChoice(choice);
                onAttempt(choice === beat.answer);
              }}
              style={({ pressed, hovered }: PressState) => [
                styles.choice,
                {
                  backgroundColor: selected || pressed || hovered ? theme.backgroundSelected : theme.surface,
                  borderColor: showCorrect ? theme.success : showWrong ? theme.danger : theme.border,
                },
              ]}>
              <View style={[styles.choiceIndex, { borderColor: theme.border }]}>
                <ThemedText type="caption" themeColor="textTertiary">
                  {index + 1}
                </ThemedText>
              </View>
              <ThemedText type="headline" style={styles.choiceLabel}>
                {choice}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {selectedChoice && correct ? (
        <>
          <ThemedText type="footnote" style={{ color: theme.success }}>
            That’s {beat.answer}.
          </ThemedText>
          <GlideButton label="Continue" onPress={onContinue} style={styles.continue} />
        </>
      ) : null}

      {selectedChoice && !correct ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {beat.feedback ?? `Not that one. ${beat.answer} is the one.`} Try again.
        </ThemedText>
      ) : null}
    </View>
  );
}

export function DoneBeat({
  kicker,
  summary,
  evidence,
  nextTitle,
  onNext,
  onHome,
}: {
  kicker: string;
  summary: string;
  evidence: string;
  nextTitle: string | null;
  onNext: () => void;
  onHome: () => void;
}) {
  return (
    <View style={styles.stage}>
      <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.kicker}>
        {kicker}
      </ThemedText>
      <ThemedText type="title" style={styles.notice}>
        {summary}
      </ThemedText>
      <ThemedText type="body" themeColor="textSecondary" style={styles.notice}>
        {evidence}
      </ThemedText>
      {nextTitle ? (
        <ThemedText type="body" themeColor="textSecondary">
          Next: {nextTitle}
        </ThemedText>
      ) : (
        <ThemedText type="body" themeColor="textSecondary">
          That’s the next sitting on this path.
        </ThemedText>
      )}
      <GlideButton
        label={nextTitle ? 'Start next' : 'Back to Home'}
        onPress={nextTitle ? onNext : onHome}
        style={styles.continue}
      />
      {nextTitle ? (
        <Pressable accessibilityRole="button" onPress={onHome} style={styles.textAction}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Back to Home
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    alignSelf: 'center',
    flex: 1,
    gap: Spacing.three,
    justifyContent: 'center',
    maxWidth: 440,
    paddingHorizontal: Spacing.threeHalf,
    width: '100%',
  },
  kicker: { letterSpacing: 0.8 },
  stimulus: { fontFamily: Fonts.sansSemibold, fontSize: 48, lineHeight: 56, textAlign: 'center' },
  gloss: { textAlign: 'center' },
  notice: { textAlign: 'center' },
  prompt: { textAlign: 'center' },
  continue: { alignSelf: 'stretch', marginTop: Spacing.two },
  card: {
    alignItems: 'center',
    borderRadius: Radii.large,
    borderWidth: 1,
    gap: Spacing.three,
    minHeight: 140,
    justifyContent: 'center',
    padding: Spacing.four,
    width: '100%',
  },
  cardGreek: { fontFamily: Fonts.sansSemibold, fontSize: 40, lineHeight: 48 },
  choices: { gap: Spacing.two, width: '100%' },
  choice: {
    alignItems: 'center',
    borderRadius: Radii.large,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.twoHalf,
    minHeight: 52,
    paddingHorizontal: Spacing.twoHalf,
    ...Platform.select({ web: { cursor: 'pointer' as const }, default: {} }),
  },
  choiceIndex: {
    alignItems: 'center',
    borderRadius: Radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  choiceLabel: { flex: 1 },
  textAction: { justifyContent: 'center', minHeight: 44, paddingHorizontal: Spacing.two },
});
