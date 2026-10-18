/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/accountsDb.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  appendChatTurn,
  createLlmSession,
  deleteAccountData,
  getAvatar,
  getOrCreateAccount,
  insertGeneration,
  insertRun,
  insertTrace,
  insertTrip,
  insertTripArtifacts,
  isAccountOwnerId,
  listSavedPlaces,
  listTrips,
  putAvatar,
  rawDb,
  saveStoryScript,
  upsertSavedPlaces,
  writeProfile,
} from "./db.ts";
import { isValidOwnerId } from "./owner.ts";

const trip = (ownerId) =>
  insertTrip({
    id: randomUUID(),
    destination: "Kyoto",
    start_date: "2026-04-01",
    end_date: "2026-04-04",
    budget: 1200,
    itinerary_json: JSON.stringify({ days: [] }),
    owner_id: ownerId,
  }).id;

test("a new Clerk user gets one UUID owner id, and keeps it", () => {
  const a = getOrCreateAccount("user_acc_1");
  assert.ok(isValidOwnerId(a.owner_id));
  assert.equal(a.onboarded_at, null);
  assert.equal(getOrCreateAccount("user_acc_1").owner_id, a.owner_id);
});

test("a repeat call for the same user returns the same owner and inserts no second row", async () => {
  const [a, b] = await Promise.all([
    Promise.resolve().then(() => getOrCreateAccount("user_acc_race")),
    Promise.resolve().then(() => getOrCreateAccount("user_acc_race")),
  ]);
  assert.equal(a.owner_id, b.owner_id);
  assert.equal(
    rawDb.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE clerk_user_id = ?`).get("user_acc_race").n,
    1,
  );
});

test("different users get different owners", () => {
  assert.notEqual(getOrCreateAccount("user_acc_2").owner_id, getOrCreateAccount("user_acc_3").owner_id);
});

test("deleteAccountData removes the account and everything it owns, and nobody else's", () => {
  const gone = getOrCreateAccount("user_acc_del").owner_id;
  const kept = getOrCreateAccount("user_acc_keep").owner_id;
  const goneTrip = trip(gone);
  const keptTrip = trip(kept);
  appendChatTurn({ tripId: goneTrip, role: "user", content: "hi" });
  saveStoryScript({ tripId: goneTrip, dayIndex: 0, fingerprint: "f", script: { beats: [] } });
  upsertSavedPlaces(gone, [{ name: "Fushimi", city: "Kyoto", lat: 1, lng: 2, source: "map", url: null }]);
  writeProfile({ group: "solo", explorerStyle: "relaxed", energy: "moderate", crowds: "avoid", priorities: ["food"] }, gone);
  putAvatar(gone, new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg");

  assert.equal(deleteAccountData("user_acc_del"), true);

  assert.equal(rawDb.prepare(`SELECT 1 FROM accounts WHERE clerk_user_id = ?`).get("user_acc_del"), undefined);
  assert.equal(listTrips("saved", gone, true).length + listTrips("draft", gone, true).length, 0);
  assert.equal(rawDb.prepare(`SELECT COUNT(*) AS n FROM trip_chat_turns WHERE trip_id = ?`).get(goneTrip).n, 0);
  assert.equal(rawDb.prepare(`SELECT COUNT(*) AS n FROM trip_stories WHERE trip_id = ?`).get(goneTrip).n, 0);
  assert.equal(listSavedPlaces(gone, true).length, 0);
  assert.equal(rawDb.prepare(`SELECT 1 FROM traveler_profile WHERE owner_id = ?`).get(gone), undefined);
  assert.equal(getAvatar(gone), undefined);

  assert.ok(rawDb.prepare(`SELECT 1 FROM trips WHERE id = ?`).get(keptTrip));
  assert.ok(rawDb.prepare(`SELECT 1 FROM accounts WHERE clerk_user_id = ?`).get("user_acc_keep"));
});

test("deleteAccountData for an unknown user changes nothing", () => {
  const kept = getOrCreateAccount("user_acc_bystander").owner_id;
  trip(kept);
  assert.equal(deleteAccountData("user_never_seen"), false);
  assert.ok(rawDb.prepare(`SELECT 1 FROM trips WHERE owner_id = ?`).get(kept));
});

test("deleteAccountData clears the generation trail too: runs, traces, artifacts, sessions", () => {
  const owner = getOrCreateAccount("user_acc_trail").owner_id;
  const runId = randomUUID();
  const sessionId = createLlmSession([{ role: "user", content: "hi" }]);
  const tripId = insertTrip({
    id: randomUUID(),
    destination: "Kyoto",
    start_date: "2026-04-01",
    end_date: "2026-04-04",
    budget: 1200,
    itinerary_json: JSON.stringify({ days: [] }),
    owner_id: owner,
    run_id: runId,
    chat_session_id: sessionId,
  }).id;
  insertRun({ id: runId, kind: "generate", destination: "Kyoto" });
  insertTrace({ type: "generate", prompt: "p", model: "m", runId });
  insertTripArtifacts({ run_id: runId, trip_context_md: "c", itinerary_md: "i" });
  insertGeneration({ run_id: runId, trip_id: tripId, session_id: sessionId, kind: "generate", destination: "Kyoto", context_json: "{}", prompt: "p", response: "r", model: "m", mode: "cli" });

  assert.equal(deleteAccountData("user_acc_trail"), true);

  for (const [table, col, val] of [
    ["llm_runs", "id", runId],
    ["llm_traces", "run_id", runId],
    ["trip_artifacts", "run_id", runId],
    ["generations", "run_id", runId],
    ["llm_sessions", "id", sessionId],
  ]) {
    assert.equal(rawDb.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(val).n, 0, table);
  }
});

// The back-fill of `generations.trip_id` can be missed; `trips.run_id` still names the run.
test("deleteAccountData removes a generation that was never linked to its trip", () => {
  const owner = getOrCreateAccount("user_acc_unlinked").owner_id;
  const runId = randomUUID();
  insertTrip({
    id: randomUUID(),
    destination: "Kyoto",
    start_date: "2026-04-01",
    end_date: "2026-04-04",
    budget: 1200,
    itinerary_json: JSON.stringify({ days: [] }),
    owner_id: owner,
    run_id: runId,
  });
  insertGeneration({ run_id: runId, trip_id: null, session_id: null, kind: "generate", destination: "Kyoto", context_json: "{}", prompt: "p", response: "r", model: "m", mode: "cli" });

  assert.equal(deleteAccountData("user_acc_unlinked"), true);
  assert.equal(rawDb.prepare(`SELECT COUNT(*) AS n FROM generations WHERE run_id = ?`).get(runId).n, 0);
});

test("isAccountOwnerId is true only for an account's owner id", () => {
  const a = getOrCreateAccount("user_acc_is_owner");
  assert.equal(isAccountOwnerId(a.owner_id), true);
  assert.equal(isAccountOwnerId(randomUUID()), false);
  assert.equal(isAccountOwnerId("local"), false);
});
