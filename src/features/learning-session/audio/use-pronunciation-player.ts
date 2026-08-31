import { useCallback, useRef, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { type AudioClipId } from '@/constants/catalog';
import { audioSources } from '@/features/learning-session/audio/audio-sources.generated';

export type PronunciationStatus = 'idle' | 'loading' | 'playing' | 'error';

export function usePronunciationPlayer() {
  const player = useAudioPlayer(null, { downloadFirst: true, updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const [activeId, setActiveId] = useState<AudioClipId | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const requestNumber = useRef(0);

  const play = useCallback(
    async (audioId: AudioClipId) => {
      const request = ++requestNumber.current;
      const source = audioSources[audioId];
      setActiveId(audioId);
      setLocalError(null);

      try {
        player.pause();
        if (!source) {
          player.replace(null);
          throw new Error('This pronunciation asset is unavailable.');
        }

        if (activeId === audioId && status.isLoaded) {
          await player.seekTo(0);
          if (request !== requestNumber.current) return;
        } else {
          player.replace(source);
        }
        player.play();
      } catch (error) {
        if (request === requestNumber.current) {
          setLocalError(error instanceof Error ? error.message : 'Audio playback failed.');
        }
      }
    },
    [activeId, player, status.isLoaded],
  );

  const stateFor = useCallback(
    (audioId: AudioClipId): { status: PronunciationStatus; error: string | null } => {
      if (activeId !== audioId) return { status: 'idle', error: null };
      const error = localError ?? status.error;
      if (error) return { status: 'error', error };
      if (status.playing) return { status: 'playing', error: null };
      if (status.isBuffering || !status.isLoaded) return { status: 'loading', error: null };
      return { status: 'idle', error: null };
    },
    [activeId, localError, status.error, status.isBuffering, status.isLoaded, status.playing],
  );

  return { play, stateFor };
}
