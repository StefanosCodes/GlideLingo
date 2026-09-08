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
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: 'home', selected: 'home' }}
          sf={{ default: 'house', selected: 'house.fill' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="quests">
        <NativeTabs.Trigger.Label>Quests</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: 'map', selected: 'map' }}
          sf={{ default: 'map', selected: 'map.fill' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="letters">
        <NativeTabs.Trigger.Label>Letters</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: 'abc', selected: 'abc' }}
          sf={{ default: 'textformat.abc', selected: 'textformat.abc' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="phrases">
        <NativeTabs.Trigger.Label>Phrases</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: 'chat_bubble', selected: 'chat_bubble' }}
          sf={{ default: 'text.bubble', selected: 'text.bubble.fill' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: 'account_circle', selected: 'account_circle' }}
          sf={{ default: 'person.circle', selected: 'person.circle.fill' }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
