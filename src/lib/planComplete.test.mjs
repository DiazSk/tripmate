/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/planComplete.test.mjs
 *
 * Completion turns a traveller's plan into a trip the app can draw. These cases are the ones where
 * it would quietly stop being their plan: a date on the wrong weekday, two days with one date, a
 * fill reply that adds a stop, a budget checked against costs nobody estimated. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleItinerary,
  budgetToStore,
  buildFillPrompt,
  centreOf,
  datesFor,
  defaultFill,
  durationLabel,
  fallbackPoint,
  parseFill,
  readCompleteRequest,
  stopId,
} from "./planComplete.ts";
import { parseDuration } from "./itinerary.ts";

const day = (stops, extra = {}) => ({ stops, ...extra });

test("readCompleteRequest refuses a request with no destination or no days", () => {
  assert.equal(readCompleteRequest({ plan: { days: [day([{ name: "A" }])] } }), "Add where this trip is.");
  assert.equal(readCompleteRequest({ destination: "Lisbon", plan: { days: [] } }), "There's no plan to build.");
});

test("readCompleteRequest refuses a plan over 30 days", () => {
  const days = Array.from({ length: 31 }, () => day([{ name: "A" }]));
  assert.match(readCompleteRequest({ destination: "Lisbon", plan: { days } }), /over 30 days/);
});

test("readCompleteRequest re-normalises what the client sent", () => {
  const got = readCompleteRequest({
    destination: " Lisbon ",
    startDate: "2026-11-02",
    budget: 900,
    plan: { days: [day([
      { name: " A ", time: "14:00", lat: 38.7, lng: -9.1 },
      { name: "B", lat: 999, lng: 0 },
      { name: "" },
    ])] },
  });
  assert.equal(got.destination, "Lisbon");
  assert.equal(got.startDate, "2026-11-02");
  assert.equal(got.budget, 900);
  assert.deepEqual(got.plan.days[0].stops, [{ name: "A", time: "2:00 PM", lat: 38.7, lng: -9.1 }, { name: "B" }]);
});

test("datesFor counts forward from a start date when the plan has no dates", () => {
  const dated = datesFor([day([{ name: "A" }]), day([{ name: "B" }])], "2026-11-02");
  assert.deepEqual(dated.map((d) => d.date), ["2026-11-02", "2026-11-03"]);
});

test("datesFor needs a start date for an undated plan", () => {
  assert.equal(datesFor([day([{ name: "A" }])], undefined), null);
});

test("datesFor asks for a start date when only some days are dated", () => {
  assert.equal(datesFor([day([{ name: "A" }], { date: "2026-11-02" }), day([{ name: "B" }])], undefined), null);
});

test("datesFor fills a skipped date with an empty day, so the days stay consecutive", () => {
  const dated = datesFor([day([{ name: "A" }], { date: "2026-11-02" }), day([{ name: "B" }], { date: "2026-11-04" })]);
  assert.deepEqual(dated.map((d) => [d.date, d.day.stops.length]), [["2026-11-02", 1], ["2026-11-03", 0], ["2026-11-04", 1]]);
});

test("datesFor merges the same date heading twice, in reading order", () => {
  const dated = datesFor([
    day([{ name: "A" }], { date: "2026-11-02" }),
    day([{ name: "B" }], { date: "2026-11-02" }),
  ]);
  assert.equal(dated.length, 1);
  assert.deepEqual(dated[0].day.stops.map((s) => s.name), ["A", "B"]);
});

test("datesFor crosses New Year as four consecutive days", () => {
  const dated = datesFor([day([{ name: "A" }], { date: "2026-12-30" }), day([{ name: "B" }], { date: "2027-01-02" })]);
  assert.deepEqual(dated.map((d) => d.date), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
});

test("the fill prompt names every stop by id and forbids changes", () => {
  const prompt = buildFillPrompt("Lisbon", [{ date: "2026-11-02", day: day([{ name: "A" }, { name: "B" }]) }]);
  assert.match(prompt, /d0s0 — A \(2026-11-02\)/);
  assert.match(prompt, /d0s1 — B \(2026-11-02\)/);
  assert.match(prompt, /Do not add, remove, rename or reorder/);
  assert.equal(stopId(2, 3), "d2s3");
});

const entry = (over = {}) => ({ cost: 12, durationMinutes: 60, category: "entry", why: "w", note: "n", outdoor: true, ...over });

test("parseFill accepts exactly the expected ids", () => {
  const got = parseFill(JSON.stringify({ stops: { d0s0: entry(), d0s1: entry({ category: "food" }) } }), ["d0s0", "d0s1"]);
  assert.equal(got.d0s1.category, "food");
});

test("parseFill rejects a reply that drops, adds or invents a stop", () => {
  assert.equal(parseFill(JSON.stringify({ stops: { d0s0: entry() } }), ["d0s0", "d0s1"]), null);
  assert.equal(parseFill(JSON.stringify({ stops: { d0s0: entry(), d0s1: entry(), d0s2: entry() } }), ["d0s0", "d0s1"]), null);
  assert.equal(parseFill(JSON.stringify({ stops: { d0s0: entry(), d9s9: entry() } }), ["d0s0", "d0s1"]), null);
});

test("parseFill rejects an unknown category", () => {
  assert.equal(parseFill(JSON.stringify({ stops: { d0s0: entry({ category: "museum" }) } }), ["d0s0"]), null);
});

test("parseFill clamps costs and rounds durations to 15 minutes", () => {
  const got = parseFill(JSON.stringify({ stops: { d0s0: entry({ cost: -5, durationMinutes: 600, outdoor: "yes" }) } }), ["d0s0"]);
  assert.equal(got.d0s0.cost, 0);
  assert.equal(got.d0s0.durationMinutes, 480);
  assert.equal(got.d0s0.outdoor, null);
  const short = parseFill(JSON.stringify({ stops: { d0s0: entry({ durationMinutes: 70 }) } }), ["d0s0"]);
  assert.equal(short.d0s0.durationMinutes, 75);
});

test("durationLabel is always one unit, so parseDuration reads it back exactly", () => {
  for (const minutes of [15, 45, 60, 75, 90, 120, 135, 480]) {
    assert.equal(parseDuration(durationLabel(minutes)), minutes, durationLabel(minutes));
  }
});

test("fallbackPoint prefers the destination and otherwise centres on the found stops", () => {
  assert.deepEqual(fallbackPoint({ lat: 1, lon: 2 }, []), { lat: 1, lng: 2 });
  assert.deepEqual(fallbackPoint(null, [{ name: "a", lat: 10, lng: 20 }, { name: "b", lat: 20, lng: 40 }, { name: "c" }]), { lat: 15, lng: 30 });
  assert.equal(fallbackPoint(null, [{ name: "c" }]), null);
  assert.equal(centreOf([]), null);
});

test("a budget is stored only when costs were estimated", () => {
  assert.equal(budgetToStore(900, true), 900);
  assert.equal(budgetToStore(900, false), 0);
  assert.equal(budgetToStore(undefined, true), 0);
});

const fallback = { lat: 38.7, lng: -9.1 };
const plan2 = () => [
  { date: "2026-11-02", day: day([
    { name: "Torre de Belém", time: "10:00 AM", note: "Go early", lat: 38.69, lng: -9.21 },
    { name: "Tasca do Zé" },
  ], { lodging: "Memmo Alfama" }) },
];

test("assembleItinerary keeps the traveller's time and note, and marks what it supplied", () => {
  const fill = { d0s0: entry({ note: "model note" }), d0s1: entry({ category: "food", outdoor: false }) };
  const it = assembleItinerary({ dated: plan2(), fill, hours: { "Torre de Belém": ["Mo"] }, weather: [], budget: 900, fallback });
  const [belem, tasca] = it.days[0].stops;
  assert.equal(belem.time, "10:00 AM");
  assert.equal(belem.note, "Go early");
  assert.deepEqual(belem.estimated, ["duration", "cost"]);
  assert.deepEqual(belem.closedDays, ["Mo"]);
  assert.equal(belem.located, "osm");
  assert.ok(tasca.estimated.includes("time"));
  assert.equal(tasca.closedDays, null);
  assert.equal(it.origin, "imported");
  assert.equal(it.days[0].lodging.name, "Memmo Alfama");
  assert.equal(it.importNotes, undefined);
});

test("a stop nobody could find stays in the plan, at the centre of its day", () => {
  const it = assembleItinerary({ dated: plan2(), fill: null, hours: null, weather: [], budget: 0, fallback });
  const tasca = it.days[0].stops[1];
  assert.equal(tasca.located, "model");
  assert.equal(tasca.lat, 38.69);
  assert.equal(tasca.lng, -9.21);
});

test("failed hours and a failed fill are said once, and nothing pretends otherwise", () => {
  const it = assembleItinerary({ dated: plan2(), fill: null, hours: null, weather: [], budget: 0, fallback });
  assert.deepEqual(it.importNotes, ["hoursUnchecked", "costsUnestimated"]);
  assert.equal("closedDays" in it.days[0].stops[0], false);
  assert.equal(it.days[0].stops[0].cost, defaultFill().cost);
  assert.ok(!it.days[0].stops[0].estimated.includes("cost"));
  assert.equal(it.tier, "midrange");
});

test("measured weather lands on weatherDetail and the prose field stays empty", () => {
  const weather = [{ date: "2026-11-02", tempMaxC: 20, tempMinC: 12, precipitationProbability: 70, humidity: null, weatherCode: 61, sunrise: null, sunset: null, historical: false }];
  const it = assembleItinerary({ dated: plan2(), fill: null, hours: null, weather, budget: 0, fallback });
  assert.equal(it.days[0].weather, "");
  assert.equal(it.days[0].weatherDetail.precipitationProbability, 70);
});
