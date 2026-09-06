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

const noAssets = { fontDataUri: null };

test("the document is a complete standalone page", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(html, /<meta name="viewport"/);
  // No external subresources: the file must render in airplane mode.
  assert.doesNotMatch(html, /<link[^>]+href="https?:/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  // Blanket check: no absolute URL anywhere in the document, not just in <link>/<script src>.
  assert.doesNotMatch(html, /https?:\/\//, "no absolute URL may reach the artifact");
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

test("a stop with no time or durationLabel renders without throwing", () => {
  // Real saved trips predating these two fields exist (a stop from before `time`/`durationLabel`
  // were added) — `normalizeDays` backfills cost/category/tags but never these, so the renderer
  // must tolerate both being absent rather than crash on `escapeHtml(undefined)`.
  const legacy = trip();
  legacy.itinerary.days[0].stops[0] = stop({
    name: "Legacy Stop",
    cost: 25,
    time: undefined,
    durationLabel: undefined,
  });
  const html = renderItineraryHtml(legacy, noAssets);
  assert.ok(html.includes("Legacy Stop"));
  assert.ok(html.includes("$25"), "cost still renders");
  assert.doesNotMatch(html, /·\s*\$25/, "no stray leading separator when durationLabel is absent");
  assert.doesNotMatch(html, /\$25\s*·/, "no stray trailing separator when nothing follows cost");
});

test("a lodging with no note renders without throwing and without a dangling separator", () => {
  // Same class of bug as the legacy stop above: older saved trips can have `lodging.note`
  // absent even though the type declares it required.
  const legacy = trip();
  legacy.itinerary.days[0].lodging = { name: "Boutique hotel", cost: 350, note: undefined };
  const html = renderItineraryHtml(legacy, noAssets);
  assert.ok(html.includes("Boutique hotel"));
  assert.doesNotMatch(html, /\$350\s*·\s*<\/span>/, "no stray trailing separator when note is absent");
});

test("a day with no weather set renders without throwing", () => {
  const legacy = trip();
  legacy.itinerary.days[0].weather = undefined;
  const html = renderItineraryHtml(legacy, noAssets);
  assert.ok(html.includes("Kunsthaus Zurich"));
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

test("the document carries no imagery at all", () => {
  // Photography was removed outright: the map is the artifact's one visual anchor now, and the
  // cover was the only thing that ever made this file need a network walk besides the geometry.
  const html = renderItineraryHtml(trip(), { ...noAssets, map: someMap });
  assert.ok(html.includes("Kunsthaus Zurich"));
  assert.doesNotMatch(html, /<img/, "no img element may reach the document");
  assert.doesNotMatch(html, /data:image\//, "and no inlined bitmap either");
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

/* ---------- the offline map ---------- */

const someMap = {
  width: 1000,
  height: 680,
  x0: 0.5237,
  y0: 0.3521,
  spanX: 0.0004,
  spanY: 0.000272,
  unitsPerMetre: 0.028,
  mode: "city",
  roads: "M10 10L900 640",
  waterFill: "",
  waterLine: "M5 600L995 610",
  days: [
    { index: 0, date: "2026-08-20", d: "M100 100L300 200", stops: [{ x: 100, y: 100, name: "Kunsthaus Zurich" }] },
    { index: 1, date: "2026-08-21", d: "M400 300L600 500", stops: [{ x: 400, y: 300, name: "Rietberg" }] },
  ],
};

test("a document with no map is complete and carries none of the map's weight", () => {
  // `noAssets` deliberately omits `map` entirely — the absent-map and failed-fetch paths are one.
  const html = renderItineraryHtml(trip(), noAssets);
  assert.doesNotMatch(html, /<svg class="map"/, "no map element");
  assert.doesNotMatch(html, /offline map/, "no dead stylesheet");
  assert.doesNotMatch(html, /navigator\.geolocation/, "no runtime with nothing to bind to");
});

test("a supplied map is inlined and stays a standalone document", () => {
  const html = renderItineraryHtml(trip(), { ...noAssets, map: someMap });
  assert.match(html, /<svg class="map"/);
  assert.match(html, /class="mroute" data-day="0"/);
  // The blanket rule again, this time with every map layer, both buttons and the runtime present.
  assert.doesNotMatch(html, /https?:\/\//, "no absolute URL may reach the artifact");
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /xmlns/, "inline SVG is namespaced by the parser");
});

test("the map ships as a second runtime, leaving the check-off script alone", () => {
  const html = renderItineraryHtml(trip(), { ...noAssets, map: someMap });
  assert.equal(html.split("<script>").length - 1, 2, "two independent IIFEs");
  assert.match(html, /tripmate:" \+ trip \+ ":done/, "check-off is untouched");
  // The date trap the first runtime documents applies to the second one too.
  assert.doesNotMatch(html, /new Date\(\s*[a-zA-Z_$][\w$]*\.dataset/);
});

test("the map sits between the masthead and the days", () => {
  const html = renderItineraryHtml(trip(), { ...noAssets, map: someMap });
  assert.ok(
    html.indexOf('class="mast"') < html.indexOf('<svg class="map"'),
    "the map follows the destination heading",
  );
  assert.ok(
    html.indexOf('<svg class="map"') < html.indexOf('<section class="days">'),
    "and precedes the day list it frames — which is what lets it pin above them",
  );
});

test("the trip-line strip and its station thumbnails are gone", () => {
  const html = renderItineraryHtml(trip(), { ...noAssets, map: someMap });
  // Exact class, not a prefix — "st" is a substring of the "stop" and "stay" that both survive.
  for (const dead of ["tripline", 'class="st"', "savenote", "renderStation"]) {
    assert.ok(!html.includes(dead), `${dead} was replaced by the map and must not linger`);
  }
  assert.ok(html.includes('class="stop"'), "the day's own stop rows are untouched");
});

test("the title and the map ride in one bar pinned to the top", () => {
  const html = renderItineraryHtml(trip(), { ...noAssets, map: someMap });
  assert.match(html, /body\.js \.topbar\{position:sticky;top:0/);
  assert.ok(
    html.indexOf('<div class="topbar">') < html.indexOf('<h1>') &&
      html.indexOf('<h1>') < html.indexOf('<svg class="map"'),
    "the map sits below the title, inside the pinned bar",
  );
  assert.ok(
    html.indexOf('<svg class="map"') < html.indexOf('<section class="days">'),
    "and the days scroll underneath both",
  );
});

test("the title animates between two sizes rather than tracking scrollY", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.match(html, /transition:font-size \.26s/, "the movement is a transition, not a per-frame write");
  assert.match(html, /body\.shrunk h1\{font-size:1\.7rem\}/);
  assert.doesNotMatch(html, /--shrink/, "a scrubbed size feeds the bar's own collapse back into itself");
  assert.match(html, /requestAnimationFrame/, "the scroll handler is throttled to a frame");
  assert.match(html, /\{ passive: true \}/, "and never blocks scrolling");
});

test("the collapse latches, so a slow drag cannot flip it back and forth", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  // Collapsing shortens the document, which moves the scroll position that decides to collapse.
  // The gap between them must exceed the ~126px the collapse itself removes, or the bar chases
  // its own scroll position: measured at 31 flips a second with 56/20.
  assert.match(html, /SHRINK_AT = 220/);
  assert.match(html, /GROW_AT = 24/);
  assert.match(html, /shrunk \? y > GROW_AT : y > SHRINK_AT/, "two thresholds, not one");
  assert.match(html, /scrollHeight - window\.innerHeight > 420/, "and no collapse without room for it");
});

test("the moving parts hold still for a reader who asked them to", () => {
  assert.match(renderItineraryHtml(trip(), noAssets),
    /@media \(prefers-reduced-motion: reduce\)\{h1,\.mast,\.trmeta\{transition:none\}\}/);
});

test("a day heading pins directly below the bar, by measurement", () => {
  const html = renderItineraryHtml(trip(), { ...noAssets, map: someMap });
  assert.match(html, /body\.js \.day>summary\{position:sticky;top:var\(--stick,0px\)/);
  assert.match(html, /setProperty\(\s*"--stick"/, "the bar's height is measured, not assumed");
  assert.match(html, /ResizeObserver/, "and re-measured when the bar reflows");
  assert.match(html, /scroll-margin-top:var\(--stick/, "a scrolled-to day clears it too");
});

test("without the script the document is not a broken sticky one", () => {
  // Both sticky rules are gated on the js class, so no-JS degrades to one plain column.
  const html = renderItineraryHtml(trip(), { ...noAssets, map: someMap });
  assert.doesNotMatch(html, /(?<!body\.js )\.topbar\{position:sticky/);
  assert.doesNotMatch(html, /(?<!body\.js )\.day>summary\{position:sticky/);
  assert.match(html, /body\.classList\.add\("js"\)/);
});

test("every stop in the day list wears its number and category", () => {
  // This is the other half of the map's dots: the number is the only thing tying a coloured dot
  // to the place it marks, so the two have to be generated from the same index.
  const t = trip();
  t.itinerary.days[0].stops[1].category = "food";
  const html = renderItineraryHtml(t, noAssets);
  assert.match(html, /<b class="snode" data-cat="entry">1<\/b>/, "the fixture's first stop is a sight");
  assert.match(html, /<b class="snode" data-cat="food">2<\/b>/, "and the second is now a meal");
});

test("the day list numbers restart at one each day, as the map's dots do", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  const days = html.split('<details class="day"');
  assert.match(days[1], /<b class="snode"[^>]*>1<\/b>/, "day 1 starts at 1");
  assert.match(days[2], /<b class="snode"[^>]*>1<\/b>/, "and so does day 2");
});

test("an unknown category falls to the neutral slot rather than colouring at random", () => {
  const t = trip();
  t.itinerary.days[0].stops[0].category = "brunch";
  delete t.itinerary.days[0].stops[1].category;
  const html = renderItineraryHtml(t, noAssets);
  assert.doesNotMatch(html, /data-cat="brunch"/);
  assert.equal((html.match(/data-cat="other"/g) || []).length, 2);
});

test("the category palette is defined once, for the list and the map alike", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  for (const v of ["--cat-food:#B4650E", "--cat-entry:#31699E", "--cat-transit:#357F52", "--cat-other:#0d2e37"]) {
    assert.ok(html.includes(v), `${v} must ship even when there is no map`);
  }
});
