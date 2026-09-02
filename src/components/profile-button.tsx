import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { GlideSymbol } from '@/components/ui/glide-symbol';
import { Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type PressState = { pressed: boolean; hovered?: boolean };

export function ProfileButton() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel="Profile and settings"
      accessibilityRole="button"
      onPress={() => router.push('/profile')}
      style={({ pressed, hovered }: PressState) => [
        styles.button,
        { backgroundColor: pressed || hovered ? theme.backgroundSelected : theme.surface, borderColor: theme.border },
      ]}>
      <GlideSymbol
        name={{ ios: 'person.circle', android: 'account_circle', web: 'account_circle' }}
        size={20}
        tintColor={theme.text}
      />
    </Pressable>
  );
}

const webClickable = Platform.select({ web: { cursor: 'pointer' as const }, default: {} });

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: Radii.capsule,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
    ...webClickable,
  },
});
