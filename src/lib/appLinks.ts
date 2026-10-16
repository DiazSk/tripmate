/**
 * The two files that let a share link open the phone app instead of the browser.
 *
 * A link somebody texts is `https://<site>/s/<token>`. iOS opens it in TripMate only if this site
 * serves `/.well-known/apple-app-site-association` naming the app, and Android only if it serves
 * `/.well-known/assetlinks.json` naming the app's signing certificate; the app, for its part,
 * claims the host (`mobile/app.config.ts`). Without either file the link still works, in the
 * browser, as `/s/[token]` always has.
 *
 * **Both are configuration, not code.** The Apple team id and the signing fingerprint belong to the
 * account that ships the app, so they come from the environment, and with them unset the routes
 * answer 404 rather than publishing a file that names an app nobody signed.
 */

/** The app's identity on both platforms (`mobile/app.json`: `ios.bundleIdentifier`, `android.package`). */
export const APP_ID = "app.tripmate";

/** Only shared trips open in the app; every other path stays the website's. */
export const APP_PATHS = ["/s/*"];

export function appleAppSiteAssociation(teamId: string | undefined, bundleId = APP_ID) {
  const team = teamId?.trim();
  if (!team) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [`${team}.${bundleId}`],
          components: APP_PATHS.map((path) => ({ "/": path, comment: "A trip somebody shared" })),
        },
      ],
    },
  };
}

/** `fingerprints` is the comma-separated `ANDROID_CERT_SHA256`: one per signing key in use. */
export function assetLinks(fingerprints: string | undefined, packageName = APP_ID) {
  const list = (fingerprints ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);
  if (!list.length) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: list },
    },
  ];
}
