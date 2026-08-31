import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideSurface } from '@/components/ui/glide-surface';
import { moduleStatus, type ModuleStatus } from '@/constants/catalog';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

const statusLabel: Record<ModuleStatus, string> = {
  complete: 'Done',
  current: 'Now',
  upcoming: '',
};

type PressState = { pressed: boolean; hovered?: boolean };

type ModuleTreeProps = {
  density: 'rail' | 'page';
  selectedModuleId?: string | null;
  onSelectModule?: (moduleId: string) => void;
};

export function ModuleTree({ density, selectedModuleId, onSelectModule }: ModuleTreeProps) {
  const theme = useTheme();
  const { enrolledCourse, completedModuleIds, currentModule } = useLearning();
  const currentId = currentModule?.id ?? enrolledCourse?.modules[0]?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(currentId);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);

  if (!enrolledCourse) return null;

  const expandedId = openId;
  const rail = density === 'rail';

  const tree = enrolledCourse.modules.map((module, index) => {
    const status = moduleStatus(enrolledCourse, module.id, completedModuleIds);
    const expanded = expandedId === module.id;
    const selected = selectedModuleId === module.id || (!selectedModuleId && status === 'current' && rail);
    const last = index === enrolledCourse.modules.length - 1;
    const number = String(index + 1).padStart(2, '0');

    function selectModule() {
      setOpenId(module.id);
      setSelectedLessonId(null);
      if (onSelectModule) onSelectModule(module.id);
    }

    function toggleModule() {
      setOpenId(expanded ? null : module.id);
    }

    return (
      <View
        key={module.id}
        style={!last && !rail ? { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth } : undefined}>
        {rail ? (
          <View style={styles.railRowWrap}>
            <Pressable
              accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${module.title}`}
              accessibilityRole="button"
              hitSlop={6}
              onPress={toggleModule}
              style={({ pressed, hovered }: PressState) => [
                styles.railChevron,
                (pressed || hovered) && { backgroundColor: theme.backgroundSelected },
              ]}>
              <ThemedText style={[styles.chevronGlyph, { color: theme.textTertiary }]}>
                {expanded ? '▾' : '▸'}
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityLabel={`${module.title}. ${statusLabel[status] || 'Upcoming'}`}
              accessibilityRole="button"
              accessibilityState={{ expanded, selected }}
              onPress={selectModule}
              style={({ pressed, hovered }: PressState) => [
                styles.railTitleHit,
                (selected || pressed || hovered) && { backgroundColor: theme.backgroundSelected },
              ]}>
              <ThemedText
                numberOfLines={2}
                type="subheadline"
                themeColor={selected || status === 'current' ? 'text' : 'textSecondary'}
                style={[styles.railTitle, selected && styles.railTitleActive]}>
                {number}  {module.title}
              </ThemedText>
              {statusLabel[status] ? (
                <ThemedText type="caption" themeColor={status === 'current' ? 'text' : 'textTertiary'}>
                  {statusLabel[status]}
                </ThemedText>
              ) : null}
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityLabel={`${module.title}. ${statusLabel[status] || 'Upcoming'}`}
            accessibilityRole="button"
            accessibilityState={{ expanded, selected }}
            onPress={() => {
              toggleModule();
              onSelectModule?.(module.id);
            }}
            style={({ pressed }) => [styles.pageRow, pressed && styles.pressed]}>
            <View style={styles.pageCopy}>
              <ThemedText type="headline">
                {number}  {module.title}
              </ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {module.canDo}
              </ThemedText>
            </View>
            <ThemedText type="caption" themeColor="textTertiary">
              {statusLabel[status] || 'Upcoming'}
            </ThemedText>
          </Pressable>
        )}
        {expanded
          ? module.lessons.map((lesson, lessonIndex) =>
              rail ? (
                <Pressable
                  key={lesson.id}
                  accessibilityLabel={`${lesson.title}. ${lesson.durationMin} minutes`}
                  accessibilityRole="button"
                  onPress={() => {
                    setOpenId(module.id);
                    setSelectedLessonId(lesson.id);
                    onSelectModule?.(module.id);
                  }}
                  style={({ pressed, hovered }: PressState) => [
                    styles.railLesson,
                    (selectedLessonId === lesson.id || pressed || hovered) && {
                      backgroundColor: theme.backgroundSelected,
                    },
                  ]}>
                  <ThemedText type="footnote" themeColor={selectedLessonId === lesson.id ? 'text' : 'textSecondary'} numberOfLines={1} style={styles.railLessonTitle}>
                    {lesson.title}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textTertiary">
                    {lesson.durationMin} min
                  </ThemedText>
                </Pressable>
              ) : (
                <View
                  key={lesson.id}
                  style={[
                    styles.pageLesson,
                    { borderTopColor: theme.separator },
                    lessonIndex === 0 && { borderTopWidth: StyleSheet.hairlineWidth },
                  ]}>
                  <ThemedText type="footnote">{lesson.title}</ThemedText>
                  <ThemedText type="caption" themeColor="textTertiary">
                    {lesson.durationMin} min
                  </ThemedText>
                </View>
              ),
            )
          : null}
      </View>
    );
  });

  if (rail) return <View style={styles.rail}>{tree}</View>;

  return <GlideSurface padding="none">{tree}</GlideSurface>;
}

const webClickable = Platform.select({ web: { cursor: 'pointer' as const }, default: {} });

const styles = StyleSheet.create({
  rail: { gap: 2, paddingBottom: Spacing.two },
  railRowWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 2 },
  railChevron: {
    alignItems: 'center',
    borderRadius: Radii.small,
    height: 40,
    justifyContent: 'center',
    width: 22,
    ...webClickable,
  },
  chevronGlyph: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 16, textAlign: 'center' },
  railTitleHit: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.one,
    minHeight: 40,
    paddingHorizontal: 8,
    paddingVertical: 8,
    ...webClickable,
  },
  railTitle: { flex: 1 },
  railTitleActive: { fontFamily: Fonts.sansMedium },
  railLesson: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    flexDirection: 'row',
    gap: Spacing.two,
    marginLeft: 22,
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 6,
    ...webClickable,
  },
  railLessonTitle: { flex: 1 },
  pageRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.three,
    minHeight: 72,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  pageCopy: { flex: 1, gap: Spacing.half },
  pageLesson: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingLeft: 48,
    paddingVertical: Spacing.two,
  },
  pressed: { opacity: 0.58 },
});
