import type { StyleProp, ViewStyle } from 'react-native';

export type GlideButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary';
  size?: 'regular' | 'large';
  fullWidth?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};
