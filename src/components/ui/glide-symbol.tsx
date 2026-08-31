import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type GlideSymbolProps = Omit<SymbolViewProps, 'fallback' | 'style'> & { containerStyle?: StyleProp<ViewStyle> };

export function GlideSymbol({ containerStyle, tintColor, size = 20, ...props }: GlideSymbolProps) {
  const theme = useTheme();

  return (
    <View style={containerStyle}>
      <SymbolView
        fallback={<ThemedText type="caption">●</ThemedText>}
        resizeMode="scaleAspectFit"
        size={size}
        tintColor={tintColor ?? theme.text}
        {...props}
      />
    </View>
  );
}
