import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { LessonLectureView } from '@/features/learning-session/lesson-lecture-view';
import { ListRow } from '@/components/list-row';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { ProgressBar } from '@/components/ui/progress-bar';
import { getModule, moduleStatus } from '@/constants/catalog';
import { Spacing } from '@/constants/theme';
import { useLearning } from '@/providers/learning-provider';

export default function TodayScreen() {
  const router = useRouter();
  const {
    language,
    enrolledCourse,
    currentModule,
    nextLesson,
    focusedModuleId,
    activeLessonId,
    completedModuleIds,
    progress,
    courses,
    setLanguage,
    openLesson,
  } = useLearning();
  const catalogCourse = enrolledCourse ?? courses[0] ?? null;
  const percent = Math.round(progress * 100);

  if (!language.available || !catalogCourse) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            TODAY · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">{language.name} isn’t open yet.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            The catalog is listed so you can switch back to Greek. No generated lessons, no fake path.
          </ThemedText>
        </View>
        <GlideButton
          label="Back to Greek"
          onPress={() => setLanguage('el')}
          testID="start-lesson"
        />
      </ScreenFrame>
    );
  }

  if (!enrolledCourse) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            TODAY · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">Start with a course, not a chat.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Preview {catalogCourse.title}, then begin the first module. Today will hold the next lesson after you start.
          </ThemedText>
        </View>
        <GlideSurface padding="roomy" style={styles.lessonCard}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            COURSE · {catalogCourse.levelLabel}
          </ThemedText>
          <ThemedText type="title">{catalogCourse.title}</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            {catalogCourse.summary}
          </ThemedText>
          <GlideButton
            fullWidth
            label="Preview course"
            onPress={() => router.push(`/course/${catalogCourse.id}`)}
            testID="start-lesson"
          />
        </GlideSurface>
      </ScreenFrame>
    );
  }

  if (activeLessonId) {
    return <LessonLectureView lessonId={activeLessonId} onClose={() => openLesson(null)} />;
  }

  const lesson = nextLesson?.lesson;
  const module = currentModule ?? nextLesson?.module;
  const focused = focusedModuleId ? getModule(enrolledCourse, focusedModuleId) : null;

  if (focused) {
    const index = enrolledCourse.modules.findIndex((item) => item.id === focused.id);
    const status = moduleStatus(enrolledCourse, focused.id, completedModuleIds);
    const previous = index > 0 ? enrolledCourse.modules[index - 1] : null;

    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            MODULE {String(index + 1).padStart(2, '0')} · {enrolledCourse.title.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">{focused.title}</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            {focused.canDo}
          </ThemedText>
        </View>

        <GlideSurface padding="none">
          {focused.lessons.map((item, lessonIndex) => (
            <ListRow
              key={item.id}
              detail={`${item.durationMin} min`}
              label={item.title}
              last={lessonIndex === focused.lessons.length - 1}
              onPress={() => openLesson(item.id)}
            />
          ))}
        </GlideSurface>

        {status === 'current' && lesson ? (
          <GlideButton
            fullWidth
            label="Start today’s lesson"
            onPress={() => openLesson(lesson.id)}
            testID="start-lesson"
          />
        ) : (
          <ThemedText type="footnote" themeColor="textSecondary">
            {status === 'complete'
              ? 'Done. This module is already behind you.'
              : previous
                ? `Upcoming · after ${previous.title}.`
                : 'This module is next in the path.'}
          </ThemedText>
        )}
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          TODAY · {language.name.toUpperCase()} · {enrolledCourse.levelLabel}
        </ThemedText>
        <ThemedText type="display">Keep the language moving.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          The next lesson in {enrolledCourse.title}. One sitting.
        </ThemedText>
      </View>

      <GlideSurface padding="roomy" style={styles.lessonCard}>
        <View style={styles.metaRow}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            {module ? module.title.toUpperCase() : 'COURSE COMPLETE'}
          </ThemedText>
          {lesson ? (
            <ThemedText type="caption" themeColor="textTertiary">
              {lesson.durationMin} MIN
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.lessonCopy}>
          <ThemedText type="title">{lesson?.title ?? 'You’ve finished this course'}</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            {module?.canDo ?? 'Start another language when it opens, or review what you can already do.'}
          </ThemedText>
        </View>

        <View style={styles.progressBlock}>
          <View style={styles.progressLabels}>
            <ThemedText type="footnote">{enrolledCourse.title}</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {percent}%
            </ThemedText>
          </View>
          <ProgressBar value={progress} />
        </View>

        {lesson ? (
          <GlideButton
            fullWidth
            label="Start today’s lesson"
            onPress={() => openLesson(lesson.id)}
            testID="start-lesson"
          />
        ) : (
          <GlideButton fullWidth label="See what you can do" onPress={() => router.push('/progress')} testID="start-lesson" />
        )}
      </GlideSurface>

      <View style={styles.sectionHeading}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          ALSO TODAY
        </ThemedText>
        <ThemedText type="title2">After the lesson</ThemedText>
      </View>

      <GlideSurface padding="none">
        <ListRow
          detail="Nothing due yet · starts after this lesson"
          icon={{ ios: 'arrow.clockwise', android: 'replay', web: 'replay' }}
          label="Review"
          last
          onPress={() => router.push('/review')}
        />
      </GlideSurface>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 480 },
  lessonCard: { gap: Spacing.threeHalf },
  metaRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  lessonCopy: { gap: Spacing.two, maxWidth: 520 },
  progressBlock: { gap: Spacing.two },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  sectionHeading: { gap: Spacing.one },
});
