import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withEntitlementsPlist, type ConfigPlugin } from 'expo/config-plugins';

/**
 * `app.json`, plus the one thing it cannot say statically: which web host's links open this app.
 *
 * A shared trip is texted as `https://<site>/s/<token>`. For iOS to open that in TripMate the app
 * must claim the host (`associatedDomains`) and the site must serve an association file naming the
 * app (`src/app/.well-known/*` on the server); Android's `autoVerify` intent filter is the same
 * pair. The host is the API's, because one deploy serves both the API and the share pages — so it
 * follows `EXPO_PUBLIC_API_BASE_URL`, which every build already sets (`eas.json`).
 *
 * Only an `https` host is claimed: a local `http://localhost:3000` cannot be verified by Apple or
 * Google, and claiming it would only put a domain nobody can prove into the entitlements.
 */
function linkHost(apiBase: string | undefined): string | null {
  if (!apiBase) return null;
  try {
    const url = new URL(apiBase);
    return url.protocol === 'https:' && !url.hostname.includes('REPLACE') ? url.hostname : null;
  } catch {
    return null;
  }
}

/**
 * `EXPO_PUBLIC_APPLE_SIGN_IN=0` leaves Sign in with Apple out, for a device build signed by a
 * personal (free) Apple team: Apple will not issue such a team a profile with that capability, so
 * the build fails at signing while the plugin's entitlement is there. The sign-in screen reads the
 * same variable and hides the button (`social-sign-in.tsx`). Regenerate `ios/` with
 * `npx expo prebuild -p ios --clean` whenever it changes, since prebuild only adds entitlements.
 */
function withoutAppleSignIn(config: ConfigContext['config']): ConfigContext['config'] {
  if (process.env.EXPO_PUBLIC_APPLE_SIGN_IN !== '0') return config;
  // Both add the entitlement: Expo's plugin for the button, Clerk's for its native Apple flow,
  // which takes `appleSignIn: false` to leave it out.
  const plugins = (config.plugins ?? [])
    .filter((p) => (Array.isArray(p) ? p[0] : p) !== 'expo-apple-authentication')
    .map((p) => {
      const [name, options] = Array.isArray(p) ? p : [p, {}];
      return name === '@clerk/expo' ? (['@clerk/expo', { ...(options ?? {}), appleSignIn: false }] as [string, object]) : p;
    });
  return dropAppleSignIn({ ...config, plugins, ios: { ...config.ios, usesAppleSignIn: false } } as ExpoConfig);
}

/**
 * The last word on the entitlement. Removing the two plugins above is not enough on its own:
 * `expo-apple-authentication` is also applied automatically because it is installed, and it adds the
 * entitlement whatever `usesAppleSignIn` says (measured with `expo config --type introspect`).
 */
const dropAppleSignIn: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['com.apple.developer.applesignin'];
    return mod;
  });

export default ({ config: base }: ConfigContext): ExpoConfig => {
  const config = withoutAppleSignIn(base);
  const host = linkHost(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (!host) return config as ExpoConfig;
  return {
    ...config,
    ios: { ...config.ios, associatedDomains: [`applinks:${host}`] },
    android: {
      ...config.android,
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host, pathPrefix: '/s/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
  } as ExpoConfig;
};
