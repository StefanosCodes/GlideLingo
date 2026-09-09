import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { availableLessonsForModule, availableModulesForCourse, getCourse } from '@/constants/catalog';
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

  const availableLessonCount = course.modules.reduce(
    (sum, module) => sum + availableLessonsForModule(module).length,
    0,
  );
  const availableModuleCount = availableModulesForCourse(course).length;
  const plannedModuleCount = course.modules.length - availableModuleCount;
  const live = language.available && course.languageId === language.id && availableLessonCount > 0;
  const enrolled = enrolledCourse?.id === course.id;

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
          PLANNED COURSE OUTCOMES
        </ThemedText>
        {course.canDos.map((item) => (
          <ThemedText key={item} type="callout">
            {item}
          </ThemedText>
        ))}
        <ThemedText type="footnote" themeColor="textSecondary">
          These outcomes describe the roadmap. Only the authored content counted below is available now.
        </ThemedText>
      </GlideSurface>

      <GlideSurface padding="roomy" style={styles.block}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          STRUCTURE
        </ThemedText>
        <ThemedText type="title3">
          {availableModuleCount} authored {availableModuleCount === 1 ? 'unit' : 'units'} · {availableLessonCount} authored {availableLessonCount === 1 ? 'lesson' : 'lessons'}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {plannedModuleCount > 0
            ? `${plannedModuleCount} planned ${plannedModuleCount === 1 ? 'unit is' : 'units are'} not available. Future outlines cannot be started until their learning content is authored and reviewed.`
            : 'Each authored unit builds toward a real-world ability.'}
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
