import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Fonts } from '@/constants/theme';
import { primaryDestinations } from '@/features/product-shell/navigation';
import { useTheme } from '@/hooks/use-theme';

export default function AppTabs() {
  const colors = useTheme();

  return (
    <NativeTabs
      backgroundColor={colors.backgroundElement}
      iconColor={{ default: colors.textTertiary, selected: colors.text }}
      indicatorColor={colors.surfaceSecondary}
      labelStyle={{
        default: { color: colors.textTertiary, fontFamily: Fonts.sans, fontSize: 11 },
        selected: { color: colors.text, fontFamily: Fonts.sansMedium, fontSize: 11 },
      }}
      tintColor={colors.text}>
      {primaryDestinations.map((destination) => (
        <NativeTabs.Trigger key={destination.id} name={destination.route}>
          <NativeTabs.Trigger.Label>{destination.label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            md={{ default: destination.nativeIcon.android, selected: destination.nativeIcon.android }}
            sf={destination.nativeIcon.ios}
          />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
