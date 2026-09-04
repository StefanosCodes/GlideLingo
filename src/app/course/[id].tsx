import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { getCourse, isLessonAvailable } from '@/constants/catalog';
import { Spacing } from '@/constants/theme';
import { useLearning } from '@/providers/learning-provider';

export default function CoursePreviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { language, startCourse, enrolledCourse } = useLearning();
  const course = id ? getCourse(id) : null;

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/');
  }

  if (!course) {
    return (
      <ScreenFrame>
        <Pressable accessibilityRole="button" onPress={goBack} style={styles.back}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Back
          </ThemedText>
        </Pressable>
        <ThemedText type="title">Course not found</ThemedText>
      </ScreenFrame>
    );
  }

  const live = language.available && course.languageId === language.id;
  const enrolled = enrolledCourse?.id === course.id;
  const availableLessonCount = course.modules.reduce(
    (sum, module) => sum + module.lessons.filter(isLessonAvailable).length,
    0,
  );

  return (
    <ScreenFrame>
      <Pressable accessibilityLabel="Back" accessibilityRole="button" onPress={goBack} style={styles.back}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Back
        </ThemedText>
      </Pressable>

      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          COURSE · {course.levelLabel}
        </ThemedText>
        <ThemedText type="display">{course.title}</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          {course.summary}
        </ThemedText>
      </View>

      <GlideSurface padding="roomy" style={styles.block}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          YOU WILL BE ABLE TO
        </ThemedText>
        {course.canDos.map((item) => (
          <ThemedText key={item} type="callout">
            {item}
          </ThemedText>
        ))}
      </GlideSurface>

      <GlideSurface padding="roomy" style={styles.block}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          STRUCTURE
        </ThemedText>
        <ThemedText type="title3">
          {course.modules.length} units · {availableLessonCount} available {availableLessonCount === 1 ? 'lesson' : 'lessons'}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          Each unit builds toward a real-world ability. Future lesson outlines remain unavailable until their
          learning content is authored and reviewed.
        </ThemedText>
      </GlideSurface>

      {live ? (
        <GlideButton
          fullWidth
          label={enrolled ? 'Continue course' : 'Start course'}
          onPress={() => {
            if (!enrolled) startCourse(course.id);
            router.replace('/');
          }}
        />
      ) : (
        <ThemedText type="footnote" themeColor="textSecondary">
          Switch the language in the header to Greek to start this course.
        </ThemedText>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44 },
  intro: { gap: Spacing.two },
  introCopy: { maxWidth: 520 },
  block: { gap: Spacing.two },
});
