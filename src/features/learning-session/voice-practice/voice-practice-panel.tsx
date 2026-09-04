import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { GlideSwitch } from '@/components/ui/glide-switch';
import { Radii, Spacing } from '@/constants/theme';
import type { VoiceSessionAdmission, VoiceSessionRecap } from '@/features/speak/model/voice-session';
import type { VoiceSessionState } from '@/features/speak/model/reducer';
import {
  currentVoiceRuntimeAvailability,
  type VoiceRuntimeAvailability,
} from '@/features/speak/voice-runtime-availability';
import { VoiceSessionController } from '@/features/speak/voice-session-controller';
import { useTheme } from '@/hooks/use-theme';

type VoiceController = {
  readonly snapshot: VoiceSessionState;
  start: (request: {
    course_id: string;
    scenario_id: string;
    conversation_mode: 'guided';
    source_locale: 'en';
    target_locale: 'el-GR';
    captions_enabled: boolean;
    retain_transcript: false;
    client_capabilities: ('audio' | 'captions' | 'interrupt' | 'reconnect')[];
  }) => Promise<VoiceSessionAdmission>;
  reconnect: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  end: (reason?: VoiceSessionRecap['end_reason']) => Promise<VoiceSessionRecap | null>;
};

export type VoiceControllerFactory = (
  onState: (state: VoiceSessionState) => void,
  captionsEnabled: boolean,
) => VoiceController;

const defaultControllerFactory: VoiceControllerFactory = (onState, captionsEnabled) =>
  new VoiceSessionController(onState, captionsEnabled);

const STATUS_COPY: Record<VoiceSessionState['lifecycle'], string> = {
  creating: 'Requesting microphone access…',
  connecting: 'Connecting to your sound coach…',
  active: 'Connected. Your microphone starts muted.',
  reconnecting: 'Connection paused. Your microphone is muted.',
  ending: 'Ending voice practice…',
  ended: 'Voice practice ended. This did not change lesson progress.',
  failed: 'Voice practice could not continue. Your lesson progress is unchanged.',
};

export function VoicePracticePanel({
  courseId,
  lessonTitle,
  onClose,
  scenarioId,
  controllerFactory = defaultControllerFactory,
  runtimeAvailability = currentVoiceRuntimeAvailability(),
}: {
  courseId: string;
  lessonTitle: string;
  onClose: () => void;
  scenarioId: string;
  controllerFactory?: VoiceControllerFactory;
  runtimeAvailability?: VoiceRuntimeAvailability;
}) {
  const theme = useTheme();
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [sessionState, setSessionState] = useState<VoiceSessionState | null>(null);
  const [operationError, setOperationError] = useState(false);
  const controllerRef = useRef<VoiceController | null>(null);
  const mountedRef = useRef(true);
  const web = Platform.OS === 'web';

  useEffect(
    () => () => {
      mountedRef.current = false;
      const controller = controllerRef.current;
      if (controller && controller.snapshot.lifecycle !== 'ended') {
        void controller.end('cancelled').catch(() => undefined);
      }
    },
    [],
  );

  const captionLines = useMemo(() => {
    if (!sessionState?.captionsEnabled) return [];
    const finals = sessionState.events.filter((event) => event.type === 'transcript.final').slice(-8);
    const partial = [...sessionState.events].reverse().find((event) => event.type === 'transcript.partial');
    return partial && partial.sequence > (finals.at(-1)?.sequence ?? 0) ? [...finals, partial] : finals;
  }, [sessionState]);

  function makeController() {
    const controller = controllerFactory(
      (state) => {
        if (mountedRef.current) setSessionState(state);
      },
      captionsEnabled,
    );
    controllerRef.current = controller;
    setSessionState(controller.snapshot);
    return controller;
  }

  async function start() {
    setOperationError(false);
    const previous = controllerRef.current;
    if (previous) {
      if (previous.snapshot.lifecycle !== 'failed' && previous.snapshot.lifecycle !== 'ended') return;
      if (previous.snapshot.lifecycle === 'failed') {
        try {
          await previous.end('failed');
        } catch {
          if (mountedRef.current) setOperationError(true);
          return;
        }
      }
    }
    const controller = makeController();
    try {
      await controller.start({
        course_id: courseId,
        scenario_id: scenarioId,
        conversation_mode: 'guided',
        source_locale: 'en',
        target_locale: 'el-GR',
        captions_enabled: captionsEnabled,
        retain_transcript: false,
        client_capabilities: ['audio', 'captions', 'interrupt', 'reconnect'],
      });
    } catch {
      if (mountedRef.current) setOperationError(true);
    }
  }

  async function reconnect() {
    setOperationError(false);
    try {
      await controllerRef.current?.reconnect();
    } catch {
      if (mountedRef.current) setOperationError(true);
    }
  }

  async function endPractice() {
    setOperationError(false);
    try {
      await controllerRef.current?.end('cancelled');
    } catch {
      if (mountedRef.current) setOperationError(true);
    }
  }

  function toggleMicrophone() {
    if (!sessionState || sessionState.lifecycle !== 'active') return;
    controllerRef.current?.setMuted(!sessionState.muted);
  }

  const unavailableCopy =
    runtimeAvailability === 'desktop-unavailable'
      ? 'Voice practice is not available in the desktop app yet. Continue this lesson here, or use GlideLingo in a supported web browser.'
      : 'Voice practice is not available on iOS or Android yet. Continue this lesson without it.';

  return (
    <View
      accessibilityLabel="Voice practice"
      style={[
        web ? styles.column : styles.sheet,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}>
      <View style={[styles.header, { borderBottomColor: theme.separator }]}>
        <View style={styles.headerCopy}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            OPTIONAL VOICE PRACTICE
          </ThemedText>
          <ThemedText type="headline" numberOfLines={1}>
            {lessonTitle}
          </ThemedText>
        </View>
        <Pressable
          accessibilityLabel="Close voice practice"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onClose}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Close
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {runtimeAvailability !== 'available' ? (
          <View accessibilityRole="alert" style={styles.stack}>
            <ThemedText type="title3">Voice stays off on this platform.</ThemedText>
            <ThemedText type="callout" themeColor="textSecondary">
              {unavailableCopy}
            </ThemedText>
          </View>
        ) : sessionState === null ? (
          <View style={styles.stack}>
            <ThemedText type="callout" themeColor="textSecondary">
              Practice the lesson’s three vowel sounds with a short guided conversation. Your browser will ask before using the microphone.
            </ThemedText>
            <GlideSurface padding="compact" variant="grouped" style={styles.captionSetting}>
              <View style={styles.settingCopy}>
                <ThemedText type="headline">Live captions</ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Captions are not added to your learning record.
                </ThemedText>
              </View>
              <GlideSwitch
                accessibilityLabel="Live captions"
                onValueChange={setCaptionsEnabled}
                value={captionsEnabled}
              />
            </GlideSurface>
            <GlideButton fullWidth label="Start voice practice" onPress={() => void start()} />
          </View>
        ) : (
          <View style={styles.stack}>
            <View accessibilityLiveRegion="polite" style={styles.status}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      sessionState.lifecycle === 'active'
                        ? theme.success
                        : sessionState.lifecycle === 'failed'
                          ? theme.danger
                          : theme.warning,
                  },
                ]}
              />
              <ThemedText type="callout">{STATUS_COPY[sessionState.lifecycle]}</ThemedText>
            </View>

            {sessionState.lifecycle === 'active' ? (
              <>
                <ThemedText type="footnote" themeColor="textSecondary">
                  Captions {sessionState.captionsEnabled ? 'on' : 'off'} · {sessionState.muted ? 'Microphone muted' : 'Listening'}
                </ThemedText>
                {sessionState.captionsEnabled ? (
                  <GlideSurface
                    accessibilityLabel="Live voice captions"
                    accessibilityLiveRegion="polite"
                    padding="regular"
                    variant="grouped"
                    style={styles.captions}>
                    {captionLines.length ? (
                      captionLines.map((line) => (
                        <ThemedText key={line.event_id} type="callout">
                          {line.speaker === 'learner' ? 'You' : 'Coach'}: {line.text}
                        </ThemedText>
                      ))
                    ) : (
                      <ThemedText type="callout" themeColor="textSecondary">
                        Captions will appear after speech is detected.
                      </ThemedText>
                    )}
                  </GlideSurface>
                ) : null}
                <GlideButton
                  fullWidth
                  label={sessionState.muted ? 'Start talking' : 'Stop talking'}
                  onPress={toggleMicrophone}
                />
                <GlideButton
                  fullWidth
                  label="End voice practice"
                  onPress={() => void endPractice()}
                  variant="secondary"
                />
              </>
            ) : null}

            {sessionState.lifecycle === 'reconnecting' ? (
              <GlideButton fullWidth label="Retry connection" onPress={() => void reconnect()} />
            ) : null}

            {sessionState.lifecycle === 'failed' ? (
              <GlideButton fullWidth label="Retry voice practice" onPress={() => void start()} />
            ) : null}

            {sessionState.lifecycle === 'ended' ? (
              <GlideButton fullWidth label="Practice again" onPress={() => void start()} variant="secondary" />
            ) : null}

            {operationError ? (
              <ThemedText accessibilityRole="alert" type="footnote" style={{ color: theme.danger }}>
                Check your microphone permission and connection, then retry. Your lesson progress is safe.
              </ThemedText>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
    height: '100%',
    width: 360,
  },
  sheet: {
    borderTopLeftRadius: Radii.large,
    borderTopRightRadius: Radii.large,
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    height: '56%',
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
  content: { flexGrow: 1, padding: Spacing.three },
  stack: { gap: Spacing.three },
  captionSetting: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  settingCopy: { flex: 1, gap: Spacing.half },
  status: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  statusDot: { borderRadius: Radii.capsule, height: 8, width: 8 },
  captions: { gap: Spacing.two, minHeight: 88 },
});
