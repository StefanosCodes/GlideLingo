import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PromptComposer, PromptMessage, ThinkingBar } from '@/components/prompt-kit-native';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { type LessonTutorState } from '@/features/learning-session/lesson-tutor/reducer';
import { useTheme } from '@/hooks/use-theme';

export function LessonAskDrawer({
  lessonTitle,
  onClose,
  onRetry,
  onSend,
  state,
}: {
  lessonTitle: string;
  onClose: () => void;
  onRetry: () => void;
  onSend: (message: string) => boolean;
  state: LessonTutorState;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const web = Platform.OS === 'web';

  function send() {
    if (onSend(draft)) setDraft('');
  }

  return (
    <View
      accessibilityLabel="Lesson tutor"
      style={[
        web ? styles.column : styles.sheet,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
      ]}>
      <View style={[styles.header, { borderBottomColor: theme.separator }]}>
        <View style={styles.headerCopy}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            ASK ABOUT THIS LESSON
          </ThemedText>
          <ThemedText type="headline" numberOfLines={1}>
            {lessonTitle}
          </ThemedText>
        </View>
        <Pressable
          accessibilityLabel="Close lesson tutor"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onClose}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Close
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.thread} showsVerticalScrollIndicator={false}>
        {state.messages.length === 0 ? (
          <ThemedText type="callout" themeColor="textSecondary">
            Ask about what you’re seeing. I’ll keep the lesson in view.
          </ThemedText>
        ) : (
          state.messages.map((line) => (
            <PromptMessage key={line.id} role={line.role}>
              {line.content}
            </PromptMessage>
          ))
        )}
        {state.status === 'working' ? (
          <View accessibilityLiveRegion="polite" accessibilityLabel="Looking at this step">
            <ThinkingBar text="Looking at this step." />
          </View>
        ) : null}
        {state.error ? (
          <View accessibilityLiveRegion="polite" style={styles.error}>
            <ThemedText type="footnote" themeColor="textSecondary">
              {state.error === 'retryable'
                ? 'The tutor didn’t return an answer. Retry safely checks the same request and won’t send it twice.'
                : 'We couldn’t safely retry that turn. Ask again as a new question.'}
            </ThemedText>
            {state.error === 'retryable' ? (
              <Pressable
                accessibilityLabel="Retry tutor message"
                accessibilityRole="button"
                onPress={onRetry}>
                <ThemedText type="footnote">Retry</ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.composerWrap, { borderTopColor: theme.separator }]}>
        <PromptComposer
          disabled={state.status === 'working'}
          onChangeText={setDraft}
          onSubmit={send}
          placeholder="Ask about this lesson"
          value={draft}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
    height: '100%',
    width: 340,
  },
  sheet: {
    borderTopLeftRadius: Radii.large,
    borderTopRightRadius: Radii.large,
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    height: '52%',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 10,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerCopy: { flex: 1, gap: 2 },
  thread: { flexGrow: 1, gap: Spacing.three, padding: Spacing.three },
  error: { gap: Spacing.two },
  composerWrap: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.two },
});
