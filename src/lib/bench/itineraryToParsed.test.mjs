/* Run: npm test
 *
 * The adapter is what lets the twelve generation scorers grade a patched itinerary. If it produces
 * days the scorers can't read, every metric returns null and the benchmark reports a row of dashes
 * instead of a bad score — the exact silent failure docs/itinerary-quality.md records. */
import assert from "node:assert/strict";
import test from "node:test";
import { itineraryToParsed } from "./itineraryToParsed.ts";
import { scoreFeasibility } from "./scorers/domain.ts";

const itinerary = {
  tier: "balanced",
  days: [
    {
      date: "2026-09-12",
      weather: "18-24C, 10% rain",
      summary: "Ease in along the old walls.",
      lodging: { name: "Palazzo Piccolomini", cost: 180, note: "Central, quiet courtyard." },
      stops: [
        {
          name: "Duomo di Pienza",
          lat: 43.0797, lng: 11.679, cost: 0,
          why: "A short, shaded first stop.",
          note: "8-minute walk from the hotel.",
          time: "9:30 AM", durationLabel: "1 hour", category: "entry",
        },
        {
          name: "Trattoria Latte di Luna",
          lat: 43.0787, lng: 11.6785, cost: 34,
          why: "Pici cacio e pepe, the local plate.",
          note: "5-minute walk. Book ahead in season.",
          time: "1:00 PM", durationLabel: "1.5 hours", category: "food",
        },
        {
          name: "Val d'Orcia viewpoint",
          lat: 43.0721, lng: 11.6702, cost: 0,
          why: "Golden hour over the valley.",
          note: "12-minute drive from town.",
          time: "6:30 PM", durationLabel: "45 min", category: "other",
        },
      ],
    },
  ],
};

test("every day survives the adapter with entries the scorers can read", () => {
  const parsed = itineraryToParsed(itinerary);
  assert.equal(parsed.days.length, 1);
  const day = parsed.days[0];
  assert.equal(day.date, "2026-09-12");
  const all = Object.values(day.entriesBySlot).flat();
  assert.equal(all.length, 3, "all three stops must land in a slot");
});

test("stops land in the slot their clock time implies", () => {
  const day = itineraryToParsed(itinerary).days[0];
  assert.deepEqual(day.entriesBySlot.Morning.map((e) => e.name), ["Duomo di Pienza"]);
  assert.deepEqual(day.entriesBySlot.Afternoon.map((e) => e.name), ["Trattoria Latte di Luna"]);
  assert.deepEqual(day.entriesBySlot.Evening.map((e) => e.name), ["Val d'Orcia viewpoint"]);
});

test("fields the scorers read carry across", () => {
  const [first] = itineraryToParsed(itinerary).days[0].entriesBySlot.Morning;
  assert.equal(first.name, "Duomo di Pienza");
  assert.equal(first.category, "entry");
  assert.equal(first.costUsd, 0, "a stated 0 must stay 0, not become null");
  assert.equal(first.lng, 11.679);
  assert.deepEqual(first.window, { startMin: 570, endMin: 630 }, "9:30 AM + 1 hour");
  assert.equal(first.durationMin, 60);
});

test("the leg is read out of the note, as §3c puts it there", () => {
  const [lunch] = itineraryToParsed(itinerary).days[0].entriesBySlot.Afternoon;
  assert.equal(lunch.transport.mode, "walk");
  assert.equal(lunch.transport.minutes, 5);
});

test("day-level fields map to the parser's own names", () => {
  const day = itineraryToParsed(itinerary).days[0];
  assert.equal(day.theme, "Ease in along the old walls.", "summary is the parser's `theme`");
  assert.equal(day.stayNear, "Palazzo Piccolomini");
  assert.equal(day.lodging.costUsd, 180);
  assert.equal(day.dayOfWeek, "Sat", "2026-09-12 is a Saturday — derived, UTC, in weekdayFromIso's own short form");
});

test("an itinerary the app could actually hold does not crash the adapter", () => {
  // Fields that are optional on Stop/DayPlan and absent on older saved trips.
  const sparse = {
    tier: "balanced",
    days: [{ date: "2026-09-12", weather: "", stops: [
      { name: "Somewhere", lat: 0, lng: 0, cost: 0, note: "", time: "", durationLabel: "", category: "other" },
    ] }],
  };
  const day = itineraryToParsed(sparse).days[0];
  assert.equal(day.theme, null);
  assert.equal(day.lodging, null);
  assert.equal(day.stayNear, null);
  const [only] = Object.values(day.entriesBySlot).flat();
  assert.equal(only.window, null, "no clock time means no window, not a window of zero");
});

test("the adapter never claims a preamble or a code fence", () => {
  const parsed = itineraryToParsed(itinerary);
  assert.equal(parsed.preamble, "");
  assert.equal(parsed.hadCodeFence, false);
});

test("a scorer given adapted output measures something rather than returning null", () => {
  const parsed = itineraryToParsed(itinerary);
  const feasibility = scoreFeasibility(parsed);
  assert.notEqual(feasibility.normalized, null, "a null here means the adapter fed an empty denominator");
  assert.equal(feasibility.perDayLoadMinutes.length, 1);
});

test("parsedOk's own definition holds for adapted output", () => {
  // Copied from runBenchCell — if this drifts, refine cells silently record parsedOk: false.
  const parsed = itineraryToParsed(itinerary);
  const parsedOk =
    parsed.days.length > 0 &&
    parsed.days.some((d) => Object.values(d.entriesBySlot).some((e) => e.length > 0));
  assert.equal(parsedOk, true);
});
