import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LessonAskDrawer } from '@/features/learning-session/lesson-ask-drawer';
import { LessonBlocks } from '@/features/learning-session/lesson-blocks';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GlideButton } from '@/components/ui/glide-button';
import { findLesson } from '@/constants/catalog';
import { Fonts, MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function LessonLectureView({
  lessonId,
  onClose,
}: {
  lessonId: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const found = findLesson(lessonId);
  const [askOpen, setAskOpen] = useState(false);
  const web = Platform.OS === 'web';
  const top = web ? Spacing.four : insets.top + Spacing.two;

  return (
    <ThemedView style={styles.screen}>
      <View style={[styles.chrome, { paddingTop: top }]}>
        <ScreenHeader />
      </View>

      <View style={styles.body}>
        <ScrollView
          contentContainerStyle={[
            styles.article,
            { paddingBottom: insets.bottom + Spacing.six },
          ]}
          showsVerticalScrollIndicator={false}>
          <Pressable accessibilityLabel="Back to today" accessibilityRole="button" onPress={onClose} style={styles.back}>
            <ThemedText type="footnote" themeColor="textSecondary">
              ← Back to today
            </ThemedText>
          </Pressable>

          {!found ? (
            <ThemedText type="title">Lesson not found</ThemedText>
          ) : (
            <>
              <View style={styles.intro}>
                <ThemedText type="eyebrow" themeColor="textSecondary">
                  {found.module.title.toUpperCase()} · {found.lesson.durationMin} MIN
                </ThemedText>
                <View style={styles.titleRow}>
                  <ThemedText type="display" style={styles.title}>
                    {found.lesson.title}
                  </ThemedText>
                  <Pressable
                    accessibilityLabel={askOpen ? 'Close ask panel' : 'Ask about this lesson'}
                    accessibilityRole="button"
                    accessibilityState={{ selected: askOpen }}
                    onPress={() => setAskOpen((value) => !value)}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.askToggle,
                      {
                        backgroundColor: askOpen || pressed || hovered ? theme.backgroundSelected : 'transparent',
                        borderColor: theme.border,
                      },
                    ]}>
                    <ThemedText
                      type="footnote"
                      themeColor={askOpen ? 'text' : 'textSecondary'}
                      style={styles.askToggleText}>
                      {askOpen ? '✕ Asking' : 'Ask'}
                    </ThemedText>
                  </Pressable>
                </View>
                <ThemedText type="body" themeColor="textSecondary">
                  {found.module.canDo}
                </ThemedText>
              </View>

              {found.lesson.blocks?.length ? (
                <LessonBlocks blocks={found.lesson.blocks} />
              ) : (
                <ThemedText type="body" themeColor="textSecondary">
                  This sitting is listed on the path. The readable page has not been authored yet.
                </ThemedText>
              )}

              <GlideButton label="Back to today" onPress={onClose} style={styles.footerAction} />
            </>
          )}
        </ScrollView>

        {askOpen && web && found ? (
          <LessonAskDrawer lessonTitle={found.lesson.title} onClose={() => setAskOpen(false)} />
        ) : null}
      </View>

      {askOpen && !web && found ? (
        <LessonAskDrawer lessonTitle={found.lesson.title} onClose={() => setAskOpen(false)} />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chrome: {
    overflow: 'visible',
    paddingHorizontal: Spacing.threeHalf,
    zIndex: 20,
  },
  body: { flex: 1, flexDirection: 'row' },
  article: {
    alignSelf: 'center',
    gap: Spacing.five,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.threeHalf,
    paddingTop: Spacing.three,
    width: '100%',
  },
  back: {
    alignSelf: 'flex-start',
    borderRadius: Radii.small,
    justifyContent: 'center',
    minHeight: 36,
    paddingVertical: Spacing.one,
  },
  intro: { gap: Spacing.two },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: Spacing.three, justifyContent: 'space-between' },
  title: { flex: 1 },
  askToggle: {
    alignItems: 'center',
    borderRadius: Radii.capsule,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
  },
  askToggleText: { fontFamily: Fonts.sansMedium },
  footerAction: { alignSelf: 'flex-start' },
});
