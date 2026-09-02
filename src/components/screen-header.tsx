import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { CoursePicker } from '@/components/course-picker';
import { ProfileButton } from '@/components/profile-button';
import { RhythmStatusButton } from '@/components/rhythm-status-button';
import { shouldUseCompactHeader } from '@/components/screen-header-layout';
import { Spacing } from '@/constants/theme';

export function ScreenHeader() {
  const { fontScale, width } = useWindowDimensions();
  const compact = shouldUseCompactHeader({ fontScale, width });

  return (
    <View style={styles.row}>
      <RhythmStatusButton compact={compact} />
      <View style={styles.controls}>
        <CoursePicker compact={compact} />
        <ProfileButton />
      </View>
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
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: Spacing.two,
  },
});
