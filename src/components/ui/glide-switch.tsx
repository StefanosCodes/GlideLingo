import { Host, Switch } from '@expo/ui';

import { useTheme } from '@/hooks/use-theme';
import type { GlideSwitchProps } from './glide-switch.types';

export function GlideSwitch({ value, onValueChange, testID }: GlideSwitchProps) {
  const theme = useTheme();

  return (
    <Host matchContents seedColor={theme.success}>
      <Switch value={value} onValueChange={onValueChange} testID={testID} />
    </Host>
  );
}
