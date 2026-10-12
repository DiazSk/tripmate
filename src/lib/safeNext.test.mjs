/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/safeNext.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "./safeNext.ts";

test("a path on this site is kept, query and hash included", () => {
  assert.equal(safeNextPath("/trip/abc?x=1#y"), "/trip/abc?x=1#y");
});

test("anything that resolves off-site falls back to Trips", () => {
  for (const next of ["/\t/evil.com", "/\n/evil.com", "/\\evil.com", "//evil.com", "https://evil.com", "javascript:alert(1)"]) {
    assert.equal(safeNextPath(next), "/trips", JSON.stringify(next));
  }
});

test("a repeated or missing param falls back rather than throwing", () => {
  assert.equal(safeNextPath(["/a", "/b"]), "/trips");
  assert.equal(safeNextPath(undefined), "/trips");
  assert.equal(safeNextPath(null), "/trips");
});
