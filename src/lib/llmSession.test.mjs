import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  appendSessionTurns,
  getGeneration,
  getLatestGenerationForTrip,
  getSessionMessages,
  insertGeneration,
  linkGenerationToTrip,
} from "./db.ts";

/**
 * The API path's memory, which is the piece with no CLI equivalent to fall back on.
 *
 * The CLI kept a conversation in a JSONL file and replayed it on `--resume`; over HTTP the same
 * replay has to come out of `llm_sessions`. These tests cover the round-trip and the two cases that
 * decide whether chat keeps its memory or silently loses it.
 *
 * Touches the real `tripmate.db` — `db.ts` opens it at import and there is no injection seam — so
 * every id here is a fresh UUID and nothing asserts on rows it did not write itself.
 */

describe("session store — the API path's conversational memory", () => {
  it("returns nothing for a session that was never opened", () => {
    assert.deepEqual(getSessionMessages(randomUUID()), []);
  });

  it("round-trips a turn pair", () => {
    const id = randomUUID();
    appendSessionTurns(id, "claude-opus-5", [
      { role: "user", content: "generate prompt" },
      { role: "assistant", content: '{"days":[]}' },
    ]);
    assert.deepEqual(getSessionMessages(id), [
      { role: "user", content: "generate prompt" },
      { role: "assistant", content: '{"days":[]}' },
    ]);
  });

  /**
   * The seeding behaviour the whole chat design rests on: generation writes its own prompt and
   * response into the session, so the first chat turn replays them and inherits the planner's
   * reasoning rather than starting from a summary of its output.
   */
  it("appends across turns in order, keeping the generate turn first", () => {
    const id = randomUUID();
    appendSessionTurns(id, "claude-opus-5", [
      { role: "user", content: "GENERATE" },
      { role: "assistant", content: "PLAN" },
    ]);
    appendSessionTurns(id, "claude-haiku-4-5", [
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "reply 1" },
    ]);
    appendSessionTurns(id, "claude-haiku-4-5", [
      { role: "user", content: "turn 2" },
      { role: "assistant", content: "reply 2" },
    ]);

    const messages = getSessionMessages(id);
    assert.equal(messages.length, 6);
    // The planner's own turn survives at the head of the conversation after several chat turns —
    // this is what `buildResumedChatPrompt` assumes when it sends only the traveler's message.
    assert.equal(messages[0].content, "GENERATE");
    assert.equal(messages[1].content, "PLAN");
    assert.deepEqual(
      messages.map((m) => m.role),
      ["user", "assistant", "user", "assistant", "user", "assistant"]
    );
    assert.equal(messages.at(-1).content, "reply 2");
  });

  it("alternates roles so the replay is a valid conversation", () => {
    const id = randomUUID();
    for (let i = 0; i < 3; i++) {
      appendSessionTurns(id, "claude-haiku-4-5", [
        { role: "user", content: `q${i}` },
        { role: "assistant", content: `a${i}` },
      ]);
    }
    const roles = getSessionMessages(id).map((m) => m.role);
    // The Messages API requires the first message to be `user`; consecutive same-role turns would
    // still be accepted but would mean a turn pair went missing.
    assert.equal(roles[0], "user");
    for (let i = 1; i < roles.length; i++) {
      assert.notEqual(roles[i], roles[i - 1], `roles repeated at index ${i}`);
    }
  });
});

describe("generations — the persisted context/prompt/response record", () => {
  const base = (overrides = {}) => ({
    run_id: randomUUID(),
    trip_id: null,
    session_id: null,
    kind: "generate",
    destination: "Kyoto, Japan",
    context_json: JSON.stringify({ destination: "Kyoto, Japan", budget: 900 }),
    prompt: "the full generate prompt",
    response: '{"days":[{"date":"2026-10-05","stops":[]}]}',
    model: "claude-opus-5",
    mode: "api",
    ...overrides,
  });

  it("stores the context payload, the prompt and the response together", () => {
    const row = base();
    insertGeneration(row);
    const read = getGeneration(row.run_id);
    assert.equal(read.prompt, row.prompt);
    assert.equal(read.response, row.response);
    assert.deepEqual(JSON.parse(read.context_json), { destination: "Kyoto, Japan", budget: 900 });
    assert.equal(read.model, "claude-opus-5");
    assert.equal(read.mode, "api");
    assert.ok(read.created_at, "created_at was not stamped");
  });

  it("does not exist before it is written", () => {
    assert.equal(getGeneration(randomUUID()), undefined);
  });

  /** A generation is written before a trip row exists — the traveller may never save it. The link
   *  can only be made on promotion, which is what `POST /api/trips` does. */
  it("links to a trip only once that trip is saved", () => {
    const row = base();
    insertGeneration(row);
    assert.equal(getGeneration(row.run_id).trip_id, null);

    const tripId = randomUUID();
    linkGenerationToTrip(row.run_id, tripId);
    assert.equal(getGeneration(row.run_id).trip_id, tripId);
  });

  it("returns the newest generation for a trip that has been refined", () => {
    const tripId = randomUUID();
    const first = base({ trip_id: tripId, created_at: undefined, prompt: "first" });
    insertGeneration(first);
    const second = base({ trip_id: tripId, kind: "refine", prompt: "second" });
    insertGeneration(second);

    const latest = getLatestGenerationForTrip(tripId);
    // Both rows carry ISO timestamps, which sort lexically — the refine is what the cheap flows
    // should be reading, not the plan it replaced.
    assert.equal(latest.prompt, "second");
    assert.equal(latest.kind, "refine");
  });

  it("treats a re-run under the same run id as a correction, not a second row", () => {
    const row = base({ response: "first attempt" });
    insertGeneration(row);
    insertGeneration({ ...row, response: "retry" });
    assert.equal(getGeneration(row.run_id).response, "retry");
  });
});
