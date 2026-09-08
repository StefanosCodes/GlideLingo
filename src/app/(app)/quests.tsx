import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ModuleTree } from '@/components/module-tree';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { useLearning } from '@/providers/learning-provider';

export default function QuestsScreen() {
  const router = useRouter();
  const { language, courses, enrolledCourse, currentModule, nextLesson, completedLessonIds, openLesson } = useLearning();

  if (!language.available) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            QUESTS · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">No quests are published yet.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Switch to an available course from the top-right menu. Unpublished languages never create placeholder quests.
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
            QUESTS · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">Choose the journey you want to begin.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Each quest ends in a concrete language ability. Preview the complete route before starting.
          </ThemedText>
        </View>
        {courses.map((course) => (
          <GlideSurface key={course.id} padding="roomy" style={styles.courseCard}>
            <ThemedText type="eyebrow" themeColor="textSecondary">
              {course.levelLabel} · {course.modules.length} QUESTS
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

  const currentQuest = currentModule ?? nextLesson?.module ?? null;
  const currentLesson = nextLesson?.lesson ?? null;
  const questDone = currentQuest
    ? currentQuest.lessons.filter((lesson) => completedLessonIds.includes(lesson.id)).length
    : 0;

  function beginLesson(lessonId: string) {
    openLesson(lessonId);
    router.replace('/');
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          QUESTS · {enrolledCourse.title.toUpperCase()}
        </ThemedText>
        <ThemedText type="display">{enrolledCourse.modules.length} quests to your first conversations.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Each quest has a visible finish: understand the pattern, practice it, then use it with less support.
        </ThemedText>
      </View>

      {currentQuest ? (
        <GlideSurface padding="roomy" style={styles.currentQuest} variant="tinted">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            CURRENT QUEST · {questDone} OF {currentQuest.lessons.length} LESSONS
          </ThemedText>
          <ThemedText type="title2">{currentQuest.title}</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            {currentQuest.canDo}
          </ThemedText>
          {currentLesson ? (
            <GlideButton label={`Continue · ${currentLesson.title}`} onPress={() => beginLesson(currentLesson.id)} />
          ) : null}
        </GlideSurface>
      ) : (
        <GlideSurface padding="roomy" style={styles.currentQuest} variant="success">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            COURSE PATH COMPLETE
          </ThemedText>
          <ThemedText type="title2">Every published quest is behind you.</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            Profile shows what your attempts demonstrated. Completion alone is not presented as mastery.
          </ThemedText>
        </GlideSurface>
      )}

      <View style={styles.questList}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            COURSE MAP
          </ThemedText>
          <ThemedText type="title2">All quests</ThemedText>
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
  currentQuest: { gap: Spacing.twoHalf },
  questList: { gap: Spacing.three },
  sectionHeading: { gap: Spacing.one },
});
