import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { phrasesForCourse, type PhraseReference } from '@/constants/reference-content';
import { Spacing } from '@/constants/theme';
import { usePronunciationPlayer } from '@/features/learning-session/audio/use-pronunciation-player';
import { PronunciationControl } from '@/features/learning-session/pronunciation-control';
import { useLearning } from '@/providers/learning-provider';

export function PhrasesPracticeScreen() {
  const router = useRouter();
  const pronunciation = usePronunciationPlayer();
  const { language, courses, enrolledCourse, reviewItems, openLesson } = useLearning();
  const course = enrolledCourse ?? courses[0] ?? null;
  const phrases = course ? phrasesForCourse(course) : [];
  const dueReview = reviewItems.find((item) => item.due) ?? null;

  function practiceLesson(lessonId: string, mode: 'learn' | 'review' = 'learn') {
    openLesson(lessonId, mode);
    router.replace('/');
  }

  if (!language.available || !course) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            PHRASES · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">No authored examples are published yet.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            This library only shows reviewed course material. Switch courses from the top-right menu to browse available phrases.
          </ThemedText>
        </View>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          PHRASES · {language.name.toUpperCase()}
        </ThemedText>
        <ThemedText type="display">Useful language, connected to its course.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Listen, check the natural meaning, then return to the lesson where the phrase is taught in context.
        </ThemedText>
      </View>

      {dueReview ? (
        <GlideSurface padding="roomy" style={styles.reviewCard} variant="tinted">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            READY TO STRENGTHEN
          </ThemedText>
          <ThemedText type="title2">{dueReview.capability.canDo}</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            {dueReview.reason}
          </ThemedText>
          <GlideButton label="Start varied check" onPress={() => practiceLesson(dueReview.lessonId, 'review')} />
        </GlideSurface>
      ) : null}

      <View style={styles.library}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            FROM {course.title.toUpperCase()}
          </ThemedText>
          <ThemedText type="title2">{phrases.length} authored words and phrases</ThemedText>
        </View>

        {phrases.length ? (
          phrases.map((phrase) => (
            <PhraseCard
              key={phrase.id}
              phrase={phrase}
              playback={phrase.audioId ? pronunciation.stateFor(phrase.audioId) : null}
              onPlay={pronunciation.play}
              onPractice={() => practiceLesson(phrase.lessonId)}
            />
          ))
        ) : (
          <GlideSurface padding="roomy" style={styles.empty}>
            <ThemedText type="title2">The phrase library is still empty.</ThemedText>
            <ThemedText type="callout" themeColor="textSecondary">
              Examples appear here only after they are authored inside a published lesson.
            </ThemedText>
          </GlideSurface>
        )}
      </View>
    </ScreenFrame>
  );
}

function PhraseCard({
  phrase,
  playback,
  onPlay,
  onPractice,
}: {
  phrase: PhraseReference;
  playback: ReturnType<ReturnType<typeof usePronunciationPlayer>['stateFor']> | null;
  onPlay: ReturnType<typeof usePronunciationPlayer>['play'];
  onPractice: () => void;
}) {
  return (
    <GlideSurface padding="roomy" style={styles.phraseCard}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        {phrase.questTitle.toUpperCase()}
      </ThemedText>
      <View style={styles.phraseCopy}>
        <ThemedText type="title">{phrase.greek}</ThemedText>
        <ThemedText type="callout" themeColor="textSecondary">
          {phrase.meaning}
        </ThemedText>
      </View>
      {phrase.audioId && playback ? (
        <PronunciationControl
          audioId={phrase.audioId}
          error={playback.error}
          onPlay={onPlay}
          phrase={phrase.greek}
          status={playback.status}
        />
      ) : null}
      <View style={styles.phraseFooter}>
        <ThemedText type="caption" themeColor="textTertiary">
          FROM · {phrase.lessonTitle.toUpperCase()}
        </ThemedText>
        <GlideButton label="Practice in lesson" variant="tertiary" onPress={onPractice} />
      </View>
    </GlideSurface>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 560 },
  reviewCard: { gap: Spacing.twoHalf },
  library: { gap: Spacing.three },
  sectionHeading: { gap: Spacing.one },
  phraseCard: { gap: Spacing.three },
  phraseCopy: { gap: Spacing.one },
  phraseFooter: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'space-between' },
  empty: { gap: Spacing.two },
});
