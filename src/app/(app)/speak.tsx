import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useBilling } from '@/providers/billing-provider';
import { useLearning } from '@/providers/learning-provider';

export default function SpeakScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { enrolledCourse, language } = useLearning();
  const { errorMessage, isPro, refresh, status } = useBilling();

  if (status === 'loading') {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            SPEAK · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">Preparing your speaking options.</ThemedText>
        </View>
        <GlideSurface accessibilityLabel="Loading speaking access" accessibilityState={{ busy: true }} padding="roomy" style={styles.loadingCard}>
          <View style={[styles.loadingLineWide, { backgroundColor: theme.backgroundSelected }]} />
          <View style={[styles.loadingLine, { backgroundColor: theme.backgroundSelected }]} />
          <View style={[styles.loadingButton, { backgroundColor: theme.backgroundSelected }]} />
        </GlideSurface>
      </ScreenFrame>
    );
  }

  if (status === 'error') {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            SPEAK · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">Speaking access could not be checked.</ThemedText>
          <ThemedText accessibilityRole="alert" type="body" themeColor="textSecondary" style={styles.introCopy}>
            {errorMessage ?? 'Your verified access is unavailable right now.'}
          </ThemedText>
        </View>
        <GlideButton label="Retry" onPress={() => void refresh()} />
      </ScreenFrame>
    );
  }

  if (!isPro) {
    return (
      <ScreenFrame>
        <View style={styles.intro}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            SPEAK · {language.name.toUpperCase()}
          </ThemedText>
          <ThemedText type="display">Speaking practice is still being prepared.</ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
            Your authored course and completed learning remain available while live speaking is unavailable.
          </ThemedText>
        </View>
        <GlideSurface accessibilityRole="alert" padding="roomy" style={styles.stateCard} variant="tinted">
          <ThemedText type="eyebrow" themeColor="textSecondary">
            VOICE RUNTIME UNAVAILABLE
          </ThemedText>
          <ThemedText type="title2">No speaking scenarios are available in this build.</ThemedText>
          <ThemedText type="callout" themeColor="textSecondary">
            Upgrading today will not enable speaking here. GlideLingo will check verified access when the feature is ready.
          </ThemedText>
          {enrolledCourse ? (
            <GlideButton label="Continue course" onPress={() => router.push('/course')} variant="secondary" />
          ) : (
            <GlideButton label="Choose a course" onPress={() => router.push('/course')} variant="secondary" />
          )}
        </GlideSurface>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          SPEAK · {language.name.toUpperCase()}
        </ThemedText>
        <ThemedText type="display">Practice a real conversation.</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Guided scenarios will stay bounded by your authored course and demonstrated level.
        </ThemedText>
      </View>
      <GlideSurface accessibilityRole="alert" padding="roomy" style={styles.stateCard}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          VOICE RUNTIME UNAVAILABLE
        </ThemedText>
        <ThemedText type="title2">No speaking scenarios are available in this build.</ThemedText>
        <ThemedText type="callout" themeColor="textSecondary">
          Your access is verified. Live speaking practice is still being prepared for this build.
        </ThemedText>
        {enrolledCourse ? (
          <GlideButton label="Continue course" onPress={() => router.push('/course')} variant="secondary" />
        ) : (
          <GlideButton label="Choose a course" onPress={() => router.push('/course')} variant="secondary" />
        )}
      </GlideSurface>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.two, paddingBottom: Spacing.one },
  introCopy: { maxWidth: 560 },
  stateCard: { gap: Spacing.twoHalf },
  loadingCard: { gap: Spacing.twoHalf },
  loadingLineWide: { borderRadius: 6, height: 24, width: '72%' },
  loadingLine: { borderRadius: 6, height: 18, width: '48%' },
  loadingButton: { borderRadius: 8, height: 44, width: 160 },
});
