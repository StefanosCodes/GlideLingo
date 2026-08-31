import { Switch } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { GlideSwitchProps } from './glide-switch.types';

export function GlideSwitch({ accessibilityLabel, value, onValueChange, testID }: GlideSwitchProps) {
  const theme = useTheme();

  return (
    <Switch
      accessibilityLabel={accessibilityLabel}
      onValueChange={onValueChange}
      testID={testID}
      thumbColor={theme.backgroundElement}
      trackColor={{ false: theme.surfaceSecondary, true: theme.success }}
      value={value}
    />
  );
}
