/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/editPrompt.test.mjs
 *
 * The chat edit prompt has to hold two rules that pull against each other: do every change the
 * traveler asked for, and change nothing they didn't. Dropping either produces a distinct,
 * already-seen failure — a half-applied request, or "change lunch" rewriting Wednesday. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildChatEditPrompt } from "./editPrompt.ts";

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
