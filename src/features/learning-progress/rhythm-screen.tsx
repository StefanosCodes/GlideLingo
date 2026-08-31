import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ScreenFrame } from '@/components/screen-frame';
import { ThemedText } from '@/components/themed-text';
import { GlideSymbol } from '@/components/ui/glide-symbol';
import { GlideSurface } from '@/components/ui/glide-surface';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import {
  calendarGridForMonth,
  type CalendarDayCell,
  type WeeklyPracticeGoal,
} from '@/features/learning-progress/rhythm-policy';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const goals = [2, 3, 5] as const;

type PressState = { pressed: boolean; hovered?: boolean };

export function RhythmScreen({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  const {
    persistenceStatus,
    practiceDayKeys,
    rhythmSummary,
    setWeeklyPracticeGoal,
    weeklyPracticeGoal,
  } = useLearning();
  const now = new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1, 12));
  const grid = calendarGridForMonth(visibleMonth, practiceDayKeys, now);
  const monthLabel = visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const currentMonthVisible =
    visibleMonth.getFullYear() === now.getFullYear() && visibleMonth.getMonth() === now.getMonth();
  const title = !weeklyPracticeGoal
    ? 'Choose a rhythm that fits your life.'
    : rhythmSummary.currentStreakWeeks > 0
      ? `${rhythmSummary.currentStreakWeeks}-week rhythm streak`
      : 'Build your next steady week.';

  function moveMonth(amount: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1, 12));
  }

  return (
    <ScreenFrame chrome={false}>
      <Pressable accessibilityLabel="Back" accessibilityRole="button" onPress={onBack} style={styles.back}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Back
        </ThemedText>
      </Pressable>

      <View style={styles.intro}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          RHYTHM
        </ThemedText>
        <ThemedText type="display">{title}</ThemedText>
        <ThemedText type="body" themeColor="textSecondary" style={styles.introCopy}>
          Meaningful practice builds this rhythm. Missing an individual day never removes completed work or ability evidence.
        </ThemedText>
      </View>

      {persistenceStatus !== 'available' ? (
        <GlideSurface
          accessibilityRole="alert"
          padding="roomy"
          style={[styles.notice, { backgroundColor: theme.warningSoft }]}>
          <ThemedText type="headline">
            {persistenceStatus === 'corrupt'
              ? 'Saved practice could not be read safely.'
              : 'Practice is being kept for this session only.'}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {persistenceStatus === 'corrupt'
              ? 'The stored value was left untouched instead of being replaced with an empty calendar.'
              : 'Local storage is unavailable. Your current session still works, but this device may not remember it after restart.'}
          </ThemedText>
        </GlideSurface>
      ) : null}

      <GlideSurface padding="roomy" style={[styles.hero, { backgroundColor: theme.warningSoft }]}>
        <View style={styles.heroHeading}>
          <View style={[styles.flameWell, { backgroundColor: theme.surface }]}>
            <GlideSymbol
              name={{ ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' }}
              size={28}
              tintColor={theme.warning}
            />
          </View>
          <View style={styles.heroCopy}>
            <ThemedText type="eyebrow" themeColor="textSecondary">
              THIS WEEK
            </ThemedText>
            <ThemedText type="title2">
              {weeklyPracticeGoal
                ? `${rhythmSummary.practiceDaysThisWeek} of ${weeklyPracticeGoal} practice days`
                : 'No weekly target selected'}
            </ThemedText>
          </View>
        </View>

        {weeklyPracticeGoal ? (
          <ProgressBar
            accessibilityLabel={`${rhythmSummary.practiceDaysThisWeek} of ${weeklyPracticeGoal} planned practice days complete this week`}
            color={theme.warning}
            value={rhythmSummary.practiceDaysThisWeek / weeklyPracticeGoal}
          />
        ) : null}

        <ThemedText type="footnote" themeColor="textSecondary">
          {!weeklyPracticeGoal
            ? 'Choose two, three, or five days. You can change the target whenever your life changes.'
            : rhythmSummary.currentWeekMet
              ? 'Week complete. Anything else you practice is extra, not required.'
              : rhythmSummary.hasLapsed
                ? 'Your learning is still here. Start a new rhythm with one short lesson.'
                : `${rhythmSummary.daysRemaining} meaningful ${rhythmSummary.daysRemaining === 1 ? 'day' : 'days'} left in your chosen rhythm.`}
        </ThemedText>
      </GlideSurface>

      <View style={styles.stats}>
        <Stat label="CURRENT RHYTHM" value={`${rhythmSummary.currentStreakWeeks} wk`} />
        <Stat label="BEST RHYTHM" value={`${rhythmSummary.bestStreakWeeks} wk`} />
        <Stat label="PRACTICE DAYS" value={String(rhythmSummary.totalPracticeDays)} />
      </View>

      <View style={styles.section}>
        <View style={styles.calendarHeading}>
          <View>
            <ThemedText type="eyebrow" themeColor="textSecondary">
              PRACTICE CALENDAR
            </ThemedText>
            <ThemedText type="title2">{monthLabel}</ThemedText>
          </View>
          <View style={styles.monthActions}>
            <MonthButton accessibilityLabel="Previous month" label="‹" onPress={() => moveMonth(-1)} />
            <MonthButton
              accessibilityLabel="Next month"
              disabled={currentMonthVisible}
              label="›"
              onPress={() => moveMonth(1)}
            />
          </View>
        </View>

        <GlideSurface padding="roomy" style={styles.calendar}>
          <View style={styles.weekRow}>
            {weekdays.map((weekday) => (
              <ThemedText key={weekday} type="caption" themeColor="textTertiary" style={styles.weekday}>
                {weekday}
              </ThemedText>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {grid.map((cell) => (
              <CalendarCell key={cell.dayKey} cell={cell} />
            ))}
          </View>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]} />
            <ThemedText type="caption" themeColor="textSecondary">
              Completed lesson or strengthening review
            </ThemedText>
          </View>
        </GlideSurface>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            WEEKLY TARGET
          </ThemedText>
          <ThemedText type="title2">Choose a pace you can keep</ThemedText>
        </View>
        <GlideSurface padding="roomy" style={styles.goalSurface}>
          <View accessibilityRole="radiogroup" style={styles.goalChoices}>
            {goals.map((goal) => (
              <GoalChoice
                key={goal}
                goal={goal}
                onPress={() => setWeeklyPracticeGoal(goal)}
                selected={weeklyPracticeGoal === goal}
              />
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: weeklyPracticeGoal === null }}
            onPress={() => setWeeklyPracticeGoal(null)}
            style={styles.noTarget}>
            <ThemedText type="footnote" themeColor="textSecondary">
              Use no weekly target
            </ThemedText>
          </Pressable>
          <ThemedText type="caption" themeColor="textTertiary">
            Changes apply to this week and future weeks. Earlier weeks keep the target you had then.
          </ThemedText>
        </GlideSurface>
      </View>
    </ScreenFrame>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <GlideSurface padding="regular" style={styles.stat}>
      <ThemedText type="title3">{value}</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        {label}
      </ThemedText>
    </GlideSurface>
  );
}

function CalendarCell({ cell }: { cell: CalendarDayCell }) {
  const theme = useTheme();
  const dateLabel = new Date(`${cell.dayKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const state = cell.practiced ? ', practiced' : cell.future ? ', future date' : ', no recorded practice';

  return (
    <View style={styles.cellSlot}>
      <View
        accessible
        accessibilityLabel={`${dateLabel}${cell.today ? ', today' : ''}${state}`}
        style={[
          styles.cell,
          cell.practiced && { backgroundColor: theme.warningSoft, borderColor: theme.warning },
          cell.today && !cell.practiced && { borderColor: theme.text },
          (!cell.inMonth || cell.future) && styles.cellMuted,
        ]}>
        <ThemedText
          type="footnote"
          themeColor={!cell.inMonth || cell.future ? 'textTertiary' : 'text'}
          style={cell.practiced ? styles.cellPracticed : undefined}>
          {cell.dayNumber}
        </ThemedText>
        {cell.practiced ? (
          <ThemedText accessibilityElementsHidden importantForAccessibility="no" style={styles.cellCheck}>
            ✓
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

function MonthButton({
  accessibilityLabel,
  disabled = false,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.monthButton,
        { borderColor: theme.border, opacity: disabled ? 0.32 : pressed || hovered ? 0.64 : 1 },
      ]}>
      <ThemedText type="title3">{label}</ThemedText>
    </Pressable>
  );
}

function GoalChoice({
  goal,
  onPress,
  selected,
}: {
  goal: WeeklyPracticeGoal;
  onPress: () => void;
  selected: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      aria-checked={selected}
      accessibilityLabel={`${goal} practice days per week`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.goalChoice,
        {
          backgroundColor: selected ? theme.warningSoft : theme.surface,
          borderColor: selected ? theme.warning : theme.border,
          opacity: pressed || hovered ? 0.68 : 1,
        },
      ]}>
      <ThemedText type="footnote" style={selected ? styles.goalSelected : undefined}>
        {goal} days
      </ThemedText>
    </Pressable>
  );
}

const webClickable = Platform.select({ web: { cursor: 'pointer' as const }, default: {} });

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44, ...webClickable },
  intro: { gap: Spacing.two },
  introCopy: { maxWidth: 560 },
  notice: { gap: Spacing.one },
  hero: { gap: Spacing.three },
  heroHeading: { alignItems: 'center', flexDirection: 'row', gap: Spacing.three },
  flameWell: { alignItems: 'center', borderRadius: Radii.capsule, height: 52, justifyContent: 'center', width: 52 },
  heroCopy: { flex: 1, gap: Spacing.half },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stat: { flexBasis: 150, flexGrow: 1, gap: Spacing.half, minWidth: 120 },
  section: { gap: Spacing.three },
  sectionHeading: { gap: Spacing.one },
  calendarHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  monthActions: { flexDirection: 'row', gap: Spacing.one },
  monthButton: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
    ...webClickable,
  },
  calendar: { gap: Spacing.two },
  weekRow: { flexDirection: 'row' },
  weekday: { textAlign: 'center', width: `${100 / 7}%` },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellSlot: { alignItems: 'center', padding: Spacing.half, width: `${100 / 7}%` },
  cell: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: Radii.medium,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    maxWidth: 52,
    position: 'relative',
    width: '100%',
  },
  cellMuted: { opacity: 0.42 },
  cellPracticed: { fontFamily: Fonts.sansMedium },
  cellCheck: { bottom: 1, fontFamily: Fonts.sansMedium, fontSize: 9, lineHeight: 10, position: 'absolute' },
  legend: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  legendDot: { borderRadius: Radii.small, borderWidth: 1, height: 14, width: 14 },
  goalSurface: { gap: Spacing.twoHalf },
  goalChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  goalChoice: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 76,
    paddingHorizontal: Spacing.twoHalf,
    ...webClickable,
  },
  goalSelected: { fontFamily: Fonts.sansMedium },
  noTarget: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 40, ...webClickable },
});
