import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { type Language } from '@/constants/catalog';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

type PressState = { pressed: boolean; hovered?: boolean };

export function LanguagePicker() {
  const theme = useTheme();
  const { language, languages, setLanguage } = useLearning();
  const [open, setOpen] = useState(false);
  const [dismissable, setDismissable] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setDismissable(true), 0);
    return () => clearTimeout(timer);
  }, [open]);

  function close() {
    setOpen(false);
    setDismissable(false);
  }

  return (
    <View style={styles.wrap}>
      {open && dismissable ? (
        <Pressable
          accessibilityLabel="Dismiss language menu"
          accessibilityRole="button"
          onPress={close}
          style={styles.dismiss}
        />
      ) : null}

      <Pressable
        accessibilityLabel={`Language, ${language.name}. ${open ? 'Close' : 'Open'} language menu`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen((value) => !value);
          setDismissable(false);
        }}
        style={({ pressed, hovered }: PressState) => [
          styles.trigger,
          {
            backgroundColor: theme.surface,
            borderColor: open ? theme.text : theme.border,
          },
          (pressed || hovered) && { backgroundColor: theme.backgroundSelected },
        ]}>
        <ThemedText style={styles.flag}>{language.flag}</ThemedText>
        <ThemedText type="footnote" style={styles.triggerLabel}>
          {language.name}
        </ThemedText>
        <ThemedText type="caption" themeColor="textTertiary" style={styles.caret}>
          {open ? '▴' : '▾'}
        </ThemedText>
      </Pressable>

      {open ? (
        <View
          style={[
            styles.menu,
            styles.menuElevation,
            {
              backgroundColor: theme.surfaceElevated,
              borderColor: theme.border,
            },
          ]}>
          <View style={styles.menuHeader}>
            <ThemedText type="eyebrow" themeColor="textTertiary">
              LANGUAGES
            </ThemedText>
          </View>
          {languages.map((item) => (
            <LanguageOption
              key={item.id}
              language={item}
              selected={item.id === language.id}
              onPress={() => {
                setLanguage(item.id);
                close();
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LanguageOption({
  language,
  selected,
  onPress,
}: {
  language: Language;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel={`${language.name}${language.available ? '' : ', coming soon'}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.option,
        {
          backgroundColor: selected
            ? theme.backgroundSelected
            : pressed || hovered
              ? theme.backgroundSelected
              : 'transparent',
        },
      ]}>
      <ThemedText style={styles.optionFlag}>{language.flag}</ThemedText>
      <ThemedText
        type="footnote"
        style={[styles.optionLabel, selected && styles.optionLabelSelected]}
        themeColor={language.available ? 'text' : 'textSecondary'}>
        {language.name}
      </ThemedText>
      {selected ? (
        <ThemedText type="footnote" themeColor="text" style={styles.check}>
          ✓
        </ThemedText>
      ) : language.available ? null : (
        <ThemedText type="caption" themeColor="textTertiary" style={styles.badge}>
          Soon
        </ThemedText>
      )}
    </Pressable>
  );
}

const webClickable = Platform.select({ web: { cursor: 'pointer' as const }, default: {} });

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', position: 'relative', zIndex: 100 },
  dismiss: Platform.select({
    web: {
      bottom: 0,
      left: 0,
      position: 'fixed',
      right: 0,
      top: 0,
      zIndex: 90,
    },
    default: {
      ...StyleSheet.absoluteFill,
      zIndex: 90,
    },
  }) ?? {},
  trigger: {
    alignItems: 'center',
    borderRadius: Radii.capsule,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    zIndex: 100,
    ...webClickable,
  },
  triggerLabel: { fontFamily: Fonts.sansMedium, fontSize: 13 },
  caret: { fontSize: 10, marginLeft: 2 },
  flag: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 18 },
  menu: {
    borderRadius: Radii.large,
    borderWidth: 1,
    gap: 2,
    minWidth: 180,
    padding: 6,
    position: 'absolute',
    right: 0,
    top: 42,
    zIndex: 100,
  },
  menuElevation: Platform.select({
    web: {
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04)',
    },
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 10,
    },
    default: {
      elevation: 6,
    },
  }) ?? {},
  menuHeader: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  option: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: 34,
    paddingHorizontal: 8,
    ...webClickable,
  },
  optionFlag: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 18 },
  optionLabel: { flex: 1, fontFamily: Fonts.sans },
  optionLabelSelected: { fontFamily: Fonts.sansMedium },
  check: { fontFamily: Fonts.sansMedium, fontSize: 12 },
  badge: { fontSize: 10 },
});
