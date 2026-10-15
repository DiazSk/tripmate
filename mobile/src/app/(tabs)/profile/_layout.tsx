import { Stack } from 'expo-router';

import { SettingsColors } from '@/components/settings-list';
import { Polar } from '@/constants/polar';
import { ProfileProvider } from '@/lib/profileStore';

/**
 * Profile is a settings screen with a stack of its own: the main page, and the lists it pushes
 * (interests, dietary needs, home city, saved places, the account). The provider wraps the stack so
 * every screen in it edits one copy of the profile, and its focus is the tab's (`profileStore.tsx`).
 *
 * The page is light while the app runs in dark appearance, so the bar's colours are said outright.
 */
/** The main page is the stack's root, so a deep link to a pushed screen still has Profile under it. */
export const unstable_settings = { initialRouteName: 'index' };

export default function ProfileLayout() {
  return (
    <ProfileProvider>
      <Stack
        screenOptions={{
          headerTintColor: Polar.ember,
          headerTitleStyle: { color: '#000' },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: SettingsColors.ground },
          contentStyle: { backgroundColor: SettingsColors.ground },
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="interests" options={{ title: 'Interests' }} />
        <Stack.Screen name="dietary" options={{ title: 'Dietary Needs' }} />
        <Stack.Screen name="home" options={{ title: 'Home City' }} />
        <Stack.Screen name="places" options={{ title: 'Saved Places' }} />
        <Stack.Screen name="account" options={{ title: 'Account' }} />
      </Stack>
    </ProfileProvider>
  );
}
