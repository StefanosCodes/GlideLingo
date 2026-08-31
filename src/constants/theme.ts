import '@/global.css';

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * React Native translations of the OpenFDE_Hackathon frontend tokens.
 * The reference uses OKLCH; these hex values are the corresponding Zinc
 * palette values so Android and iOS receive the same colors as web.
 */
export const Colors = {
  light: {
    text: '#18181B',
    textSecondary: '#71717A',
    textTertiary: '#A1A1AA',
    textInverse: '#FAFAFA',
    background: '#FCFCFC',
    backgroundElement: '#FAFAFA',
    backgroundSelected: '#F4F4F5',
    surface: '#FCFCFC',
    surfaceSecondary: '#F4F4F5',
    surfaceElevated: '#FAFAFA',
    tint: '#18181B',
    tintPressed: '#27272A',
    tintSoft: '#F4F4F5',
    success: '#22C55E',
    successSoft: '#ECFDF3',
    warning: '#EAB308',
    warningSoft: '#FEFCE8',
    danger: '#EF4444',
    purple: '#71717A',
    separator: '#E4E4E7',
    border: '#E4E4E7',
    shadow: 'rgba(0,0,0,0.05)',
  },
  dark: {
    text: '#FAFAFA',
    textSecondary: '#A1A1AA',
    textTertiary: '#71717A',
    textInverse: '#18181B',
    background: '#09090B',
    backgroundElement: '#121214',
    backgroundSelected: '#27272A',
    surface: '#09090B',
    surfaceSecondary: '#27272A',
    surfaceElevated: '#18181B',
    tint: '#FAFAFA',
    tintPressed: '#E4E4E7',
    tintSoft: '#27272A',
    success: '#22C55E',
    successSoft: '#14261A',
    warning: '#EAB308',
    warningSoft: '#2A250C',
    danger: '#EF4444',
    purple: '#A1A1AA',
    separator: '#27272A',
    border: '#27272A',
    shadow: 'rgba(0,0,0,0.28)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = {
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemibold: 'Inter_600SemiBold',
  display: 'Inter_600SemiBold',
  // Compatibility aliases for existing components; the Hackathon system has no serif face.
  serif: 'Inter_600SemiBold',
  serifMedium: 'Inter_600SemiBold',
  rounded: 'Inter_400Regular',
  mono: Platform.select({ ios: 'ui-monospace', web: 'SFMono-Regular, Menlo, monospace', default: 'monospace' }),
} as const;

export const Typography = {
  display: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -1.05 },
  largeTitle: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -1.05 },
  title: { fontFamily: Fonts.display, fontSize: 26, lineHeight: 32, letterSpacing: -0.78 },
  title2: { fontFamily: Fonts.sansSemibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
  title3: { fontFamily: Fonts.sansSemibold, fontSize: 18, lineHeight: 24, letterSpacing: -0.54 },
  headline: { fontFamily: Fonts.sansMedium, fontSize: 15, lineHeight: 21 },
  body: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 22 },
  subheadline: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20 },
  footnote: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, letterSpacing: 0.1 },
  eyebrow: { fontFamily: Fonts.sansMedium, fontSize: 11, lineHeight: 16, letterSpacing: 0.8 },
  code: { fontFamily: Fonts.mono, fontSize: 12, lineHeight: 17 },
} satisfies Record<string, TextStyle>;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  twoHalf: 12,
  three: 16,
  threeHalf: 20,
  four: 24,
  five: 32,
  fiveHalf: 40,
  six: 48,
  seven: 64,
} as const;

export const Radii = { small: 6, medium: 8, large: 12, xlarge: 20, capsule: 999 } as const;

/** The Hackathon UI uses only a quiet 1px lift on floating/card surfaces. */
export const Shadows = {
  card: Platform.select<ViewStyle>({
    web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
    ios: { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 1 },
    default: { elevation: 1 },
  }) ?? {},
  floating: Platform.select<ViewStyle>({
    web: { boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
    ios: { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 1 },
    default: { elevation: 1 },
  }) ?? {},
} as const;

export const Motion = { quick: 140, standard: 220, deliberate: 360 } as const;

export const BottomTabInset = Platform.select({ ios: 52, android: 80 }) ?? 0;
export const MaxContentWidth = 680;
