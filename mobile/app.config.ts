import type { ConfigContext, ExpoConfig } from 'expo/config';

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

export default ({ config }: ConfigContext): ExpoConfig => {
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
