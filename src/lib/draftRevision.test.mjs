import assert from "node:assert/strict";
import test from "node:test";
import { announceDraftRevision, onDraftRevision } from "./draftRevision.ts";

test("a revision reaches the trip page already listening for that trip", () => {
  let got = 0;
  const off = onDraftRevision("a", () => got++);
  announceDraftRevision("a");
  off();
  assert.equal(got, 1);
});

test("a revision that arrives before the page mounts is held for it, and handed over once", () => {
  announceDraftRevision("b");
  let first = 0;
  onDraftRevision("b", () => first++)();
  let second = 0;
  onDraftRevision("b", () => second++)();
  assert.equal(first, 1);
  // A later visit must not re-read on its account.
  assert.equal(second, 0);
});

test("another trip's page is never told", () => {
  announceDraftRevision("c");
  let got = 0;
  const off = onDraftRevision("d", () => got++);
  announceDraftRevision("c");
  off();
  assert.equal(got, 0);
});

test("an unmounted page stops receiving", () => {
  let got = 0;
  onDraftRevision("e", () => got++)();
  announceDraftRevision("e");
  assert.equal(got, 0);
});
