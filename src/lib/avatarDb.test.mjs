/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/avatarDb.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { deleteAvatar, getAvatar, getUserImage, putAvatar, rawDb } from "./db.ts";

function makeUser(id) {
  const now = new Date().toISOString();
  rawDb
    .prepare(`INSERT INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`)
    .run(id, "Zaid", `${id}@example.com`, 0, now, now);
}

test("putAvatar stores the bytes and points user.image at the versioned URL", () => {
  makeUser("u-avatar-1");
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
  const url = putAvatar("u-avatar-1", bytes, "image/jpeg");
  assert.match(url, /^\/api\/avatar\/u-avatar-1\?v=\d+$/);
  assert.equal(getUserImage("u-avatar-1"), url);
  const row = getAvatar("u-avatar-1");
  assert.equal(row.mime, "image/jpeg");
  assert.deepEqual([...row.bytes], [...bytes]);
});

test("a second upload replaces the first and changes the URL", async () => {
  makeUser("u-avatar-2");
  const first = putAvatar("u-avatar-2", new Uint8Array([0xff, 0xd8, 0xff, 1]), "image/jpeg");
  await new Promise((r) => setTimeout(r, 5));
  const second = putAvatar("u-avatar-2", new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
  assert.notEqual(first, second);
  assert.equal(getAvatar("u-avatar-2").mime, "image/png");
});

test("deleteAvatar removes the bytes and clears user.image", () => {
  makeUser("u-avatar-3");
  putAvatar("u-avatar-3", new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg");
  deleteAvatar("u-avatar-3");
  assert.equal(getAvatar("u-avatar-3"), undefined);
  assert.equal(getUserImage("u-avatar-3"), null);
});
