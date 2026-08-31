import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { useLearning } from '@/providers/learning-provider';

export default function ReviewScreen() {
  const router = useRouter();
  const { language, enrolledCourse, currentModule } = useLearning();

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          REVIEW · {language.name.toUpperCase()}
        </ThemedText>
        <ThemedText type="display">Return to what needs to stick.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Due phrases, weak sounds, and delayed checks will collect here after you practice.
        </ThemedText>
      </View>

      <GlideSurface padding="roomy" style={styles.empty}>
        <ThemedText type="title2">Nothing is due yet</ThemedText>
        <ThemedText type="callout" themeColor="textSecondary">
          {enrolledCourse && currentModule
            ? `Finish ${currentModule.title} and this queue will fill from what you actually said and missed.`
            : language.available
              ? 'Start a course first. Review follows lessons, it does not replace them.'
              : `${language.name} is not open yet. Switch back to Greek to learn.`}
        </ThemedText>
        {!enrolledCourse && language.available ? (
          <GlideButton label="See courses" onPress={() => router.push('/')} />
        ) : null}
      </GlideSurface>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 520 },
  empty: { gap: Spacing.two },
});
