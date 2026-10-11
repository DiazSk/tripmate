/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/planImport.test.mjs
 *
 * The read is the one place a traveller's plan passes through a model, so these cases are the
 * ways it could stop being their plan: an invented field surviving, a time read wrongly, a long
 * day quietly cut, a list of places mistaken for days. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanReadPrompt, parsePlanRead } from "./planImport.ts";

const reply = (obj) => JSON.stringify(obj);

test("a day-by-day reply keeps its days, stops and order", () => {
  const plan = parsePlanRead(
    reply({
      isPlan: true,
      destinationGuess: "Lisbon, Portugal",
      days: [
        { date: null, lodging: "Memmo Alfama", stops: [{ name: "Torre de Belém" }, { name: "Pastéis de Belém" }] },
        { date: null, lodging: null, stops: [{ name: "Palácio da Pena" }] },
      ],
      places: [],
    })
  );
  assert.equal(plan.isPlan, true);
  assert.equal(plan.destinationGuess, "Lisbon, Portugal");
  assert.deepEqual(
    plan.days.map((d) => d.stops.map((s) => s.name)),
    [["Torre de Belém", "Pastéis de Belém"], ["Palácio da Pena"]]
  );
  assert.equal(plan.days[0].lodging, "Memmo Alfama");
  assert.deepEqual(plan.unread, []);
});

test("times go through the app's clock, and ones it can't read become estimates", () => {
  const plan = parsePlanRead(
    reply({
      isPlan: true,
      days: [{ stops: [
        { name: "A", time: "10:30" },
        { name: "B", time: "22:00" },
        { name: "C", time: "half past ten" },
        { name: "D", time: "10.30" },
      ] }],
    })
  );
  assert.deepEqual(plan.days[0].stops.map((s) => s.time), ["10:30 AM", "10:00 PM", undefined, undefined]);
});

test("fields the read never asked for are dropped", () => {
  const plan = parsePlanRead(
    reply({ isPlan: true, days: [{ theme: "x", stops: [{ name: "A", cost: 40, rating: 5 }] }] })
  );
  assert.deepEqual(plan.days[0], { stops: [{ name: "A" }] });
});

test("an impossible date is not kept", () => {
  const plan = parsePlanRead(reply({ isPlan: true, days: [{ date: "2026-02-30", stops: [{ name: "A" }] }] }));
  assert.equal(plan.days[0].date, undefined);
});

test("a day over the limit is cut to 12 and the cut is reported", () => {
  const stops = Array.from({ length: 15 }, (_, i) => ({ name: `Stop ${i + 1}` }));
  const plan = parsePlanRead(reply({ isPlan: true, days: [{ stops }] }));
  assert.equal(plan.days[0].stops.length, 12);
  assert.deepEqual(plan.notes, ["Day 1 listed 15 stops; the last 3 were left out."]);
});

test("a list of places is not a plan, and its names come back for the wizard", () => {
  const plan = parsePlanRead(reply({ isPlan: false, days: [], places: ["Time Out Market", "LX Factory"] }));
  assert.equal(plan.isPlan, false);
  assert.deepEqual(plan.days, []);
  assert.deepEqual(plan.loose, ["Time Out Market", "LX Factory"]);
});

test("days with no stops at all are not a plan either", () => {
  const plan = parsePlanRead(reply({ isPlan: true, days: [{ stops: [] }], places: ["A"] }));
  assert.equal(plan.isPlan, false);
  assert.deepEqual(plan.loose, ["A"]);
});

test("a reply that isn't the expected shape is null, never an empty plan", () => {
  assert.equal(parsePlanRead("not json"), null);
  assert.equal(parsePlanRead("[]"), null);
  assert.equal(parsePlanRead(reply({ foo: 1 })), null);
});

test("the prompt forbids inventing and carries every item", () => {
  const prompt = buildPlanReadPrompt([{ index: 0, kind: "text", text: "Day 1: Alfama" }], [1], "Lisbon");
  assert.match(prompt, /Never add a stop/);
  assert.match(prompt, /Item 0 \(text\): Day 1: Alfama/);
  assert.match(prompt, /items 1\./);
  assert.match(prompt, /to Lisbon/);
});
