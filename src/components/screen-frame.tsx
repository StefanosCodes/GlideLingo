import { type PropsWithChildren } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

type ScreenFrameProps = PropsWithChildren<{
  chrome?: boolean;
  includeTabInset?: boolean;
  contentStyle?: ViewStyle;
  testID?: string;
}>;

export function ScreenFrame({
  children,
  chrome = true,
  includeTabInset = true,
  contentStyle,
  testID,
}: ScreenFrameProps) {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const top = chrome
    ? Spacing.three
    : isWeb
      ? Spacing.five
      : Platform.OS === 'ios'
        ? Spacing.three
        : insets.top + Spacing.three;
  const bottom = insets.bottom + (includeTabInset && !isWeb ? BottomTabInset : 0) + Spacing.six;
  const chromeTop = isWeb ? Spacing.four : insets.top + Spacing.two;

  return (
    <ThemedView style={styles.screen} testID={testID}>
      {chrome ? (
        <View style={[styles.chrome, { paddingTop: chromeTop }]}>
          <ScreenHeader />
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: bottom }, contentStyle]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chrome: {
    overflow: 'visible',
    paddingHorizontal: Spacing.threeHalf,
    zIndex: 100,
  },
  content: {
    alignSelf: 'center',
    gap: Spacing.five,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.threeHalf,
    width: '100%',
  },
});
