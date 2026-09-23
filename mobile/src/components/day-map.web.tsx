import { StyleSheet, View } from 'react-native';

import { Invitation } from '@/components/states';
import { Spacing } from '@/constants/theme';

/**
 * No map on web.
 *
 * `app.json` sets `web.output: "static"`, so the trip route is bundled for web too — and
 * `react-native-maps` has no web build, which would fail the bundle rather than this screen. The
 * platform-suffix convention `app-tabs.web.tsx` and `animated-icon.web.tsx` already establish is
 * what keeps the native import out of that bundle entirely.
 *
 * Props are accepted and ignored so the two files stay interchangeable at the call site.
 */
export function DayMap(_props: unknown) {
  return (
    <View style={styles.empty}>
      <Invitation title="The map is on the phone" body="Open this trip in the app to see it." />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, paddingTop: Spacing.regular },
});
