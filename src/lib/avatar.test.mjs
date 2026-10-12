/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/avatar.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { AVATAR_MAX_BYTES, avatarTint, avatarUrl, initialsFor, parseAvatarUpload } from "./avatar.ts";

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];

test("a small JPEG, PNG or WebP is accepted with its bytes", () => {
  for (const [mediaType, bytes] of [["image/jpeg", JPEG], ["image/png", PNG], ["image/webp", WEBP]]) {
    const r = parseAvatarUpload({ mediaType, data: b64(bytes) });
    assert.equal(r.ok, true, mediaType);
    assert.equal(r.mime, mediaType);
    assert.deepEqual([...r.bytes], bytes);
  }
});

test("a type outside the allow-list is refused", () => {
  const r = parseAvatarUpload({ mediaType: "image/gif", data: b64(JPEG) });
  assert.equal(r.ok, false);
  assert.match(r.error, /JPEG, PNG or WebP/);
});

test("bytes that do not match the stated type are refused", () => {
  assert.equal(parseAvatarUpload({ mediaType: "image/png", data: b64(JPEG) }).ok, false);
});

test("a body over 200 KB is refused with a message a person can act on", () => {
  const big = new Uint8Array(AVATAR_MAX_BYTES + 1); big.set(JPEG);
  let s = ""; for (const b of big) s += String.fromCharCode(b);
  const r = parseAvatarUpload({ mediaType: "image/jpeg", data: btoa(s) });
  assert.equal(r.ok, false);
  assert.match(r.error, /too large/);
});

test("empty, missing or malformed data is refused", () => {
  assert.equal(parseAvatarUpload({ mediaType: "image/jpeg", data: "" }).ok, false);
  assert.equal(parseAvatarUpload({ mediaType: "image/jpeg", data: "%%%not-base64" }).ok, false);
  assert.equal(parseAvatarUpload(null).ok, false);
});

test("initials come from up to two words, and never break on odd names", () => {
  assert.equal(initialsFor("Zaid"), "Z");
  assert.equal(initialsFor("  zaid   shaikh "), "ZS");
  assert.equal(initialsFor("Ana María de la Cruz"), "AM");
  assert.equal(initialsFor("-"), "?");
  assert.equal(initialsFor(""), "?");
  assert.equal(initialsFor(null), "?");
  assert.equal(initialsFor("A".repeat(20) + " " + "B".repeat(19)), "AB");
});

test("the avatar URL changes with each update, so it can be cached forever", () => {
  const a = avatarUrl("u-1", "2026-10-12T10:00:00.000Z");
  const b = avatarUrl("u-1", "2026-10-12T10:00:01.000Z");
  assert.match(a, /^\/api\/avatar\/u-1\?v=\d+$/);
  assert.notEqual(a, b);
});

test("the tint is stable per account and one of the five day-route colours", () => {
  assert.equal(avatarTint("abc"), avatarTint("abc"));
  assert.ok(["#4e8c99", "#a46e93", "#c4784b", "#7e9c5e", "#7b77ae"].includes(avatarTint("abc")));
});
