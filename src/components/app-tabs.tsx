import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Fonts } from '@/constants/theme';
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
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: 'home', selected: 'home' }}
          sf={{ default: 'house', selected: 'house.fill' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="path">
        <NativeTabs.Trigger.Label>Path</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: 'map', selected: 'map' }}
          sf={{ default: 'map', selected: 'map.fill' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="review">
        <NativeTabs.Trigger.Label>Review</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: 'replay', selected: 'replay' }}
          sf={{ default: 'arrow.clockwise', selected: 'arrow.clockwise' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="progress">
        <NativeTabs.Trigger.Label>Progress</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: 'bar_chart', selected: 'bar_chart' }}
          sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
