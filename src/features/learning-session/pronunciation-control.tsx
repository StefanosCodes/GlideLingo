import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { type AudioClipId } from '@/constants/catalog';
import { Radii, Spacing } from '@/constants/theme';
import { type PronunciationStatus } from '@/features/learning-session/audio/use-pronunciation-player';
import { useTheme } from '@/hooks/use-theme';

const STATUS_LABEL: Record<PronunciationStatus, string> = {
  idle: 'Play',
  loading: 'Loading…',
  playing: 'Playing',
  error: 'Retry',
};

export function PronunciationControl({
  audioId,
  phrase,
  status,
  error,
  onPlay,
}: {
  audioId: AudioClipId;
  phrase: string;
  status: PronunciationStatus;
  error: string | null;
  onPlay: (audioId: AudioClipId) => void;
}) {
  const theme = useTheme();
  const label = STATUS_LABEL[status];

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityLabel={`${status === 'error' ? 'Retry' : 'Play'} pronunciation: ${phrase}`}
        accessibilityRole="button"
        accessibilityState={{ busy: status === 'loading' }}
        onPress={() => onPlay(audioId)}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: theme.tint,
            opacity: pressed ? 0.62 : 1,
          },
        ]}>
        <ThemedText type="headline" themeColor="textInverse">
          {status === 'playing' ? '◼︎' : '▶'} {label}
        </ThemedText>
      </Pressable>
      {error ? (
        <ThemedText accessibilityRole="alert" type="footnote" style={{ color: theme.danger }}>
          {error} Tap Retry.
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start', gap: Spacing.one, maxWidth: 320 },
  button: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: Spacing.three,
  },
});
