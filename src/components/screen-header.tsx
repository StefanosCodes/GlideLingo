import { StyleSheet, View } from 'react-native';

import { CoursePicker } from '@/components/course-picker';
import { RhythmStatusButton } from '@/components/rhythm-status-button';
import { Spacing } from '@/constants/theme';

export function ScreenHeader() {
  return (
    <View style={styles.row}>
      <RhythmStatusButton />
      <CoursePicker />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'space-between',
    overflow: 'visible',
    zIndex: 100,
  },
});
