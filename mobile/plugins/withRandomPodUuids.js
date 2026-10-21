// ponytail: delete once Expo installs its collision-safe UUID generator before the Podfile's
// post_install (node_modules/expo-modules-autolinking/scripts/ios/cocoapods/installer.rb installs
// it in perform_post_install_actions, which runs after). Check: drop this, pod install, and see
// that Pods.xcodeproj still has an `isa = PBXProject` object.
const { withPodfile } = require("expo/config-plugins");

const ANCHOR = "post_install do |installer|\n";
const MARKER = "# withRandomPodUuids";

/**
 * **CocoaPods gave clerk-ios's Swift package the Pods project's own ID.**
 *
 * `Pod::Project` hands out IDs from a sequential counter with no collision check, and the counter
 * restarts, so a new object can take an ID that is already in the file. React Native's
 * `spm_dependency` support adds clerk-ios's `XCRemoteSwiftPackageReference` inside
 * `react_native_post_install`, and it got the root project's ID: `rootObject` pointed at the
 * package, the `PBXProject` was gone, Xcode called the Pods project damaged
 * (`_setSavedArchiveVersion: unrecognized selector`), built none of the pods, and the first one
 * imported failed as `no such module 'ExpoClipboard'`. It surfaced when expo-clipboard and
 * expo-haptics changed the object count.
 *
 * Expo already ships the fix, random IDs checked against the ones in the file, but installs it
 * after the Podfile's `post_install`, too late for the package. This installs the same generator
 * first.
 */
const GENERATOR = `    ${MARKER}: collision-safe IDs before react_native_post_install adds Swift packages.
    taken = installer.pods_project.objects_by_uuid.keys.to_set
    installer.pods_project.define_singleton_method(:generate_available_uuid_list) do |count = 100|
      fresh = (0..count).map { SecureRandom.hex(12).upcase }.reject { |u| taken.include?(u) || @generated_uuids.include?(u) }
      @generated_uuids += fresh
      @available_uuids += fresh
    end
`;

function addSafeUuids(podfile) {
  if (podfile.includes(MARKER)) return podfile;
  if (!podfile.includes(ANCHOR)) throw new Error(`withRandomPodUuids: "${ANCHOR.trim()}" not found in the Podfile`);
  return podfile.replace(ANCHOR, ANCHOR + GENERATOR);
}

module.exports = (config) =>
  withPodfile(config, (mod) => {
    mod.modResults.contents = addSafeUuids(mod.modResults.contents);
    return mod;
  });
module.exports.addSafeUuids = addSafeUuids;
