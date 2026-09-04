import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ModuleTree } from '@/components/module-tree';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { LearningStateNotice } from '@/features/product-shell/learning-state-notice';
import { useLearning } from '@/providers/learning-provider';

export default function CourseScreen() {
  const router = useRouter();
  const {
    language,
    courses,
    enrolledCourse,
    currentModule,
    nextLesson,
    completedLessonIds,
    openLesson,
    persistenceStatus,
  } = useLearning();

  if (!language.available) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            COURSE · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">No course is published yet.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Switch to an available course from the course menu. Unpublished languages never create placeholder units.
          </ThemedText>
        </View>
        <LearningStateNotice status={persistenceStatus} />
      </ScreenFrame>
    );
  }

  if (!enrolledCourse) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            COURSE · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">Choose the journey you want to begin.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Each unit ends in a concrete language ability. Preview the complete route before starting.
          </ThemedText>
        </View>
        <LearningStateNotice status={persistenceStatus} />
        {courses.map((course) => (
          <GlideSurface key={course.id} padding="roomy" style={styles.courseCard}>
            <ThemedText type="eyebrow" themeColor="textSecondary">
              {course.levelLabel} · {course.modules.length} UNITS
            </ThemedText>
            <ThemedText type="title2">{course.title}</ThemedText>
            <ThemedText type="callout" themeColor="textSecondary">
              {course.summary}
            </ThemedText>
            <GlideButton label="Preview course" onPress={() => router.push(`/course/${course.id}`)} />
          </GlideSurface>
        ))}
      </ScreenFrame>
    );
  }

  const currentUnit = currentModule ?? nextLesson?.module ?? null;
  const currentLesson = nextLesson?.lesson ?? null;
  const unitDone = currentUnit
    ? currentUnit.lessons.filter((lesson) => completedLessonIds.includes(lesson.id)).length
    : 0;

  function beginLesson(lessonId: string) {
    openLesson(lessonId);
    router.replace('/');
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          COURSE · {enrolledCourse.title.toUpperCase()}
        </ThemedText>
        <ThemedText type="display">{enrolledCourse.modules.length} units to your first conversations.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Each unit has a visible outcome: understand the pattern, practice it, then use it with less support.
        </ThemedText>
      </View>

      <LearningStateNotice status={persistenceStatus} />

      {currentUnit ? (
        <GlideSurface padding="roomy" style={styles.currentUnit} variant="tinted">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            CURRENT UNIT · {unitDone} OF {currentUnit.lessons.length} LESSONS
          </ThemedText>
          <ThemedText type="title2">{currentUnit.title}</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            {currentUnit.canDo}
          </ThemedText>
          {currentLesson ? (
            <GlideButton label={`Continue lesson · ${currentLesson.title}`} onPress={() => beginLesson(currentLesson.id)} />
          ) : null}
        </GlideSurface>
      ) : (
        <GlideSurface padding="roomy" style={styles.currentUnit} variant="success">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            AVAILABLE LESSONS COMPLETE
          </ThemedText>
          <ThemedText type="title2">You have completed everything available today.</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            More lessons are still being authored. Progress shows only what your attempts demonstrated.
          </ThemedText>
        </GlideSurface>
      )}

      <View style={styles.unitList}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            COURSE PATH
          </ThemedText>
          <ThemedText type="title2">All units</ThemedText>
        </View>
        <ModuleTree density="page" onSelectLesson={beginLesson} />
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 560 },
  courseCard: { gap: Spacing.two },
  currentUnit: { gap: Spacing.twoHalf },
  unitList: { gap: Spacing.three },
  sectionHeading: { gap: Spacing.one },
});
