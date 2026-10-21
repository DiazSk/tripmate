const { addSafeUuids } = require("./withRandomPodUuids");

// The tail of `ios/Podfile` as `expo prebuild` generates it for SDK 57; `ios/` is git-ignored, so
// this is the only record of the anchor the plugin needs.
const TEMPLATE = `  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`;

describe("addSafeUuids", () => {
  it("installs the generator before react_native_post_install", () => {
    const out = addSafeUuids(TEMPLATE);
    expect(out.indexOf("generate_available_uuid_list")).toBeGreaterThan(-1);
    expect(out.indexOf("generate_available_uuid_list")).toBeLessThan(out.indexOf("react_native_post_install("));
  });

  it("is a no-op the second time", () => {
    const once = addSafeUuids(TEMPLATE);
    expect(addSafeUuids(once)).toBe(once);
  });

  it("throws when the template has no post_install", () => {
    expect(() => addSafeUuids("target 'TripMate' do\nend\n")).toThrow(/post_install/);
  });
});
