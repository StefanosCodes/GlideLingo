import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PromptComposer, PromptMessage, ThinkingBar } from '@/components/prompt-kit-native';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ChatLine =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string }
  | { id: string; role: 'thinking' };

const HONEST_REPLY =
  'The tutor is not wired yet. The lesson on the left is the material. Ask again when answers can follow that page.';

export function LessonAskDrawer({
  lessonTitle,
  onClose,
}: {
  lessonTitle: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [lines, setLines] = useState<ChatLine[]>([]);
  const web = Platform.OS === 'web';

  function send() {
    const text = draft.trim();
    if (!text) return;
    const userId = `u-${Date.now()}`;
    const thinkId = `t-${Date.now()}`;
    setDraft('');
    setLines((current) => [...current, { id: userId, role: 'user', text }, { id: thinkId, role: 'thinking' }]);
    setTimeout(() => {
      setLines((current) => [
        ...current.filter((line) => line.id !== thinkId),
        { id: `a-${Date.now()}`, role: 'assistant', text: HONEST_REPLY },
      ]);
    }, 500);
  }

  return (
    <View
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
        <Pressable accessibilityLabel="Close ask panel" accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Close
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.thread} showsVerticalScrollIndicator={false}>
        {lines.length === 0 ? (
          <ThemedText type="callout" themeColor="textSecondary">
            Questions stay beside the page. They do not replace it.
          </ThemedText>
        ) : (
          lines.map((line) =>
            line.role === 'thinking' ? (
              <ThinkingBar key={line.id} text="Looking at this lesson" />
            ) : (
              <PromptMessage key={line.id} role={line.role}>
                {line.text}
              </PromptMessage>
            ),
          )
        )}
      </ScrollView>

      <View style={[styles.composerWrap, { borderTopColor: theme.separator }]}>
        <PromptComposer
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
    height: '52%',
    width: '100%',
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
  composerWrap: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.two },
});
