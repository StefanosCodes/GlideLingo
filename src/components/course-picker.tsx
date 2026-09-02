import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { courses as catalogCourses, type Course, type Language } from '@/constants/catalog';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

type PressState = { pressed: boolean; hovered?: boolean };

export function CoursePicker({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const theme = useTheme();
  const { language, languages, courses, enrolledCourse, switchCourse } = useLearning();
  const [open, setOpen] = useState(false);
  const [dismissable, setDismissable] = useState(false);
  const displayedCourse = enrolledCourse ?? courses[0] ?? null;

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setDismissable(true), 0);
    return () => clearTimeout(timer);
  }, [open]);

  function close() {
    setOpen(false);
    setDismissable(false);
  }

  function chooseCourse(course: Course) {
    const alreadyEnrolled = switchCourse(course.id);
    close();
    if (alreadyEnrolled) {
      router.replace('/');
      return;
    }
    router.push(`/course/${course.id}`);
  }

  return (
    <View style={styles.wrap}>
      {open && dismissable ? (
        <Pressable
          accessibilityLabel="Dismiss course menu"
          accessibilityRole="button"
          onPress={close}
          style={styles.dismiss}
        />
      ) : null}

      <Pressable
        accessibilityLabel={`Course, ${displayedCourse?.title ?? language.name}. ${open ? 'Close' : 'Open'} course menu`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen((value) => !value);
          setDismissable(false);
        }}
        style={({ pressed, hovered }: PressState) => [
          styles.trigger,
          compact && styles.triggerCompact,
          {
            backgroundColor: theme.surface,
            borderColor: open ? theme.text : theme.border,
          },
          (pressed || hovered) && { backgroundColor: theme.backgroundSelected },
        ]}>
        <ThemedText style={styles.flag}>{language.flag}</ThemedText>
        {!compact ? (
          <>
            <ThemedText numberOfLines={1} type="footnote" style={styles.triggerLabel}>
              {displayedCourse?.title ?? language.name}
            </ThemedText>
            <ThemedText type="caption" themeColor="textTertiary" style={styles.caret}>
              {open ? '▴' : '▾'}
            </ThemedText>
          </>
        ) : null}
      </Pressable>

      {open ? (
        <View style={[styles.menu, styles.menuElevation, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <View style={styles.menuHeader}>
            <ThemedText type="eyebrow" themeColor="textTertiary">
              COURSES
            </ThemedText>
          </View>
          {catalogCourses.map((course) => (
            <CourseOption
              key={course.id}
              course={course}
              language={languages.find((item) => item.id === course.languageId) ?? language}
              selected={course.id === enrolledCourse?.id}
              onPress={() => chooseCourse(course)}
            />
          ))}

          <View style={[styles.menuHeader, styles.languageHeader, { borderTopColor: theme.separator }]}>
            <ThemedText type="eyebrow" themeColor="textTertiary">
              MORE LANGUAGES
            </ThemedText>
          </View>
          {languages.filter((item) => !catalogCourses.some((course) => course.languageId === item.id)).map((item) => (
            <UnavailableLanguage key={item.id} language={item} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CourseOption({
  course,
  language,
  selected,
  onPress,
}: {
  course: Course;
  language: Language;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={`${course.title}, ${course.levelLabel}${selected ? ', current course' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.option,
        { backgroundColor: selected || pressed || hovered ? theme.backgroundSelected : 'transparent' },
      ]}>
      <ThemedText style={styles.optionFlag}>{language.flag}</ThemedText>
      <View style={styles.optionCopy}>
        <ThemedText type="footnote" style={selected ? styles.optionLabelSelected : undefined}>
          {course.title}
        </ThemedText>
        <ThemedText type="caption" themeColor="textTertiary">
          {course.levelLabel}
        </ThemedText>
      </View>
      {selected ? (
        <ThemedText type="footnote" style={styles.check}>
          ✓
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

function UnavailableLanguage({ language }: { language: Language }) {
  return (
    <View accessibilityLabel={`${language.name}, coming soon`} style={styles.option}>
      <ThemedText style={styles.optionFlag}>{language.flag}</ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.optionCopy}>
        {language.name}
      </ThemedText>
      <ThemedText type="caption" themeColor="textTertiary">
        Soon
      </ThemedText>
    </View>
  );
}

const webClickable = Platform.select({ web: { cursor: 'pointer' as const }, default: {} });

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', position: 'relative', zIndex: 100 },
  dismiss: Platform.select({
    web: { bottom: 0, left: 0, position: 'fixed', right: 0, top: 0, zIndex: 90 },
    default: { ...StyleSheet.absoluteFill, zIndex: 90 },
  }) ?? {},
  trigger: {
    alignItems: 'center',
    borderRadius: Radii.capsule,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 36,
    maxWidth: 240,
    paddingHorizontal: 12,
    zIndex: 100,
    ...webClickable,
  },
  triggerLabel: { flexShrink: 1, fontFamily: Fonts.sansMedium, fontSize: 13 },
  triggerCompact: { height: 44, justifyContent: 'center', paddingHorizontal: 0, width: 44 },
  caret: { fontSize: 10, marginLeft: 2 },
  flag: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 18 },
  menu: {
    borderRadius: Radii.large,
    borderWidth: 1,
    gap: 2,
    minWidth: 240,
    padding: 6,
    position: 'absolute',
    right: 0,
    top: 42,
    zIndex: 100,
  },
  menuElevation: Platform.select({
    web: { boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04)' },
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 10,
    },
    default: { elevation: 6 },
  }) ?? {},
  menuHeader: { paddingHorizontal: 8, paddingVertical: 4 },
  languageHeader: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.one, paddingTop: Spacing.two },
  option: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: 44,
    paddingHorizontal: 8,
    ...webClickable,
  },
  optionFlag: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 20 },
  optionCopy: { flex: 1, gap: 1 },
  optionLabelSelected: { fontFamily: Fonts.sansMedium },
  check: { fontFamily: Fonts.sansMedium, fontSize: 12 },
});
