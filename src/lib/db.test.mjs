import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  appendLlmSessionTurns,
  applyRevisionIfUnedited,
  createLlmSession,
  deleteTrip,
  getGeneration,
  getLlmSession,
  getTrip,
  getTripByShareToken,
  insertGeneration,
  insertTrip,
  linkGenerationToTrip,
  setTripShareToken,
  updateTripItinerary,
  writeRevisionOver,
} from "./db.ts";
import { normalizeDays } from "./itinerary.ts";

test("createLlmSession/getLlmSession round-trip the messages array", () => {
  const id = createLlmSession([{ role: "user", content: "hi" }]);
  assert.deepEqual(getLlmSession(id), [{ role: "user", content: "hi" }]);
});

test("appendLlmSessionTurns adds to the stored history without dropping earlier turns", () => {
  const id = createLlmSession([{ role: "user", content: "first" }]);
  appendLlmSessionTurns(id, [{ role: "assistant", content: "reply" }]);
  assert.deepEqual(getLlmSession(id), [
    { role: "user", content: "first" },
    { role: "assistant", content: "reply" },
  ]);
});

test("getLlmSession returns undefined for an id that was never created", () => {
  assert.equal(getLlmSession("does-not-exist"), undefined);
});

/* The one property that cannot be checked from inside a single test: that this file, and the
 * three others that open a database, are not writing into the developer's own.
 *
 * They were. `db.ts` resolves `DB_PATH ?? cwd/tripmate.db` and opens it at import time, so a plain
 * `npm test` inserted four real trips per run — fixture destinations ("Kyoto", "Legacy town")
 * accumulating on the memories wall beside real ones, with nothing failing and nobody told.
 * `scripts/test-db.mjs` fixes it by setting `DB_PATH` to `:memory:` before any of this loads.
 *
 * This assert is what notices if that `--import` is ever dropped from the `test` script, or if a
 * future runner stops passing `execArgv` down to the per-file child processes. It deliberately
 * re-derives the path the same way `db.ts` does rather than asserting `DB_PATH === ":memory:"`,
 * so pointing a one-off run at a scratch file for an investigation still passes. */
test("the suite never opens the developer's own database", () => {
  const ownDatabase = path.join(process.cwd(), "tripmate.db");
  assert.notEqual(
    process.env.DB_PATH ?? ownDatabase,
    ownDatabase,
    "tests are writing to the real tripmate.db — is scripts/test-db.mjs still --imported by the test script?"
  );
});


/* --- publishing a trip, and taking it back --- */

let seq = 0;
const aTrip = (owner) =>
  insertTrip({
    id: `share-test-${++seq}`,
    destination: "Lisbon",
    start_date: "2026-10-22",
    end_date: "2026-10-22",
    budget: 100,
    itinerary_json: JSON.stringify({ days: [] }),
    owner_id: owner,
  });

test("a trip is not shared until somebody shares it", () => {
  const owner = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const trip = aTrip(owner);
  assert.equal(trip.share_token, null);
  assert.equal(getTrip(trip.id).share_token, null);
});

test("a minted token resolves to its trip, and a revoked one resolves to nothing", () => {
  const owner = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
  const trip = aTrip(owner);

  assert.ok(setTripShareToken(trip.id, "tok-live", owner));
  assert.equal(getTripByShareToken("tok-live").id, trip.id);

  // Revoking is what makes an already-sent link stop working, so it is the half worth asserting.
  assert.ok(setTripShareToken(trip.id, null, owner));
  assert.equal(getTripByShareToken("tok-live"), undefined);
});

test("an unknown token is not found, and neither is an empty one", () => {
  assert.equal(getTripByShareToken("never-minted"), undefined);
  // Guarded explicitly: without it a caller reaching this with "" would match every unshared
  // row's NULL under some comparison rules, which is the whole table.
  assert.equal(getTripByShareToken(""), undefined);
});

test("only the owner can publish a trip, or withdraw it", () => {
  const owner = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
  const stranger = "3f2504e0-4f89-41d3-9a0c-0305e82c3304";
  const trip = aTrip(owner);

  assert.equal(setTripShareToken(trip.id, "tok-stranger", stranger), false);
  assert.equal(getTripByShareToken("tok-stranger"), undefined);

  assert.ok(setTripShareToken(trip.id, "tok-owner", owner));
  // And a stranger cannot un-share what they could not share.
  assert.equal(setTripShareToken(trip.id, null, stranger), false);
  assert.equal(getTripByShareToken("tok-owner").id, trip.id);
});

test("a write is never widened to the legacy bucket", () => {
  // The regression that motivated `writableOwners`, asserted against real SQL rather than only
  // against the pure helper: before the fix a caller holding any valid id could delete a
  // legacy-owned row, because the DELETE widened to include it.
  const legacy = aTrip("local");
  const stranger = "3f2504e0-4f89-41d3-9a0c-0305e82c3305";

  assert.equal(deleteTrip(legacy.id, stranger), false);
  assert.ok(getTrip(legacy.id), "a legacy row must survive a stranger's delete");
  assert.equal(setTripShareToken(legacy.id, "tok-legacy", stranger), false);
});

/* --- many processes opening one fresh database at once --- */

// `next build` collects page data with about nine worker processes, and every one of them imports
// this module, which migrates the schema at import time. On a fresh file two of them could both see
// a column missing and both add it; the second died with "duplicate column name: run_id" and failed
// the build (a rerun passed, the columns existing by then, so it only bit a clean checkout or CI).
// The window is a few microseconds wide, so this catches a regression in some runs, not every one:
// measured on the old code, about one round in seven collided. It can never fail on correct code.
test("parallel processes can migrate one fresh database file without colliding", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(path.join(tmpdir(), "tripmate-db-race-"));
  try {
    for (let round = 0; round < 5; round++) {
      const file = path.join(dir, `race-${round}.db`);
      // Node boots slowly enough that processes merely started together reach the migration spread
      // out and seldom collide, so each loads the driver first and waits for one shared moment.
      const startAt = Date.now() + 1000;
      const code = `await import("libsql"); while (Date.now() < ${startAt}); await import("./src/lib/db.ts");`;
      const open = () =>
        new Promise((resolve) => {
          const child = spawn(process.execPath, ["--import", "./scripts/ts-resolve.mjs", "--input-type=module", "-e", code], {
            env: { ...process.env, DB_PATH: file },
            stdio: ["ignore", "ignore", "pipe"],
          });
          let err = "";
          child.stderr.on("data", (d) => (err += d));
          child.on("close", (exit) => resolve({ exit, err }));
        });
      const failed = (await Promise.all(Array.from({ length: 8 }, open))).filter((r) => r.exit !== 0);
      assert.equal(failed.length, 0, failed.map((r) => r.err.match(/\w*Error: .*/)?.[0] ?? r.err).join("\n"));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* --- a late critique revision landing on the draft --- */

// Written the way a model writes them: a string cost and no tags, both of which the trip page's
// normalising read rewrites.
const stop = (name) => ({ name, lat: 19.07, lng: 72.87, cost: "10", category: "food" });
const planned = [{ date: "2026-11-10", weather: "", stops: [stop("Crawford Market")] }];
const revised = [{ date: "2026-11-10", weather: "", stops: [stop("Gateway of India")] }];
const draftFor = (runId, days) =>
  insertTrip({
    id: `revision-test-${++seq}`,
    destination: "Mumbai",
    start_date: "2026-11-10",
    end_date: "2026-11-10",
    budget: 100,
    itinerary_json: JSON.stringify({ tier: "comfort", days }),
    run_id: runId,
    status: "draft",
  });

test("a revision replaces the days of a draft nobody has touched, and keeps the rest", () => {
  const trip = draftFor("run-untouched", planned);
  assert.equal(applyRevisionIfUnedited("run-untouched", planned, revised), trip.id);
  const stored = JSON.parse(getTrip(trip.id).itinerary_json);
  assert.equal(stored.days[0].stops[0].name, "Gateway of India");
  assert.equal(stored.tier, "comfort");
});

test("a Keep that echoed the plan back through the trip page's normalising read is not an edit", () => {
  // The page holds `toTripDetail`'s normalised copy, and Keep PATCHes that back.
  const trip = draftFor("run-kept", JSON.parse(JSON.stringify(normalizeDays(planned))));
  assert.equal(applyRevisionIfUnedited("run-kept", planned, revised), trip.id);
});

test("an edit made before the revision lands is never overwritten", () => {
  const edited = [{ ...planned[0], stops: [stop("Crawford Market"), stop("Haji Ali")] }];
  const trip = draftFor("run-edited", edited);
  assert.equal(applyRevisionIfUnedited("run-edited", planned, revised), null);
  assert.equal(JSON.parse(getTrip(trip.id).itinerary_json).days[0].stops.length, 2);
});

test("a run with no trip row yet writes nothing", () => {
  assert.equal(applyRevisionIfUnedited("run-without-trip", planned, revised), null);
});

test("an edit that lands between the read and the write is never overwritten", () => {
  const trip = draftFor("run-interleaved", planned);
  const read = getTrip(trip.id);
  // The traveller's PATCH arrives after the row was read and compared, before the write.
  const edited = [{ ...planned[0], stops: [stop("Haji Ali")] }];
  updateTripItinerary(trip.id, JSON.stringify({ tier: "comfort", days: edited }), [read.owner_id]);
  assert.equal(writeRevisionOver(read, revised), false);
  assert.equal(JSON.parse(getTrip(trip.id).itinerary_json).days[0].stops[0].name, "Haji Ali");
});

const generationFor = (run_id, trip_id) =>
  insertGeneration({ run_id, trip_id, session_id: null, kind: "generate", destination: "Kyoto", context_json: "{}", prompt: "p", response: "r", model: "m", mode: "cli" });

test("linkGenerationToTrip leaves a generation already linked elsewhere", () => {
  generationFor("run-link-taken", "t1");
  linkGenerationToTrip("run-link-taken", "t2");
  assert.equal(getGeneration("run-link-taken").trip_id, "t1");
});

test("linkGenerationToTrip links an unlinked generation, and re-linking the same trip is a no-op", () => {
  generationFor("run-link-free", null);
  linkGenerationToTrip("run-link-free", "t2");
  assert.equal(getGeneration("run-link-free").trip_id, "t2");
  linkGenerationToTrip("run-link-free", "t2");
  assert.equal(getGeneration("run-link-free").trip_id, "t2");
});
