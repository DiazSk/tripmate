import { test } from "node:test";
import assert from "node:assert/strict";
import { appleAppSiteAssociation, assetLinks } from "./appLinks.ts";

test("no team id, no association file", () => {
  assert.equal(appleAppSiteAssociation(undefined), null);
  assert.equal(appleAppSiteAssociation("  "), null);
});

test("the association names the app by team and bundle, for shared trips only", () => {
  const file = appleAppSiteAssociation(" ABCDE12345 ");
  assert.deepEqual(file.applinks.details[0].appIDs, ["ABCDE12345.app.tripmate"]);
  assert.deepEqual(file.applinks.details[0].components.map((c) => c["/"]), ["/s/*"]);
});

test("asset links take one or more fingerprints and nothing without one", () => {
  assert.equal(assetLinks(""), null);
  const file = assetLinks("aa:bb, CC:DD");
  assert.equal(file[0].target.package_name, "app.tripmate");
  assert.deepEqual(file[0].target.sha256_cert_fingerprints, ["AA:BB", "CC:DD"]);
});
