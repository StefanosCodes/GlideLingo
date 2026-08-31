import { type PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SurfaceVariant = 'card' | 'grouped' | 'tinted' | 'success';

export type GlideSurfaceProps = PropsWithChildren<
  ViewProps & {
    variant?: SurfaceVariant;
    padding?: 'none' | 'compact' | 'regular' | 'roomy';
    style?: StyleProp<ViewStyle>;
  }
>;

const paddingMap = { none: 0, compact: Spacing.twoHalf, regular: Spacing.three, roomy: Spacing.four } as const;

export function GlideSurface({ children, variant = 'card', padding = 'regular', style, ...rest }: GlideSurfaceProps) {
  const theme = useTheme();
  const backgroundColor = {
    card: theme.surface,
    grouped: theme.surfaceSecondary,
    tinted: theme.tintSoft,
    success: theme.successSoft,
  }[variant];
  const sharedStyle = [
    styles.base,
    { backgroundColor, borderColor: theme.border, padding: paddingMap[padding] },
    style,
  ];

  return <View style={sharedStyle} {...rest}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { borderRadius: Radii.large, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', ...Shadows.card },
});
