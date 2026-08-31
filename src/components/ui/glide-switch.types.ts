export type GlideSwitchProps = {
  accessibilityLabel?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID?: string;
};
