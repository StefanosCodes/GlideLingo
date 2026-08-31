import { type PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { Radii, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SurfaceVariant = 'card' | 'grouped' | 'tinted' | 'success' | 'accent' | 'hero';
type SurfaceTheme = {
  surface: string;
  surfaceSecondary: string;
  tintSoft: string;
  successSoft: string;
  accentSoft: string;
  accentMid: string;
};

export type GlideSurfaceProps = PropsWithChildren<
  ViewProps & {
    variant?: SurfaceVariant;
    padding?: 'none' | 'compact' | 'regular' | 'roomy';
    style?: StyleProp<ViewStyle>;
  }
>;

const paddingMap = { none: 0, compact: Spacing.twoHalf, regular: Spacing.three, roomy: Spacing.four } as const;

function surfaceFill(variant: SurfaceVariant, theme: SurfaceTheme): ViewStyle {
  if (variant === 'hero') {
    const wash = `linear-gradient(180deg, ${theme.surface} 0%, ${theme.accentMid} 100%)`;
    return {
      backgroundColor: theme.surface,
      experimental_backgroundImage: wash,
      ...(Platform.OS === 'web' ? ({ backgroundImage: wash } as ViewStyle) : {}),
    };
  }

  return {
    backgroundColor: {
      card: theme.surface,
      grouped: theme.surfaceSecondary,
      tinted: theme.tintSoft,
      success: theme.successSoft,
      accent: theme.accentSoft,
    }[variant],
  };
}

export function GlideSurface({ children, variant = 'card', padding = 'regular', style, ...rest }: GlideSurfaceProps) {
  const theme = useTheme();
  const sharedStyle = [
    styles.base,
    surfaceFill(variant, theme),
    { borderColor: theme.border, padding: paddingMap[padding] },
    style,
  ];

  return <View style={sharedStyle} {...rest}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { borderRadius: Radii.large, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', ...Shadows.card },
});
