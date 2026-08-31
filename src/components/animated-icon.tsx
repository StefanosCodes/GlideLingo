import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { GlideSymbol } from '@/components/ui/glide-symbol';
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';

const DURATION = 260;
const fadeOut = new Keyframe({
  0: { opacity: 1 },
  100: { opacity: 0, easing: Easing.out(Easing.quad) },
});

export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);
  const scheme = useColorScheme();
  const theme = Colors[scheme === 'dark' ? 'dark' : 'light'];

  if (!visible) return null;

  const wordmark = (
    <View style={styles.wordmark}>
      <View style={[styles.mark, { borderColor: theme.border }]}>
        <GlideSymbol
          name={{ ios: 'airplane', android: 'flight', web: 'flight' }}
          size={16}
          tintColor={theme.text}
        />
      </View>
      <Text style={[styles.name, { color: theme.text }]}>GlideLingo</Text>
    </View>
  );

  return animate ? (
    <Animated.View
      entering={fadeOut.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) scheduleOnRN(setVisible, false);
      })}
      style={[styles.overlay, { backgroundColor: theme.background }]}>
      {wordmark}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => setAnimate(true));
      }}
      style={[styles.overlay, { backgroundColor: theme.background }]}>
      {wordmark}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: Spacing.twoHalf },
  mark: { width: 38, height: 38, borderRadius: Radii.medium, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: Fonts.serif, fontSize: 28, lineHeight: 34 },
});
