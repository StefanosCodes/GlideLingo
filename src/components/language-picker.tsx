import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { type Language } from '@/constants/catalog';
import { Fonts, Radii, Shadows, Spacing } from '@/constants/theme';
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

  return (
    <View style={styles.wrap}>
      {open && dismissable ? (
        <Pressable
          accessibilityLabel="Dismiss language menu"
          accessibilityRole="button"
          onPress={() => {
            setOpen(false);
            setDismissable(false);
          }}
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
            backgroundColor: open || pressed || hovered ? theme.backgroundSelected : theme.surface,
            borderColor: theme.border,
          },
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
            {
              backgroundColor: theme.surfaceElevated,
              borderColor: theme.border,
            },
          ]}>
          {languages.map((item) => (
            <LanguageOption
              key={item.id}
              language={item}
              selected={item.id === language.id}
              onPress={() => {
                setLanguage(item.id);
                setOpen(false);
                setDismissable(false);
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
        { backgroundColor: selected || pressed || hovered ? theme.backgroundSelected : 'transparent' },
      ]}>
      <ThemedText style={styles.flag}>{language.flag}</ThemedText>
      <ThemedText type="headline" style={styles.optionLabel} themeColor={language.available ? 'text' : 'textSecondary'}>
        {language.name}
      </ThemedText>
      {selected ? (
        <ThemedText type="caption" themeColor="text">
          ✓
        </ThemedText>
      ) : language.available ? null : (
        <ThemedText type="caption" themeColor="textTertiary">
          Soon
        </ThemedText>
      )}
    </Pressable>
  );
}

const webClickable = Platform.select({ web: { cursor: 'pointer' as const }, default: {} });

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', overflow: 'visible', zIndex: 20 },
  dismiss: Platform.select({
    web: {
      bottom: 0,
      left: 0,
      position: 'fixed',
      right: 0,
      top: 0,
      zIndex: 10,
    },
    default: {
      ...StyleSheet.absoluteFill,
      zIndex: 10,
    },
  }) ?? {},
  trigger: {
    alignItems: 'center',
    borderRadius: Radii.capsule,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    height: 32,
    paddingLeft: 10,
    paddingRight: 12,
    zIndex: 20,
    ...webClickable,
  },
  triggerLabel: { fontFamily: Fonts.sansMedium },
  caret: { marginLeft: 2 },
  flag: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 18 },
  menu: {
    borderRadius: Radii.xlarge,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
    minWidth: 196,
    padding: 6,
    position: 'absolute',
    right: 0,
    top: 38,
    zIndex: 30,
    ...Shadows.floating,
  },
  option: {
    alignItems: 'center',
    borderRadius: Radii.large,
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: 40,
    paddingHorizontal: 10,
    ...webClickable,
  },
  optionLabel: { flex: 1 },
});
