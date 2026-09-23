// Learn more https://docs.expo.io/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Let the app import the web app's pure planning logic instead of copying it a third time.
 *
 * `src/lib/dayFit.ts` decides which day a place belongs to and `src/lib/daySlotting.ts` decides
 * what time it gets. Both already exist, both are pure TypeScript with no Node and no Next, and
 * both already carry their own tests. The frozen Swift app made a second copy of them by
 * necessity; a third copy in TypeScript, sitting beside the original in the same repository, is
 * where the two clients would quietly start giving different answers to the same question.
 *
 * Metro only bundles files under the project root, so the shared directory has to be named as a
 * watch folder. It is named **narrowly, and that matters**: pointing this at the repository root
 * would put the web app's whole `node_modules` inside Metro's watch set.
 *
 * The TypeScript half of this lives in `tsconfig.json` as the `@shared/*` path.
 */
const shared = path.resolve(__dirname, '../src/lib');

config.watchFolders = [shared];

/**
 * **`watchFolders` alone is not enough, and the way it fails is worth knowing.** It lets Metro
 * *watch* files outside the project; it does not teach it the `@shared/*` alias. Metro does not
 * read `tsconfig.json` paths either — so `tsc` and `jest` both resolved these imports and stayed
 * green while the bundler refused them, and the first sign of it was a red screen on the device.
 * This is the line that actually maps the name.
 */
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@shared': shared,
};

module.exports = config;
