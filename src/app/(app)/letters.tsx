import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { greekLetters, type LetterReference } from '@/constants/reference-content';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { usePronunciationPlayer } from '@/features/learning-session/audio/use-pronunciation-player';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

export default function LettersScreen() {
  const router = useRouter();
  const theme = useTheme();
  const pronunciation = usePronunciationPlayer();
  const { language, enrolledCourse, completedLessonIds, openLesson } = useLearning();

  if (language.id !== 'el') {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            LETTERS · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">This writing guide is not published yet.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Writing systems are authored for each language instead of translating the Greek alphabet experience mechanically.
          </ThemedText>
        </View>
      </ScreenFrame>
    );
  }

  const firstSet = greekLetters.filter((letter) => letter.lessonId === 'el-letters-1');
  const firstSetPracticed = completedLessonIds.includes('el-letters-1');

  function openFirstLettersLesson() {
    openLesson('el-letters-1');
    router.replace('/');
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          LETTERS · MODERN GREEK
        </ThemedText>
        <ThemedText type="display">See the alphabet as a sound map.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Use this as a reference while learning. A reference label does not claim that a letter has been practiced or retained.
        </ThemedText>
      </View>

      <GlideSurface padding="roomy" style={styles.currentSet} variant="tinted">
        <ThemedText type="eyebrow" themeColor="textSecondary">
          {firstSetPracticed ? 'PRACTICED IN YOUR FIRST QUEST' : 'YOUR FIRST LETTER SET'}
        </ThemedText>
        <View style={styles.featuredLetters}>
          {firstSet.map((letter) => (
            <View key={letter.id} style={styles.featuredLetter}>
              <ThemedText style={styles.featuredGlyph}>{letter.upper} {letter.lower}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {letter.sound}
              </ThemedText>
            </View>
          ))}
        </View>
        {enrolledCourse ? (
          <GlideButton
            label={firstSetPracticed ? 'Practice this quest again' : 'Learn these letters'}
            onPress={openFirstLettersLesson}
          />
        ) : (
          <GlideButton label="Start Greek Foundations" onPress={() => router.push('/course/el-from-zero')} />
        )}
      </GlideSurface>

      <View style={styles.alphabetSection}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            ALPHABET · 24 LETTERS
          </ThemedText>
          <ThemedText type="title2">Uppercase, lowercase, sound, and an example</ThemedText>
        </View>
        <View style={styles.grid}>
          {greekLetters.map((letter) => (
            <LetterCard
              key={letter.id}
              letter={letter}
              practiced={Boolean(letter.lessonId && completedLessonIds.includes(letter.lessonId))}
              onPlay={letter.audioId ? () => pronunciation.play(letter.audioId!) : undefined}
              playback={letter.audioId ? pronunciation.stateFor(letter.audioId) : null}
              borderColor={theme.border}
              backgroundColor={theme.surface}
              pressedColor={theme.backgroundSelected}
            />
          ))}
        </View>
      </View>
    </ScreenFrame>
  );
}

function LetterCard({
  letter,
  practiced,
  onPlay,
  playback,
  borderColor,
  backgroundColor,
  pressedColor,
}: {
  letter: LetterReference;
  practiced: boolean;
  onPlay?: () => void;
  playback: ReturnType<ReturnType<typeof usePronunciationPlayer>['stateFor']> | null;
  borderColor: string;
  backgroundColor: string;
  pressedColor: string;
}) {
  return (
    <Pressable
      accessibilityLabel={`${letter.name}, ${letter.upper} ${letter.lower}, ${letter.sound}. ${practiced ? 'Practiced in a quest.' : letter.audioId ? 'Available in the first quest.' : 'Reference.'}${letter.audioId ? ' Play pronunciation.' : ''}`}
      accessibilityRole={letter.audioId ? 'button' : 'text'}
      disabled={!onPlay}
      onPress={onPlay}
      style={({ pressed }) => [
        styles.letterCard,
        { backgroundColor: pressed ? pressedColor : backgroundColor, borderColor },
      ]}>
      <View style={styles.letterHeading}>
        <ThemedText style={styles.letterGlyph}>{letter.upper} {letter.lower}</ThemedText>
        <ThemedText type="caption" themeColor="textTertiary">
          {practiced ? 'PRACTICED' : letter.audioId ? playback?.status.toUpperCase() : 'REFERENCE'}
        </ThemedText>
      </View>
      <ThemedText type="headline">{letter.name}</ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary">
        {letter.sound}
      </ThemedText>
      <View style={styles.exampleLine}>
        <ThemedText type="headline">{letter.example}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {letter.meaning}
        </ThemedText>
      </View>
      {letter.note ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {letter.note}
        </ThemedText>
      ) : null}
      {playback?.error ? (
        <ThemedText accessibilityRole="alert" type="caption" themeColor="danger">
          {playback.error} Tap to retry.
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 560 },
  currentSet: { gap: Spacing.three },
  featuredLetters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four },
  featuredLetter: { gap: Spacing.half, minWidth: 120 },
  featuredGlyph: { fontFamily: Fonts.sansSemibold, fontSize: 28, lineHeight: 34 },
  alphabetSection: { gap: Spacing.three },
  sectionHeading: { gap: Spacing.one },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  letterCard: {
    borderRadius: Radii.large,
    borderWidth: StyleSheet.hairlineWidth,
    flexBasis: 220,
    flexGrow: 1,
    gap: Spacing.one,
    minWidth: 220,
    padding: Spacing.three,
  },
  letterHeading: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two, justifyContent: 'space-between' },
  letterGlyph: { fontFamily: Fonts.sansSemibold, fontSize: 24, lineHeight: 30 },
  exampleLine: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
});
