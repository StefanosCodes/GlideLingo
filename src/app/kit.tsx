import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  PromptComposer,
  PromptMessage,
  PromptSuggestion,
  ThinkingBar,
} from '@/components/prompt-kit-native';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSwitch } from '@/components/ui/glide-switch';
import { GlideSurface } from '@/components/ui/glide-surface';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme, useThemeController } from '@/hooks/use-theme';

const suggestionExamples = ['Make it simpler', 'Give me an example', 'Practice with me'];

export default function DesignKitScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { scheme, toggleTheme } = useThemeController();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);

  function submitPrompt() {
    const nextPrompt = prompt.trim();
    if (!nextPrompt) return;
    setSubmittedPrompt(nextPrompt);
    setPrompt('');
  }

  function goToToday() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/');
  }

  return (
    <ScreenFrame includeTabInset={false} chrome={false} contentStyle={styles.content}>
      <Pressable
        accessibilityLabel="Back to Today"
        accessibilityRole="button"
        onPress={goToToday}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Back to Today
        </ThemedText>
      </Pressable>

      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          SYSTEM 01 · EXPO
        </ThemedText>
        <ThemedText type="display">GlideLingo / Prompt Kit</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Living catalog of typography, color roles, controls, and Prompt Kit primitives. Product screens should look
          like this, not drift away from it.
        </ThemedText>
      </View>

      <Section title="Typography" detail="Inter carries the entire experience through size, weight, and spacing.">
        <GlideSurface padding="roomy" style={styles.typeStack}>
          <TypeSample label="DISPLAY · INTER SEMIBOLD" type="largeTitle">
            Speak with confidence.
          </TypeSample>
          <TypeSample label="SECTION · INTER SEMIBOLD" type="title2">
            Today’s practice
          </TypeSample>
          <TypeSample label="BODY · INTER REGULAR" type="body">
            Useful language, remembered for real life.
          </TypeSample>
          <TypeSample label="META · INTER MEDIUM" type="eyebrow">
            12 MIN · INTERMEDIATE
          </TypeSample>
        </GlideSurface>
      </Section>

      <Section title="Color roles" detail="Cool Zinc neutrals create hierarchy; color only communicates state.">
        <GlideSurface padding="none">
          <ColorRole color={theme.text} label="Foreground" value="Primary content and actions" />
          <ColorRole color={theme.surfaceSecondary} label="Fill" value="Grouped content" />
          <ColorRole color={theme.border} label="Line" value="Separation and structure" />
          <ColorRole color={theme.success} label="Ready" value="Confirmed progress" last />
        </GlideSurface>
      </Section>

      <Section title="Controls" detail="Branded actions stay consistent; platform switches stay native.">
        <GlideSurface padding="roomy" style={styles.controlStack}>
          <GlideButton fullWidth label="Primary action" onPress={() => {}} />
          <GlideButton fullWidth label="Secondary action" onPress={() => {}} variant="secondary" />
          <View style={[styles.controlRow, { borderTopColor: theme.separator }]}>
            <View style={styles.controlLabel}>
              <ThemedText type="headline">Dark appearance</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                Override the system appearance
              </ThemedText>
            </View>
            <GlideSwitch accessibilityLabel="Dark appearance" onValueChange={toggleTheme} value={scheme === 'dark'} />
          </View>
          <View style={[styles.controlRow, { borderTopColor: theme.separator }]}>
            <View style={styles.controlLabel}>
              <ThemedText type="headline">Lesson sounds</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                Native Expo UI control
              </ThemedText>
            </View>
            <GlideSwitch accessibilityLabel="Lesson sounds" onValueChange={setSoundEnabled} value={soundEnabled} />
          </View>
        </GlideSurface>
      </Section>

      <Section title="Prompt suggestions" detail="Compact entry points, not oversized feature cards.">
        <View style={styles.suggestions}>
          {suggestionExamples.map((suggestion) => (
            <PromptSuggestion key={suggestion} onPress={() => setPrompt(suggestion)}>
              {suggestion}
            </PromptSuggestion>
          ))}
        </View>
      </Section>

      <Section title="Messages" detail="User input is contained; teaching output stays direct and spacious.">
        <View style={styles.messageStack}>
          <PromptMessage role="user">How would I say this more naturally?</PromptMessage>
          <PromptMessage role="assistant">
            Use “με λένε” for “my name is.” It is the natural spoken form for this mission.
          </PromptMessage>
          <ThinkingBar actionLabel="Answer now" onAction={() => {}} text="Preparing pronunciation notes" />
        </View>
      </Section>

      <Section title="Composer" detail="One quiet surface, one unmistakable action.">
        <View style={styles.composerDemo}>
          {submittedPrompt && (
            <ThemedText type="footnote" themeColor="textSecondary">
              Submitted: {submittedPrompt}
            </ThemedText>
          )}
          <PromptComposer onChangeText={setPrompt} onSubmit={submitPrompt} value={prompt} />
        </View>
      </Section>

      <Section title="Progress" detail="Readable, low-noise, and paired with a numeric value.">
        <GlideSurface padding="roomy" style={styles.progressDemo}>
          <View style={styles.progressLabel}>
            <ThemedText type="headline">First conversation</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              72%
            </ThemedText>
          </View>
          <ProgressBar value={0.72} />
        </GlideSurface>
      </Section>
    </ScreenFrame>
  );
}

function Section({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionCopy}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          {title.toUpperCase()}
        </ThemedText>
        <ThemedText type="title2">{title}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      {children}
    </View>
  );
}

function TypeSample({
  label,
  type,
  children,
}: {
  label: string;
  type: 'largeTitle' | 'title2' | 'body' | 'eyebrow';
  children: React.ReactNode;
}) {
  return (
    <View style={styles.typeSample}>
      <ThemedText type="caption" themeColor="textTertiary">
        {label}
      </ThemedText>
      <ThemedText type={type}>{children}</ThemedText>
    </View>
  );
}

function ColorRole({
  color,
  label,
  value,
  last = false,
}: {
  color: string;
  label: string;
  value: string;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.colorRole,
        !last && { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}>
      <View style={[styles.colorChip, { backgroundColor: color, borderColor: theme.border }]} />
      <ThemedText type="headline" style={styles.colorLabel}>
        {label}
      </ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary">
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.six },
  back: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  intro: { gap: Spacing.two, paddingBottom: Spacing.two },
  introCopy: { maxWidth: 540 },
  section: { gap: Spacing.three },
  sectionCopy: { gap: Spacing.one },
  typeStack: { gap: Spacing.four },
  typeSample: { gap: Spacing.one },
  colorRole: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    minHeight: 60,
    paddingVertical: Spacing.twoHalf,
  },
  colorChip: { borderRadius: Radii.small, borderWidth: StyleSheet.hairlineWidth, height: 24, width: 24 },
  colorLabel: { minWidth: 84 },
  controlStack: { gap: Spacing.twoHalf },
  controlRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginTop: Spacing.one,
    paddingTop: Spacing.three,
  },
  controlLabel: { flex: 1, gap: Spacing.half },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  messageStack: { gap: Spacing.four },
  composerDemo: { gap: Spacing.two },
  progressDemo: { gap: Spacing.three },
  progressLabel: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  pressed: { opacity: 0.58 },
});
