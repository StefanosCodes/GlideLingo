import { StyleSheet, View } from 'react-native';

import { CoursePicker } from '@/components/course-picker';

export function ScreenHeader() {
  return (
    <View style={styles.row}>
      <CoursePicker />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    overflow: 'visible',
    zIndex: 100,
  },
});
