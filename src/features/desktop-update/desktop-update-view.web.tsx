import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useDesktopUpdate } from './context';
import type { DesktopUpdateContextValue, DesktopUpdateSnapshot } from './types';

export function DesktopUpdatePrompt({ value }: { value: DesktopUpdateContextValue }) {
  const theme = useTheme();
  const { snapshot } = value;
  if (!snapshot || value.lessonActive) return null;

  const showRequired = snapshot.required;
  const showOptionalReady = snapshot.phase === 'ready' && !value.readyPromptDismissed;
  if (!showRequired && !showOptionalReady) return null;

  return (
    <Modal
      animationType="fade"
      onRequestClose={showRequired ? () => undefined : value.dismissReadyPrompt}
      presentationStyle="overFullScreen"
      testID="desktop-update-modal"
      transparent
      visible>
      <View
        accessibilityViewIsModal
        style={[styles.overlay, { backgroundColor: theme.shadow }]}
        testID={showRequired ? 'desktop-update-required' : 'desktop-update-ready'}>
        <View style={[styles.prompt, { backgroundColor: theme.surface, borderColor: theme.border }, Shadows.floating]}>
          <ThemedText type="title2">
            {showRequired ? 'GlideLingo needs an update' : 'Update ready'}
          </ThemedText>
          <ThemedText type="body" themeColor="textSecondary">
            {requiredMessage(snapshot)}
          </ThemedText>

          {(snapshot.phase === 'checking' || snapshot.phase === 'downloading') && (
            <View accessibilityLiveRegion="polite" style={styles.progressGroup}>
              <ThemedText type="footnote" themeColor="textSecondary">
                {snapshot.phase === 'checking' ? 'Checking for the required update…' : `Downloading… ${Math.round(snapshot.percent)}%`}
              </ThemedText>
              <ProgressBar
                accessibilityLabel={`GlideLingo update ${Math.round(snapshot.percent)} percent downloaded`}
                color={theme.accentStrong}
                value={snapshot.percent / 100}
              />
            </View>
          )}

          <View style={styles.actions}>
            {snapshot.phase === 'ready' && (
              <GlideButton label="Restart and update" onPress={value.restartAndInstall} />
            )}
            {snapshot.phase === 'error' && (
              <GlideButton label="Retry" onPress={value.retry} />
            )}
            {showOptionalReady && (
              <GlideButton label="Later" onPress={value.dismissReadyPrompt} variant="secondary" />
            )}
            {showRequired && (
              <>
                <GlideButton
                  label="Download GlideLingo"
                  onPress={value.openOfficialDownloadPage}
                  variant="secondary"
                />
                <GlideButton label="Quit" onPress={value.quit} variant="tertiary" />
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function requiredMessage(snapshot: DesktopUpdateSnapshot) {
  if (!snapshot.required) {
    return 'Restart GlideLingo to finish installing the update, or choose Later to keep working.';
  }
  if (snapshot.phase === 'ready') {
    return 'This version is no longer supported. Restart now to finish installing the required update.';
  }
  if (snapshot.phase === 'error') {
    return 'This version is no longer supported, and the update could not be completed. Retry or download the latest GlideLingo.';
  }
  return 'This version is no longer supported. GlideLingo is getting the required update ready.';
}

export function DesktopUpdateSidebarStatus({ collapsed }: { collapsed: boolean }) {
  const value = useDesktopUpdate();
  const theme = useTheme();
  const snapshot = value?.snapshot;
  if (!value || !snapshot || snapshot.required || snapshot.phase === 'idle') return null;

  const working = snapshot.phase === 'checking' || snapshot.phase === 'downloading';
  const label = snapshot.phase === 'ready'
    ? 'Restart to update'
    : snapshot.phase === 'error'
      ? 'Retry update'
      : snapshot.phase === 'checking'
        ? 'Checking for update'
        : `Downloading update ${Math.round(snapshot.percent)}%`;
  const action = snapshot.phase === 'ready'
    ? value.restartAndInstall
    : snapshot.phase === 'error'
      ? value.retry
      : undefined;

  if (collapsed) {
    return (
      <Pressable
        accessibilityLabel={label}
        accessibilityRole={action ? 'button' : 'progressbar'}
        disabled={!action}
        onPress={action}
        style={({ pressed, hovered }) => [
          styles.collapsedStatus,
          { backgroundColor: pressed || hovered ? theme.backgroundSelected : 'transparent' },
        ]}>
        <ThemedText aria-hidden type="headline" themeColor={snapshot.phase === 'error' ? 'danger' : 'textSecondary'}>
          {snapshot.phase === 'ready' ? '↻' : snapshot.phase === 'error' ? '!' : '↓'}
        </ThemedText>
        {working && (
          <View style={[styles.collapsedTrack, { backgroundColor: theme.surfaceSecondary }]}>
            <View
              style={[
                styles.collapsedFill,
                { backgroundColor: theme.accentStrong, width: `${snapshot.phase === 'checking' ? 20 : snapshot.percent}%` },
              ]}
            />
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.sidebarStatus, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {!action && (
        <ThemedText type="footnote" themeColor={snapshot.phase === 'error' ? 'danger' : 'textSecondary'}>
          {label}
        </ThemedText>
      )}
      {working && (
        <ProgressBar
          accessibilityLabel={label}
          color={theme.accentStrong}
          value={(snapshot.phase === 'checking' ? 0 : snapshot.percent) / 100}
        />
      )}
      {action && (
        <GlideButton label={label} onPress={action} size="regular" variant="tertiary" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  collapsedFill: { height: '100%', borderRadius: Radii.capsule },
  collapsedStatus: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    cursor: 'pointer',
    gap: Spacing.one,
    justifyContent: 'center',
    minHeight: 44,
    width: 44,
  },
  collapsedTrack: { borderRadius: Radii.capsule, height: 3, overflow: 'hidden', width: 28 },
  overlay: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: Spacing.threeHalf,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1000,
  },
  progressGroup: { gap: Spacing.two },
  prompt: {
    borderRadius: Radii.large,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    maxWidth: 520,
    padding: Spacing.four,
    width: '100%',
  },
  sidebarStatus: {
    borderRadius: Radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    marginBottom: Spacing.two,
    padding: Spacing.two,
  },
});
