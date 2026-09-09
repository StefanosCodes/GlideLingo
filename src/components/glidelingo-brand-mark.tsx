import { Image } from 'expo-image';

export function GlideLingoBrandMark({ size = 32 }: { size?: number; color?: string }) {
  return (
    <Image
      accessibilityIgnoresInvertColors
      contentFit="contain"
      source={require('@/assets/brand/glidelingo-bird.png')}
      style={{ height: size, width: size }}
    />
  );
}
