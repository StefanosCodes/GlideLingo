import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ProgressBar } from '@/components/ui/progress-bar';
import { findLesson, nextLesson } from '@/constants/catalog';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { CheckBeat, DoneBeat, HearBeat, NoticeBeat } from '@/features/learning-session/sitting-beats';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

export function LessonSittingView({
  lessonId,
  onClose,
}: {
  lessonId: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { enrolledCourse, completedLessonIds, completeLesson, openLesson } = useLearning();
  const found = findLesson(lessonId);
  const beats = found?.lesson.beats ?? [];
  const total = Math.max(beats.length, 1);
  const following = enrolledCourse
    ? nextLesson(enrolledCourse, completedLessonIds.includes(lessonId) ? completedLessonIds : [...completedLessonIds, lessonId])
    : null;
  const [step, setStep] = useState(0);
  const web = Platform.OS === 'web';
  const top = web ? Spacing.three : insets.top + Spacing.two;
  const done = beats.length > 0 && step >= beats.length;
  const beat = !done ? beats[step] : undefined;
  const progress = done || beats.length === 0 ? 1 : step / total;

  function advance() {
    setStep((current) => current + 1);
  }

  function finishAndOpenNext() {
    completeLesson(lessonId);
    if (following?.lesson) {
      openLesson(following.lesson.id);
      return;
    }
    onClose();
  }

  function finishAndToday() {
    completeLesson(lessonId);
    onClose();
  }

  return (
    <ThemedView style={styles.screen}>
      <View style={[styles.chrome, { paddingTop: top, borderBottomColor: theme.separator }]}>
        <Pressable
          accessibilityLabel="Leave sitting"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onClose}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.close,
            { backgroundColor: pressed || hovered ? theme.backgroundSelected : 'transparent' },
          ]}>
          <ThemedText type="title3" themeColor="textSecondary">
            ✕
          </ThemedText>
        </Pressable>
        <ProgressBar style={styles.bar} value={progress} />
        <ThemedText type="caption" themeColor="textTertiary" style={styles.count}>
          {beats.length ? `${Math.min(step + 1, total)} / ${total}` : '—'}
        </ThemedText>
      </View>

      <View style={[styles.body, { paddingBottom: insets.bottom + Spacing.four }]}>
        {!found ? (
          <ThemedText type="title">Lesson not found</ThemedText>
        ) : beats.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText type="eyebrow" themeColor="textSecondary">
              {found.module.title.toUpperCase()}
            </ThemedText>
            <ThemedText type="title">{found.lesson.title}</ThemedText>
            <ThemedText type="body" themeColor="textSecondary" style={styles.emptyCopy}>
              This sitting is listed on the path. The beats have not been authored yet.
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.textAction}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Leave
              </ThemedText>
            </Pressable>
          </View>
        ) : done ? (
          <DoneBeat
            nextTitle={following?.lesson.title ?? null}
            onNext={finishAndOpenNext}
            onToday={finishAndToday}
            summary="You can hear α, ε, and ι."
          />
        ) : beat?.type === 'hear' ? (
          <HearBeat key={step} beat={beat} onContinue={advance} />
        ) : beat?.type === 'notice' ? (
          <NoticeBeat key={step} text={beat.text} onContinue={advance} />
        ) : beat?.type === 'check' ? (
          <CheckBeat key={step} beat={beat} onContinue={advance} />
        ) : null}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chrome: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  close: {
    alignItems: 'center',
    borderRadius: Radii.small,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  bar: { flex: 1 },
  count: { fontFamily: Fonts.sansMedium, minWidth: 36, textAlign: 'right' },
  body: { flex: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four },
  emptyCopy: { maxWidth: 420, textAlign: 'center' },
  textAction: { justifyContent: 'center', minHeight: 44 },
});
