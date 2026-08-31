import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideSurface } from '@/components/ui/glide-surface';
import { type LessonBlock } from '@/constants/catalog';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { usePronunciationPlayer } from '@/features/learning-session/audio/use-pronunciation-player';
import { PronunciationControl } from '@/features/learning-session/pronunciation-control';
import { useTheme } from '@/hooks/use-theme';

export function LessonBlocks({ blocks }: { blocks: LessonBlock[] }) {
  const pronunciation = usePronunciationPlayer();

  return (
    <View style={styles.stack}>
      {blocks.map((block, index) => (
        <LessonBlockView key={`${block.type}-${index}`} block={block} pronunciation={pronunciation} />
      ))}
    </View>
  );
}

type PronunciationController = ReturnType<typeof usePronunciationPlayer>;

function LessonBlockView({
  block,
  pronunciation,
}: {
  block: LessonBlock;
  pronunciation: PronunciationController;
}) {
  const theme = useTheme();

  if (block.type === 'heading') {
    return (
      <ThemedText type="title2" style={styles.heading}>
        {block.text}
      </ThemedText>
    );
  }

  if (block.type === 'prose') {
    return (
      <ThemedText type="body" themeColor="textSecondary" style={styles.prose}>
        {block.text}
      </ThemedText>
    );
  }

  if (block.type === 'example') {
    const playback = block.audioId ? pronunciation.stateFor(block.audioId) : null;
    return (
      <View style={styles.example}>
        <View style={styles.exampleCopy}>
          <ThemedText type="title3" style={styles.greek}>
            {block.greek}
          </ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            {block.gloss}
          </ThemedText>
        </View>
        {block.audioId && playback ? (
          <PronunciationControl
            audioId={block.audioId}
            error={playback.error}
            onPlay={pronunciation.play}
            phrase={block.greek}
            status={playback.status}
          />
        ) : null}
      </View>
    );
  }

  if (block.type === 'callout') {
    return (
      <ThemedText type="footnote" themeColor="textSecondary" style={[styles.callout, { borderLeftColor: theme.separator }]}>
        {block.text}
      </ThemedText>
    );
  }

  if (block.type === 'listen') {
    const playback = pronunciation.stateFor(block.audioId);
    return (
      <GlideSurface padding="regular" style={styles.control}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          LISTEN
        </ThemedText>
        <ThemedText type="headline">{block.label}</ThemedText>
        <PronunciationControl
          audioId={block.audioId}
          error={playback.error}
          onPlay={pronunciation.play}
          phrase={block.label}
          status={playback.status}
        />
      </GlideSurface>
    );
  }

  return <CheckBlock prompt={block.prompt} choices={block.choices} answer={block.answer} />;
}

function CheckBlock({ prompt, choices, answer }: { prompt: string; choices: string[]; answer: string }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <GlideSurface padding="regular" style={styles.control}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        CHECK
      </ThemedText>
      <ThemedText type="headline">{prompt}</ThemedText>
      <View style={styles.choices}>
        {choices.map((choice) => {
          const selected = picked === choice;
          const correct = picked !== null && choice === answer;
          const wrong = selected && choice !== answer;
          return (
            <Pressable
              key={choice}
              accessibilityLabel={choice}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setPicked(choice)}
              style={({ pressed }) => [
                styles.choice,
                {
                  backgroundColor: selected || pressed ? theme.backgroundSelected : theme.background,
                  borderColor: correct ? theme.success : wrong ? theme.danger : theme.border,
                },
              ]}>
              <ThemedText type="headline">{choice}</ThemedText>
            </Pressable>
          );
        })}
      </View>
      {picked ? (
        <ThemedText type="footnote" style={{ color: picked === answer ? theme.success : theme.danger }}>
          {picked === answer ? 'That’s it.' : 'Not that one. Look at the examples above again.'}
        </ThemedText>
      ) : null}
    </GlideSurface>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.four },
  heading: { paddingTop: Spacing.two },
  prose: { maxWidth: 560 },
  example: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    justifyContent: 'space-between',
  },
  exampleCopy: { flexGrow: 1, gap: Spacing.half, minWidth: 180 },
  greek: { fontFamily: Fonts.sansSemibold },
  callout: { borderLeftWidth: 2, maxWidth: 560, paddingLeft: Spacing.twoHalf },
  control: { gap: Spacing.two },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  choice: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
    justifyContent: 'center',
    minWidth: 56,
    paddingHorizontal: Spacing.three,
  },
});
