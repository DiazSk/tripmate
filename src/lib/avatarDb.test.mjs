/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/avatarDb.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { deleteAvatar, getAccountImage, getAvatar, getOrCreateAccount, putAvatar } from "./db.ts";

const owner = (clerkId) => getOrCreateAccount(clerkId).owner_id;

test("putAvatar stores the bytes and points the account at the versioned URL", () => {
  const id = owner("user_av_1");
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
  const url = putAvatar(id, bytes, "image/jpeg");
  assert.match(url, new RegExp(`^/api/avatar/${id}\\?v=\\d+$`));
  assert.equal(getAccountImage(id), url);
  const row = getAvatar(id);
  assert.equal(row.mime, "image/jpeg");
  assert.deepEqual([...row.bytes], [...bytes]);
});

test("a second upload replaces the first and changes the URL", async () => {
  const id = owner("user_av_2");
  const first = putAvatar(id, new Uint8Array([0xff, 0xd8, 0xff, 1]), "image/jpeg");
  await new Promise((r) => setTimeout(r, 5));
  const second = putAvatar(id, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
  assert.notEqual(first, second);
  assert.equal(getAvatar(id).mime, "image/png");
});

test("deleteAvatar removes the bytes and clears the account image", () => {
  const id = owner("user_av_3");
  putAvatar(id, new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg");
  deleteAvatar(id);
  assert.equal(getAvatar(id), undefined);
  assert.equal(getAccountImage(id), null);
});
