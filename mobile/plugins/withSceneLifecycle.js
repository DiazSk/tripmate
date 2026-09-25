// ponytail: delete this plugin once Expo's prebuild template adopts
// ExpoAppSceneDelegate itself — see node_modules/expo/ios/AppDelegates/ExpoAppSceneDelegate.swift,
// which already ships the fix and is only not wired up by `expo prebuild` yet.
const { withInfoPlist, withAppDelegate } = require("expo/config-plugins");

// UIKit resolves this straight from the class's @objc(EXExpoAppSceneDelegate) name (see
// node_modules/expo/ios/AppDelegates/ExpoAppSceneDelegate.swift) — no module prefix needed.
const SCENE_DELEGATE_CLASS_NAME = "EXExpoAppSceneDelegate";

const CLASS_ANCHOR = "class AppDelegate: ExpoAppDelegate {";
const CLASS_WITH_CONFORMANCE = "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {";

// Matches the `#if os(iOS) || os(tvOS)` block the Expo prebuild template generates, which builds
// the window and starts React Native into it directly from the app delegate. Under the scene
// lifecycle that job moves to ExpoAppSceneDelegate, so this block has to go — leaving it in means
// two different places race to create the window.
const WINDOW_BLOCK_RE =
  /#if os\(iOS\) \|\| os\(tvOS\)\r?\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\r?\n\s*factory\.startReactNative\(\r?\n\s*withModuleName: "main",\r?\n\s*in: window,\r?\n\s*launchOptions: launchOptions\)\r?\n\s*#endif\r?\n?/;
const WINDOW_BLOCK_REMOVED_MARKER =
  "// ponytail: window creation moved to ExpoAppSceneDelegate for the iOS 27 scene lifecycle\n";

/**
 * Adapts a generated `ios/TripMate/AppDelegate.swift` for the scene lifecycle:
 * - makes `AppDelegate` conform to `ExpoReactNativeFactoryProvider` (required by
 *   `ExpoAppSceneDelegate` to reach the factory it creates)
 * - removes the window-creation / `startReactNative` block, since the scene delegate does that now
 *
 * Idempotent: running it twice is a no-op the second time. Throws if the anchors it needs aren't
 * found and it's not already applied, so a template change fails loudly instead of shipping a
 * silently-crashing app.
 *
 * @param {string} src
 * @returns {string}
 */
function transformAppDelegate(src) {
  let out = src;

  if (out.includes(CLASS_ANCHOR)) {
    out = out.replace(CLASS_ANCHOR, CLASS_WITH_CONFORMANCE);
  } else if (!out.includes(CLASS_WITH_CONFORMANCE)) {
    throw new Error(
      "withSceneLifecycle: couldn't find `" +
        CLASS_ANCHOR +
        "` in AppDelegate.swift to add ExpoReactNativeFactoryProvider conformance. " +
        "The Expo prebuild template may have changed — update withSceneLifecycle.js's anchor."
    );
  }

  if (WINDOW_BLOCK_RE.test(out)) {
    out = out.replace(WINDOW_BLOCK_RE, WINDOW_BLOCK_REMOVED_MARKER);
  } else if (!out.includes(WINDOW_BLOCK_REMOVED_MARKER)) {
    throw new Error(
      "withSceneLifecycle: couldn't find the window-creation / startReactNative block in " +
        "AppDelegate.swift to remove for the scene lifecycle. The Expo prebuild template may have " +
        "changed — update withSceneLifecycle.js's anchor."
    );
  }

  return out;
}

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: "Default Configuration",
        UISceneDelegateClassName: SCENE_DELEGATE_CLASS_NAME,
      },
    ],
  },
};

// Required by iOS 27, which SIGTRAPs at launch (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption)
// if the app has no UIApplicationSceneManifest. `ios/` is generated/git-ignored, so this has to be
// a config plugin rather than a hand edit.
const withSceneLifecycle = (config) => {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return config;
  });

  config = withAppDelegate(config, (config) => {
    config.modResults.contents = transformAppDelegate(config.modResults.contents);
    return config;
  });

  return config;
};

module.exports = withSceneLifecycle;
module.exports.transformAppDelegate = transformAppDelegate;
