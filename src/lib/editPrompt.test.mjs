/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/editPrompt.test.mjs
 *
 * The chat edit prompt has to hold two rules that pull against each other: do every change the
 * traveler asked for, and change nothing they didn't. Dropping either produces a distinct,
 * already-seen failure — a half-applied request, or "change lunch" rewriting Wednesday. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildChatEditPrompt, buildElementEditPrompt, buildResumedChatPrompt } from "./editPrompt.ts";

const ITINERARY = {
  tier: "mid-range",
  days: [
    {
      date: "2026-09-19",
      weather: "Clear",
      stops: [
        { name: "Kiyomizu-dera", lat: 34.9949, lng: 135.785, cost: 5, note: "", time: "09:00", durationLabel: "1 hour", category: "entry" },
      ],
    },
  ],
};

test("the chat edit prompt asks for every requested change and nothing else", () => {
  const prompt = buildChatEditPrompt({
    skill: "",
    editContext: "",
    itinerary: ITINERARY,
    messages: [{ role: "user", content: "change lunch" }],
  });
  // Both halves. Neither alone is the rule.
  assert.match(prompt, /do ALL of them in this one turn/);
  assert.match(prompt, /leave everything the traveler did not ask about exactly as it is/i);
  assert.match(prompt, /smallest set of stops/i);
});

// A chat that only edits is half a chat. The rules that make it answer have to reach BOTH Mode A
// prompts — a trip whose session is resumable takes the other one, and a traveler cannot tell
// which path their question went down.
for (const [name, build] of [
  [
    "fresh",
    () =>
      buildChatEditPrompt({
        skill: "",
        editContext: "",
        itinerary: ITINERARY,
        messages: [{ role: "user", content: "how much am I spending on food?" }],
      }),
  ],
  [
    "resumed",
    () =>
      buildResumedChatPrompt({
        message: "how much am I spending on food?",
        itinerary: ITINERARY,
        resync: false,
      }),
  ],
]) {
  test(`the ${name} chat prompt treats a question as the job, not an interruption`, () => {
    const prompt = build();
    assert.match(prompt, /not a change/i, "answering has to be stated as part of the work");
    assert.match(prompt, /length the question deserves/i, "a capped reply cannot answer anything");
    // The guardrail that matters most: a made-up opening time is the one a traveler acts on.
    assert.match(prompt, /never invent a specific/i);
    assert.doesNotMatch(prompt, /1-3 sentences/, "the old cap made every answer a confirmation");
  });
}

// Mode B is one stop, scope-locked and one-shot — there is no conversation to answer in, and
// handing it these rules would invite prose where the caller reads only `ops`.
test("the element edit prompt is left out of it", () => {
  const prompt = buildElementEditPrompt({
    skill: "",
    editContext: "",
    dayIndex: 0,
    stopIndex: 0,
    day: ITINERARY.days[0],
    target: ITINERARY.days[0].stops[0],
    instruction: "somewhere quieter",
  });
  assert.doesNotMatch(prompt, /not a change/i);
});
