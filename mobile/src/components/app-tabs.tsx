import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';

/**
 * `NativeTabs` is each platform's real tab bar, which is the point — this is chrome the system
 * draws better than we would, and DESIGN.md's third boundary says to let it.
 *
 * **The selected tab is paper, not jade.** Jade means action, and switching which list you are
 * looking at does not act on anything; a jade tab would be the One Meaning Rule leaking.
 */
export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={Colors.canvas}
      indicatorColor={Colors.surfaceDeep}
      labelStyle={{ color: Colors.muted, selected: { color: Colors.foreground } }}
      tintColor={Colors.foreground}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="memories">
        <NativeTabs.Trigger.Label>Memories</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bookmark', selected: 'bookmark.fill' }}
          md="bookmark"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
