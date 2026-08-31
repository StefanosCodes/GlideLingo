import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, Typography, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextVariant = keyof typeof Typography;

export type ThemedTextProps = TextProps & {
  type?: TextVariant | 'default' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary';
  themeColor?: ThemeColor;
};

const legacyVariantMap = {
  default: 'body',
  small: 'footnote',
  smallBold: 'footnote',
  subtitle: 'title',
  link: 'footnote',
  linkPrimary: 'footnote',
} as const;

export function ThemedText({ style, type = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const variant = type in legacyVariantMap ? legacyVariantMap[type as keyof typeof legacyVariantMap] : type;
  const resolvedColor = themeColor ?? (type === 'linkPrimary' ? 'tint' : 'text');

  return (
    <Text
      style={[
        { color: theme[resolvedColor] },
        Typography[variant as TextVariant],
        type === 'smallBold' && styles.semibold,
        (type === 'link' || type === 'linkPrimary') && styles.link,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  semibold: { fontFamily: Fonts.sansMedium },
  link: { fontFamily: Fonts.sansMedium },
});
