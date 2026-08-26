/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/itineraryHtml.test.mjs
 *
 * The renderer is pure by construction — no fetch, no clock, no globals — which is the only
 * reason a document this size is reachable from a test at all. What is covered: the invariants
 * a reader checks the file against (day figures summing to the trip figure), and the failures
 * that would ship silently (an unescaped stop name, a missing photo taking the page with it). */
import assert from "node:assert/strict";
import test from "node:test";
import { dayHeading, exportFilename, renderItineraryHtml } from "./itineraryHtml.ts";

const stop = (over = {}) => ({
  name: "Kunsthaus Zurich",
  lat: 47.378,
  lng: 8.555,
  cost: 0,
  note: "Free galleries on Wednesdays",
  why: "Rainy-day art without a ticket",
  time: "9:30 AM",
  durationLabel: "1.5 hours",
  category: "entry",
  ...over,
});

const trip = (over = {}) => ({
  id: "t1",
  destination: "Zurich, Switzerland",
  startDate: "2026-08-20",
  endDate: "2026-08-21",
  budget: 3500,
  itinerary: {
    tier: "luxury",
    days: [
      {
        date: "2026-08-20",
        weather: "Mixed (15-21°C)",
        summary: "Museums and markets. 🏛️🎨",
        lodging: { name: "Boutique hotel", cost: 350, note: "Altstadt" },
        stops: [stop(), stop({ name: "Lunch at Markthalle", cost: 100, lat: 47.377, lng: 8.53 })],
      },
      {
        date: "2026-08-21",
        weather: "Clear",
        stops: [stop({ name: "Lake Zurich", cost: 40 })],
      },
    ],
  },
  ...over,
});

const noAssets = { photos: { cover: null, days: [] }, fontDataUri: null };

test("the document is a complete standalone page", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(html, /<meta name="viewport"/);
  // No external subresources: the file must render in airplane mode.
  assert.doesNotMatch(html, /<link[^>]+href="https?:/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
});

test("every stop appears", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes("Kunsthaus Zurich"));
  assert.ok(html.includes("Lunch at Markthalle"));
  assert.ok(html.includes("Lake Zurich"));
});

test("a stop name that is model output cannot execute", () => {
  const evil = trip();
  evil.itinerary.days[0].stops[0].name = `<script>alert(1)</script>`;
  const html = renderItineraryHtml(evil, noAssets);
  assert.ok(!html.includes("<script>alert(1)</script>"), "the raw tag must not survive");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("day figures sum to the trip figure", () => {
  // The invariant the print page is built on, carried over: a document meant to be checked line
  // by line must not have day totals that fail to add up to its own header.
  const html = renderItineraryHtml(trip(), noAssets);
  // day 1 = 0 + 100 + 350 lodging = 450; day 2 = 40; trip = 490
  assert.ok(html.includes("$450"), "day 1 total");
  assert.ok(html.includes("$40"), "day 2 total");
  assert.ok(html.includes("$490"), "trip total");
});

test("emoji never reach the page", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}]/u);
  assert.ok(!html.includes("🏛️"));
  assert.ok(html.includes("Museums and markets."));
});

test("a free stop reads Free and never $0", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes("Free"));
  assert.ok(!/\$0\b/.test(html), "no bare $0 anywhere");
});

test("missing photos do not take the document with them", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes("Kunsthaus Zurich"));
  assert.doesNotMatch(html, /<img[^>]+src=""/, "an absent photo renders no img at all");
});

test("a supplied cover is inlined as a data URI", () => {
  const html = renderItineraryHtml(trip(), {
    photos: { cover: "data:image/jpeg;base64,AAAA", days: [null, null] },
    fontDataUri: null,
  });
  assert.ok(html.includes('src="data:image/jpeg;base64,AAAA"'));
});

test("a day with no title falls back to its stripped summary, then to nothing", () => {
  const t = trip();
  assert.equal(dayHeading(t.itinerary.days[0], 0), "Museums and markets.");
  t.itinerary.days[0].title = "Rainy day";
  assert.equal(dayHeading(t.itinerary.days[0], 0), "Rainy day");
  // Day 2 has neither title nor summary.
  assert.equal(dayHeading(t.itinerary.days[1], 1), "Day 2");
});

test("a trip with a single day still renders", () => {
  const t = trip();
  t.itinerary.days = [t.itinerary.days[0]];
  const html = renderItineraryHtml(t, noAssets);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.includes("Kunsthaus Zurich"));
});

test("the filename is safe for a Content-Disposition header", () => {
  assert.equal(exportFilename("Zürich, Switzerland"), "zurich-itinerary.html");
  assert.equal(exportFilename("Val d'Orcia, Italy"), "val-d-orcia-itinerary.html");
});

test("the direction contract survives into the markup", () => {
  // Impeccable's contract must be auditable in the shipped artifact, not only in source.
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes("THESIS:"), "the contract comment must be in the emitted body");
  assert.ok(html.includes("e57fcfdf"), "seed key");
});

test("a flight cost is stated beside the trip total, not folded into it", () => {
  const t = trip();
  t.itinerary.flightCostUsd = 600;
  const html = renderItineraryHtml(t, noAssets);
  assert.ok(html.includes("$600"), "the flight cost appears on its own");
  assert.ok(html.includes("$490"), "the trip total is unchanged by the flight cost");
});

test("no flight cost means no flight line", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(!html.includes("booked separately"));
});

test("the runtime is inline and self-contained", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes("<script>"), "a runtime must be present");
  assert.doesNotMatch(html, /<script[^>]+src=/, "never an external script");
});

test("days and stops carry the attributes the runtime keys on", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes('data-date="2026-08-20"'), "days are addressable by date");
  assert.ok(html.includes('data-stop="0:0"'), "stops are addressable by day and index");
  assert.ok(html.includes('data-trip="t1"'), "storage is namespaced per trip");
});

test("the runtime compares calendar dates as strings, never by parsing them", () => {
  // The repo's standing date trap: new Date("2026-08-20") is UTC midnight, and local accessors
  // roll it back a day west of Greenwich. Building today's key from local parts and comparing
  // strings sidesteps parsing entirely.
  const html = renderItineraryHtml(trip(), noAssets);
  assert.doesNotMatch(html, /new Date\(\s*[a-zA-Z_$][\w$]*\.dataset/, "must not parse a day's date");
  assert.ok(html.includes("getFullYear()"), "today's key is built from local parts");
});
