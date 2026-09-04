import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { ApiClientError } from '@/api/client';
import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideButton } from '@/components/ui/glide-button';
import { GlideSurface } from '@/components/ui/glide-surface';
import { Radii, Spacing } from '@/constants/theme';
import {
  getMarketplaceLearningContext,
  revokeMarketplaceLearningContext,
  saveMarketplaceLearningContext,
  saveMarketplaceTutorFollowUp,
  type MarketplaceLearningContext,
} from '@/features/tutor-marketplace/api';
import { isHumanTutorLearningBridgeEnabled } from '@/features/tutor-marketplace/config';
import { useTheme } from '@/hooks/use-theme';

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; context: MarketplaceLearningContext };

export function MarketplaceLearningContextScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const enabled = isHumanTutorLearningBridgeEnabled();
  const theme = useTheme();
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State>(enabled ? { kind: 'loading' } : { kind: 'error' });
  const [goal, setGoal] = useState('Practice confidently with my tutor');
  const [language, setLanguage] = useState('el');
  const [courseId, setCourseId] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [reviewFocus, setReviewFocus] = useState('');
  const [summary, setSummary] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [contentReference, setContentReference] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const current = ++sequence.current;
    void getMarketplaceLearningContext(bookingId, controller.signal).then((context) => {
      if (!controller.signal.aborted && current === sequence.current) {
        setState({ kind: 'ready', context });
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted || current !== sequence.current) return;
      if (error instanceof ApiClientError && error.kind === 'cancelled') return;
      setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [bookingId, enabled, retry]);

  const share = async () => {
    if (working || state.kind !== 'ready') return;
    setWorking(true); setMessage(null);
    try {
      const hasCourse = courseId.trim().length > 0 && courseTitle.trim().length > 0;
      const context = await saveMarketplaceLearningContext(bookingId, {
        selectedGoal: goal.trim(), languageCode: language.trim(),
        courseId: hasCourse ? courseId.trim() : null,
        courseTitle: hasCourse ? courseTitle.trim() : null,
        capabilities: splitItems(capabilities, 12), reviewFocus: splitItems(reviewFocus, 12),
      });
      setState({ kind: 'ready', context });
      setMessage('This booking-only learning brief is now shared with the assigned tutor.');
    } catch { setMessage('The learning brief could not be shared. Check the fields and booking status.'); }
    finally { setWorking(false); }
  };

  const revoke = async () => {
    if (working || state.kind !== 'ready') return;
    setWorking(true); setMessage(null);
    try {
      setState({ kind: 'ready', context: await revokeMarketplaceLearningContext(bookingId) });
      setMessage('Tutor access to this learning brief was revoked.');
    } catch { setMessage('The learning brief could not be revoked. Reload and try again.'); }
    finally { setWorking(false); }
  };

  const saveFollowUp = async () => {
    if (working || state.kind !== 'ready') return;
    setWorking(true); setMessage(null);
    try {
      const reference = contentReference.trim();
      const context = await saveMarketplaceTutorFollowUp(bookingId, summary.trim(), [{
        kind: reference ? 'course_content' : 'free_text',
        contentReference: reference || null,
        recommendation: recommendation.trim(),
      }]);
      setState({ kind: 'ready', context });
      setMessage('Private tutor follow-up saved for this learner.');
    } catch { setMessage('Follow-up is available only to the assigned tutor during the documented window.'); }
    finally { setWorking(false); }
  };

  const context = state.kind === 'ready' ? state.context : null;
  return <ScreenFrame testID={enabled ? 'marketplace-learning-context-screen' : 'marketplace-learning-context-disabled'}>
    <View style={styles.header}>
      <ThemedText type="eyebrow" themeColor="textSecondary">BOOKING-ONLY CONTEXT</ThemedText>
      <ThemedText type="display">Prepare and follow up.</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">This private bridge never changes mastery, XP, evidence, entitlements, or course unlocks.</ThemedText>
    </View>
    {state.kind === 'loading' ? <GlideSurface accessible accessibilityLabel="Loading learning context" padding="roomy" style={styles.card}><ActivityIndicator color={theme.tint} /></GlideSurface> : null}
    {state.kind === 'error' ? <GlideSurface accessible accessibilityRole="alert" padding="roomy" style={styles.card} variant="tinted"><ThemedText type="title2">Learning context is unavailable.</ThemedText>{enabled ? <GlideButton label="Try again" onPress={() => { setState({ kind: 'loading' }); setRetry((value) => value + 1); }} /> : null}</GlideSurface> : null}
    {context ? <>
      <GlideSurface padding="roomy" style={styles.card} variant={context.consentState === 'granted' ? 'success' : 'card'}>
        <ThemedText type="title2">Consent: {context.consentState.replaceAll('_', ' ')}</ThemedText>
        {context.brief ? <>
          <ThemedText type="body">Goal: {context.brief.selectedGoal}</ThemedText>
          <ThemedText type="body">Language: {context.brief.languageCode}</ThemedText>
          <ThemedText type="body">Course: {context.brief.courseTitle ?? 'No GlideLingo course selected'}</ThemedText>
          {context.brief.capabilities.map((item) => <ThemedText key={item} type="footnote">Capability: {item}</ThemedText>)}
          {context.brief.reviewFocus.map((item) => <ThemedText key={item} type="footnote">Review: {item}</ThemedText>)}
        </> : <ThemedText type="body" themeColor="textSecondary">No learning brief is available to this participant.</ThemedText>}
      </GlideSurface>
      {context.role === 'learner' ? <GlideSurface padding="roomy" style={styles.card}>
        <ThemedText type="title2">Share a minimal brief</ThemedText>
        <Field label="Learning goal" value={goal} onChangeText={setGoal} theme={theme} />
        <Field label="Language code" value={language} onChangeText={setLanguage} theme={theme} />
        <Field label="Optional course ID" value={courseId} onChangeText={setCourseId} theme={theme} />
        <Field label="Optional course title" value={courseTitle} onChangeText={setCourseTitle} theme={theme} />
        <Field label="Capabilities, separated by commas" value={capabilities} onChangeText={setCapabilities} theme={theme} />
        <Field label="Review focus, separated by commas" value={reviewFocus} onChangeText={setReviewFocus} theme={theme} />
        <GlideButton disabled={working || goal.trim().length < 3 || language.trim().length < 2 || Boolean(courseId.trim()) !== Boolean(courseTitle.trim())} label={working ? 'Saving…' : 'Share with assigned tutor'} onPress={() => void share()} />
        {context.consentState === 'granted' ? <GlideButton disabled={working} label="Revoke future tutor access" onPress={() => void revoke()} variant="secondary" /> : null}
      </GlideSurface> : null}
      {context.role === 'tutor' ? <GlideSurface padding="roomy" style={styles.card}>
        <ThemedText type="title2">Private learner follow-up</ThemedText>
        <Field label="Lesson summary" value={summary} onChangeText={setSummary} theme={theme} />
        <Field label="Recommendation" value={recommendation} onChangeText={setRecommendation} theme={theme} />
        <Field label="Optional GlideLingo content reference" value={contentReference} onChangeText={setContentReference} theme={theme} />
        <GlideButton disabled={working || summary.trim().length < 8 || recommendation.trim().length < 3} label={working ? 'Saving…' : 'Save learner follow-up'} onPress={() => void saveFollowUp()} />
      </GlideSurface> : null}
      {context.followUp ? <GlideSurface padding="roomy" style={styles.card} variant="tinted"><ThemedText type="title2">Tutor follow-up</ThemedText><ThemedText type="body">{context.followUp.summary}</ThemedText>{context.followUp.recommendations.map((item, index) => <ThemedText key={`${item.kind}-${index}`} type="body">{item.recommendation}</ThemedText>)}</GlideSurface> : null}
    </> : null}
    {message ? <ThemedText accessibilityRole="alert" type="footnote">{message}</ThemedText> : null}
  </ScreenFrame>;
}

function Field({ label, onChangeText, theme, value }: { label: string; onChangeText: (value: string) => void; theme: ReturnType<typeof useTheme>; value: string }) {
  return <TextInput accessibilityLabel={label} autoCapitalize="none" maxLength={2000} onChangeText={onChangeText} placeholder={label} placeholderTextColor={theme.textTertiary} style={[styles.input, { borderColor: theme.border, color: theme.text }]} value={value} />;
}

function splitItems(value: string, maximum: number): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))].slice(0, maximum);
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two, width: '100%' },
  header: { gap: Spacing.two, width: '100%' },
  input: { borderRadius: Radii.medium, borderWidth: 1, minHeight: 48, paddingHorizontal: Spacing.two },
});
