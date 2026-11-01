import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { getTrip, insertRun, listTrips, markRunFailed, runOutcome, saveTripForRun } from "./db.ts";

// A plan that is written while its traveller is away (the phone suspended mid-stream) is saved by
// the server, and the phone's own save arrives later for the same run — or never. These pin that the
// two meet on one trip, and that a phone coming back can learn what became of the run.

const OWNER = "8a7f0c2e-4a4e-4d43-9a6b-5f0c3c1d2e11";
const OTHER = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

function plan(runId, extra = {}) {
  return {
    ownerId: OWNER,
    destination: "Seattle, United States",
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    budget: 1200,
    itinerary: { tier: "mid", days: [] },
    runId,
    chatSessionId: null,
    userAnswers: null,
    status: "draft",
    timezone: "America/Los_Angeles",
    ...extra,
  };
}

test("the server's save and the phone's save of one run make one trip", () => {
  const runId = randomUUID();
  insertRun({ id: runId, kind: "generate", destination: "Seattle, United States" });
  const before = listTrips("draft", OWNER).length;
  const fromServer = saveTripForRun(plan(runId));
  const fromPhone = saveTripForRun(plan(runId));
  assert.equal(fromPhone, fromServer);
  assert.equal(listTrips("draft", OWNER).length, before + 1);
});

test("Keep on a run that already has a draft promotes that draft rather than adding a second trip", () => {
  const runId = randomUUID();
  const draft = saveTripForRun(plan(runId));
  const kept = saveTripForRun(plan(runId, { status: "saved" }));
  assert.equal(kept, draft);
  assert.equal(getTrip(draft).status, "saved");
});

test("another owner presenting the same run id gets nothing of the first owner's", () => {
  const runId = randomUUID();
  const mine = saveTripForRun(plan(runId));
  const theirs = saveTripForRun(plan(runId, { ownerId: OTHER }));
  assert.notEqual(theirs, mine);
  assert.equal(getTrip(theirs).owner_id, OTHER);
});

test("a save with no run id always inserts, as the Save fallback did before runs", () => {
  const a = saveTripForRun(plan(null));
  const b = saveTripForRun(plan(null));
  assert.notEqual(a, b);
});

test("a run with its trip saved reads ready, with the trip, to its owner only", () => {
  const runId = randomUUID();
  insertRun({ id: runId, kind: "generate", destination: "Seattle, United States" });
  const tripId = saveTripForRun(plan(runId));
  assert.deepEqual(runOutcome(runId, [OWNER]), { status: "ready", tripId });
  // Somebody else holding the id learns only that it is still being written.
  assert.deepEqual(runOutcome(runId, [OTHER]), { status: "writing" });
});

test("a run still being written reads writing, a failed one failed, an unknown one unknown", () => {
  const writing = randomUUID();
  insertRun({ id: writing, kind: "generate", destination: "Seattle, United States" });
  assert.deepEqual(runOutcome(writing, [OWNER]), { status: "writing" });

  const failed = randomUUID();
  insertRun({ id: failed, kind: "generate", destination: "Seattle, United States" });
  markRunFailed(failed);
  assert.deepEqual(runOutcome(failed, [OWNER]), { status: "failed" });

  assert.deepEqual(runOutcome(randomUUID(), [OWNER]), { status: "unknown" });
});
