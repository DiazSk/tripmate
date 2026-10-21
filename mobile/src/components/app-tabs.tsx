import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Polar } from '@/constants/polar';

/**
 * `NativeTabs` is each platform's real tab bar, which is the point — this is chrome the system
 * draws better than we would, and DESIGN.md's third boundary says to let it.
 *
 * **Light, because every page it sits over is paper.** Home, Trips and Profile hard-code the light
 * ground while the app runs in dark appearance, so this bar used to be the night palette (a dark
 * tint, white labels) over white pages: about 2:1, with the selected tab told apart only by a faint
 * pill. `(tabs)/_layout.tsx` puts the window in the light trait while the tabs show, so the system
 * draws light glass the way the designs (home-4, trips-2, profile-4) show it; the colours are said
 * outright too, for Android, which has no such trait.
 *
 * **The selected tab is ink, not signal.** Signal means action, and switching which list you are
 * looking at does not act on anything; a signal tab would be the One Meaning Rule leaking.
 */
export default function AppTabs() {
  return (
    <NativeTabs
      labelStyle={{ default: { color: Polar.secondary }, selected: { color: Polar.ink } }}
      iconColor={{ default: Polar.secondary, selected: Polar.ink }}
      tintColor={Polar.ink}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="trips">
        <NativeTabs.Trigger.Label>Trips</NativeTabs.Trigger.Label>
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
