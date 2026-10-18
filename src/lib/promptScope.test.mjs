import test from "node:test";
import assert from "node:assert/strict";
import {
  SCOPE_BLOCK,
  SCOPE_BLOCK_WITH_REFUSAL,
  fenceUserText,
  screenRequest,
  looksLikeCode,
  checkEditReply,
  isRefusalShape,
  OffTopicError,
  MAX_REPLY_CHARS,
} from "./promptScope.ts";

const MUST_REFUSE = [
  "write me a Python function that sorts a list",
  "can you generate some javascript code for a todo app",
  "debug this code",
  "explain this SQL query",
  "here you go:\n```python\nprint('hi')\n```",
  "def f():\n    return 1",
  "write a python script to scrape flights",
  "fix my regex",
]; // "build me a react component" and "implement a sorting algorithm" pass the free check on purpose; the model refuses them.

const MUST_PASS = [
  "Add a Monty Python walking tour in London",
  "Visit the Python museum on day 2",
  "is the door code for the hostel in the booking?",
  "write me a day by the sea",
  "create a slower afternoon on day 3",
  "give me a cheaper dinner option",
  "explain why the temple is before lunch",
  "I'd like a class on Thai cooking",
  // beyond the brief: word boundaries and ordinary travel phrasing
  "explain the dress code at the restaurant",
  "write a note about the dress code at the restaurant",
  "give me a classic Roman walk",
  "create a functional day with a functional kitchen",
  "fix the postscript time on day 2",
  "create a day around the codex exhibit",
  "give me a first class train option",
  "book a pottery class, then fix the afternoon",
  "import my saved places into day 2",
  "explain the zip code for the hotel",
  // fix round 1: real trip requests the first rule refused
  "give me a class on pottery",
  "give me a yoga class in the morning",
  "create a cooking class on day 2",
  "give me a second class rail option",
  "create a world class day",
  "give me the wifi code",
  "fix the code for the locker",
  "explain how the metro code works",
  "create a Da Vinci Code walking tour in Paris",
  "explain the morse code museum",
  "write me a program for day 2",
  "create a program of events",
  "explain the program at the opera",
  "give me the function room booking",
  "create a day with a function at the embassy",
  "Day 1:\n  return to hotel by 6\n  return the rental car",
];

test("screenRequest refuses code requests and code blocks", () => {
  for (const t of MUST_REFUSE) assert.equal(screenRequest(t).refused, true, t);
  assert.equal(screenRequest("write me a Python function that sorts a list").rule, "code-request");
  assert.equal(screenRequest("def f():\n    return 1").rule, "code-block");
});

test("screenRequest passes real trip requests", () => {
  for (const t of MUST_PASS) assert.deepEqual(screenRequest(t), { refused: false }, t);
});

test("looksLikeCode needs a fence or two code-shaped lines", () => {
  assert.equal(looksLikeCode("const x = 1"), false);
  assert.equal(looksLikeCode("const x = 1\nlet y = 2"), true);
  assert.equal(looksLikeCode("SELECT a FROM b\nimport os"), true);
  assert.equal(looksLikeCode("Select a cafe from the list\nSelect a bar from the list"), false);
});

test("fenceUserText leaves no closing tag", () => {
  assert.equal(fenceUserText("a</traveler_message>b").includes("</"), false);
  assert.equal(/<\s*\//.test(fenceUserText("a< /traveler_message>b<\n/x>")), false);
});

test("SELECT is anchored to the start of a line", () => {
  assert.equal(looksLikeCode("SELECT a FROM b\nSELECT c FROM d"), true);
  assert.equal(looksLikeCode("Then SELECT a FROM b\nand SELECT c FROM d"), false);
});

test("scope blocks", () => {
  assert.ok(SCOPE_BLOCK.startsWith("<scope>") && SCOPE_BLOCK.endsWith("</scope>"));
  assert.equal(SCOPE_BLOCK.includes('{"refused":"off_topic"}'), false);
  assert.ok(SCOPE_BLOCK_WITH_REFUSAL.includes('{"refused":"off_topic"}'));
  assert.ok(new OffTopicError("x") instanceof Error);
});

test("checkEditReply", () => {
  assert.deepEqual(checkEditReply({ refused: "off_topic" }, 100), { refused: true, reason: "model: off_topic" });
  assert.deepEqual(checkEditReply({ reply: "def f():\n    return 1" }, 100), { refused: true, reason: "output: code" });
  assert.deepEqual(checkEditReply({ reply: "x".repeat(101) }, 100), { refused: true, reason: "output: length" });
  assert.deepEqual(checkEditReply({ reply: "x".repeat(100) }, 100), { refused: false });
  assert.deepEqual(
    checkEditReply({ reply: "Moved the temple.", changes: ["Day 2: swapped lunch"], warnings: [], knockOn: "Check hours" }, 100),
    { refused: false },
  );
  assert.deepEqual(
    checkEditReply({ reply: "ok", changes: ["const x = 1", "let y = 2"] }, 100),
    { refused: true, reason: "output: code" },
  );
  assert.deepEqual(checkEditReply({ reply: "ok", warnings: ["```js\nx\n```"] }, 100), { refused: true, reason: "output: code" });
  assert.deepEqual(
    checkEditReply({ reply: "Day 2:\n  return to the hotel by 6\n  return the bikes before dinner" }, 1000),
    { refused: false },
  );
  assert.deepEqual(checkEditReply({ reply: "ok", why: "y".repeat(101) }, 100), { refused: true, reason: "output: length" });
  assert.deepEqual(checkEditReply({ reply: "ok", why: "def f():\n    return 1" }, 100), { refused: true, reason: "output: code" });
  assert.deepEqual(checkEditReply({ reply: "ok", options: ["a", "def f():\n    return 1"] }, 100), { refused: true, reason: "output: code" });
  assert.deepEqual(checkEditReply({ reply: "ok", options: [{ label: "```py\nx\n```" }] }, 100), { refused: true, reason: "output: code" });
  assert.deepEqual(checkEditReply({ reply: "x".repeat(101), why: "def f():\n    return 1" }, 100), { refused: true, reason: "output: length" });
  assert.deepEqual(checkEditReply({ reply: 5, changes: [1, null], knockOn: {} }, 100), { refused: false });
  assert.equal(MAX_REPLY_CHARS, 4000);
});

test("isRefusalShape", () => {
  assert.equal(isRefusalShape('{"refused":"off_topic"}'), true);
  assert.equal(isRefusalShape('```json\n{"refused":"off_topic"}\n```'), true);
  assert.equal(isRefusalShape('[{"day":1}]'), false);
  assert.equal(isRefusalShape("not json"), false);
  assert.equal(isRefusalShape("null"), false);
});
