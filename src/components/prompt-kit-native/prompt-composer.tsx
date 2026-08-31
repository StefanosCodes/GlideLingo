import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { GlideSymbol } from '@/components/ui/glide-symbol';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type PromptComposerProps = {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
};

export function PromptComposer({
  value,
  onChangeText,
  onSubmit,
  placeholder = 'Ask your tutor',
  disabled = false,
}: PromptComposerProps) {
  const theme = useTheme();
  const canSubmit = value.trim().length > 0 && !disabled;

  return (
    <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <TextInput
        accessibilityLabel={placeholder}
        editable={!disabled}
        multiline
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        style={[styles.input, { color: theme.text }]}
        value={value}
      />
      <Pressable
        accessibilityLabel="Send prompt"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={onSubmit}
        style={({ pressed }) => [
          styles.send,
          { backgroundColor: canSubmit ? theme.tint : theme.surfaceSecondary, opacity: pressed ? 0.62 : 1 },
        ]}>
        <GlideSymbol
          name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
          size={18}
          tintColor={canSubmit ? theme.textInverse : theme.textTertiary}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    borderRadius: Radii.xlarge,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    minHeight: 58,
    padding: Spacing.two,
    paddingLeft: Spacing.three,
  },
  input: { flex: 1, fontFamily: Fonts.sans, fontSize: 15, lineHeight: 21, maxHeight: 120, minHeight: 40, paddingVertical: 9 },
  send: { width: 40, height: 40, borderRadius: Radii.capsule, alignItems: 'center', justifyContent: 'center' },
});
