import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlideSymbol } from '@/components/ui/glide-symbol';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = Parameters<typeof GlideSymbol>[0]['name'];

export function ListRow({
  icon,
  label,
  detail,
  last = false,
  onPress,
  trailing,
}: {
  icon?: SymbolName;
  label: string;
  detail: string;
  last?: boolean;
  onPress?: () => void;
  trailing?: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel={`${label}. ${detail}`}
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [Boolean(onPress && pressed) && styles.pressed]}>
      <View
        style={[
          styles.row,
          !last && { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth },
        ]}>
        {icon ? <GlideSymbol name={icon} size={20} tintColor={theme.textSecondary} /> : null}
        <View style={styles.copy}>
          <ThemedText type="headline">{label}</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {detail}
          </ThemedText>
        </View>
        {trailing ? (
          <ThemedText type="caption" themeColor="textTertiary">
            {trailing}
          </ThemedText>
        ) : onPress ? (
          <GlideSymbol
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={14}
            tintColor={theme.textTertiary}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    minHeight: 72,
    paddingVertical: Spacing.three,
  },
  copy: { flex: 1, gap: Spacing.half },
  pressed: { opacity: 0.58 },
});
