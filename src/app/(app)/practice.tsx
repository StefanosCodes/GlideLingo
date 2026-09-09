import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ListRow } from '@/components/list-row';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { LearningStateNotice } from '@/features/product-shell/learning-state-notice';
import { LettersPracticeScreen } from '@/features/product-shell/letters-practice';
import { PhrasesPracticeScreen } from '@/features/product-shell/phrases-practice';
import { useLearning } from '@/providers/learning-provider';

type PracticeMode = 'recommended' | 'review' | 'letters' | 'phrases';

function practiceMode(value: string | string[] | undefined): PracticeMode {
  const mode = Array.isArray(value) ? value[0] : value;
  return mode === 'review' || mode === 'letters' || mode === 'phrases' ? mode : 'recommended';
}

export default function PracticeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const mode = practiceMode(params.mode);
  const { language, enrolledCourse, reviewItems, openLesson, persistenceStatus } = useLearning();
  const dueReview = reviewItems.find((item) => item.due) ?? null;

  if (mode === 'letters') return <LettersPracticeScreen />;
  if (mode === 'phrases') return <PhrasesPracticeScreen />;

  function startReview() {
    if (!dueReview) return;
    openLesson(dueReview.lessonId, 'review');
    router.replace('/');
  }

  if (!enrolledCourse) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            PRACTICE · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">Start a course before you practice.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Practice only uses authored material from your selected course, so it never invents a review queue.
          </ThemedText>
        </View>
        <LearningStateNotice status={persistenceStatus} />
        <GlideButton label="Choose a course" onPress={() => router.push('/course')} />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          PRACTICE · {language.name.toUpperCase()}
        </ThemedText>
        <ThemedText type="display">Strengthen what you have learned.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Review comes from your attempt evidence. Browsing references does not count as completion.
        </ThemedText>
      </View>

      <LearningStateNotice status={persistenceStatus} />

      {dueReview ? (
        <GlideSurface padding="roomy" style={styles.primaryCard} variant="hero">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            RECOMMENDED · 1 FINITE CHECK
          </ThemedText>
          <ThemedText type="title2">{dueReview.capability.canDo}</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            {dueReview.reason}
          </ThemedText>
          <GlideButton fullWidth label="Start review" onPress={startReview} />
        </GlideSurface>
      ) : (
        <GlideSurface padding="roomy" style={styles.primaryCard} variant="success">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            REVIEW QUEUE CLEAR
          </ThemedText>
          <ThemedText type="title2">Nothing is due right now.</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            Your completed work remains intact. Optional reference practice is available below without invented urgency.
          </ThemedText>
        </GlideSurface>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            PRACTICE MODES
          </ThemedText>
          <ThemedText type="title2">Choose authored material</ThemedText>
        </View>
        <GlideSurface padding="none">
          <ListRow
            detail="Alphabet, sounds, and example words"
            icon={{ ios: 'textformat.abc', android: 'abc', web: 'abc' }}
            label="Letters & sounds"
            onPress={() => router.push({ pathname: '/practice', params: { mode: 'letters' } })}
          />
          <ListRow
            detail="Useful language from your current course"
            icon={{ ios: 'text.bubble', android: 'chat_bubble', web: 'chat_bubble' }}
            label="Vocabulary & phrases"
            last
            onPress={() => router.push({ pathname: '/practice', params: { mode: 'phrases' } })}
          />
        </GlideSurface>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 560 },
  primaryCard: { gap: Spacing.twoHalf },
  section: { gap: Spacing.three },
  sectionHeading: { gap: Spacing.one },
});
