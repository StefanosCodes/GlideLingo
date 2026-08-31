import { Platform, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';

import { ModuleTree } from '@/components/module-tree';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { useLearning } from '@/providers/learning-provider';

export default function PathScreen() {
  const router = useRouter();
  const { language, courses, enrolledCourse } = useLearning();

  if (Platform.OS === 'web') {
    return <Redirect href="/" />;
  }

  if (!language.available) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            COURSES · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">No live course yet.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            {language.name} is in the picker so you can rotate languages. Greek is the course that actually teaches.
          </ThemedText>
        </View>
      </ScreenFrame>
    );
  }

  if (!enrolledCourse) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            COURSES · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">Choose a course, then start it.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Preview the path before you enroll. Nothing is generated when you tap Start.
          </ThemedText>
        </View>
        {courses.map((course) => (
          <GlideSurface key={course.id} padding="roomy" style={styles.courseCard}>
            <ThemedText type="eyebrow" themeColor="textSecondary">
              {course.levelLabel} · {course.modules.length} MODULES
            </ThemedText>
            <ThemedText type="title2">{course.title}</ThemedText>
            <ThemedText type="callout" themeColor="textSecondary">
              {course.summary}
            </ThemedText>
            <GlideButton label="Preview" onPress={() => router.push(`/course/${course.id}`)} />
          </GlideSurface>
        ))}
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          PATH · {enrolledCourse.title.toUpperCase()}
        </ThemedText>
        <ThemedText type="display">{enrolledCourse.modules.length} modules to a first conversation.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          {enrolledCourse.summary}
        </ThemedText>
      </View>
      <ModuleTree density="page" />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 520 },
  courseCard: { gap: Spacing.two },
});
