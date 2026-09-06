/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/mapSvg.test.mjs
 *
 * The map section's markup, stylesheet and runtime. Most of what is asserted here is invisible in
 * a browser right up until it isn't: a namespace URL that fails the standalone-document rule, a
 * missing touch-action that kills panning on every phone, or a client projection formula that has
 * drifted from the server's and lands the GPS dot somewhere plausible but wrong. Nothing in this
 * suite renders, so these string assertions are the only guard any of them get. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MAP_CSS, MAP_RUNTIME, renderMapSection } from "./mapSvg.ts";

const map = (over = {}) => ({
  width: 1000,
  height: 680,
  x0: 0.87,
  y0: 0.39,
  spanX: 0.0004,
  spanY: 0.000272,
  unitsPerMetre: 0.03,
  mode: "city",
  roads: "M10 10L900 640",
  waterFill: "M0 0L100 0L100 100",
  waterLine: "M5 600L995 610",
  days: [
    { index: 0, date: "2026-08-20", d: "M100 100L300 200", stops: [
      { x: 100, y: 100, name: "Kunsthaus Zurich", n: 1, category: "entry" },
      { x: 300, y: 200, name: "Lindenhof", n: 2, category: "food" },
    ] },
    { index: 1, date: "2026-08-21", d: "M400 300L600 500", stops: [
      { x: 400, y: 300, name: "Rietberg", n: 1, category: "other" },
    ] },
  ],
  ...over,
});

test("no absolute URL reaches the section, the stylesheet or the runtime", () => {
  // The whole-document rule in itineraryHtml.test.mjs, enforced at the three sources that could
  // break it. The SVG namespace literal is a URL, which is why neither xmlns nor createElementNS
  // can appear here.
  for (const [name, text] of [["section", renderMapSection(map())], ["css", MAP_CSS], ["runtime", MAP_RUNTIME]]) {
    assert.doesNotMatch(text, /https?:\/\//, `${name} must carry no absolute URL`);
  }
});

test("the inline svg declares no namespace", () => {
  // Inline SVG in an HTML document is namespaced by the parser; an xmlns attribute would be both
  // redundant and a URL.
  assert.doesNotMatch(renderMapSection(map()), /xmlns/);
});

test("the runtime never builds an element by namespace", () => {
  // createElementNS would need the namespace URL, so every element it shows is pre-rendered.
  assert.doesNotMatch(MAP_RUNTIME, /createElementNS/);
  assert.match(renderMapSection(map()), /class="mhere mhide"/, "the GPS dot ships hidden, not created");
});

test("the runtime projects with Mercator, matching the server", () => {
  // If this decays to plate carrée the dot drifts from the roads and nothing else catches it.
  assert.match(MAP_RUNTIME, /Math\.tan/, "the client must use the same projection as mapProjection.ts");
  assert.match(MAP_RUNTIME, /85\.051129/, "and the same latitude clamp");
});

test("the runtime reads the frame the server measured", () => {
  const html = renderMapSection(map());
  for (const attr of ["data-w", "data-h", "data-x0", "data-y0", "data-sx", "data-sy", "data-upm"]) {
    assert.ok(html.includes(`${attr}="`), `${attr} must be emitted for the runtime to project through`);
    assert.match(MAP_RUNTIME, new RegExp(`dataset\\.${attr.slice(5)}`), `${attr} must be read`);
  }
});

test("the map is pannable on a touch screen", () => {
  // Without touch-action a phone scrolls the page and the pointer handlers never see a drag.
  assert.match(MAP_CSS, /touch-action:\s*none/);
});

test("wheel zooming does not also scroll the page", () => {
  // preventDefault is ignored on a passive listener, so the map would zoom while the page scrolled.
  assert.match(MAP_RUNTIME, /passive:\s*false/);
});

test("context strokes do not thicken with zoom", () => {
  // At 8x, scaled strokes turn the road network into a solid block.
  const html = renderMapSection(map());
  for (const cls of ["mroads", "mwline", "mline"]) {
    assert.match(
      html,
      new RegExp(`class="${cls}"[^>]*vector-effect="non-scaling-stroke"`),
      `${cls} must hold its stroke width through zoom`,
    );
  }
});

test("filled water is not stroked and stroked water is not filled", () => {
  const html = renderMapSection(map());
  assert.match(html, /class="mwfill" d=/, "a lake is a filled ring");
  assert.doesNotMatch(html, /class="mwfill"[^>]*vector-effect/, "a fill has no stroke to preserve");
  assert.match(MAP_CSS, /\.mwfill\{fill:[^;]+;stroke:none\}/);
  assert.match(MAP_CSS, /\.mwline\{fill:none/, "a coastline filled would draw a blob");
});

test("each day route is addressable by index and date", () => {
  const html = renderMapSection(map());
  assert.match(html, /<g class="mroute" data-day="0" data-date="2026-08-20">/);
  assert.match(html, /<g class="mroute" data-day="1" data-date="2026-08-21">/);
});

test("only a focused day is highlighted, and only then", () => {
  // The default view is the whole trip; greying every day by default would misread as one day on.
  assert.match(MAP_CSS, /\.map\[data-day\] \.mroute\{opacity:/);
  assert.match(MAP_CSS, /\.map\[data-day\] \.mroute\.mon\{opacity:1\}/);
});

test("stop names are escaped where they reach the markup", () => {
  const html = renderMapSection(map({
    days: [{ index: 0, date: "2026-08-20", d: "", stops: [
      { x: 1, y: 2, name: '<script>"x"&', n: 1, category: "food" },
    ] }],
  }));
  assert.doesNotMatch(html, /<title>1\. <script>/, "a model-written stop name is untrusted");
  assert.ok(html.includes("&lt;script&gt;&quot;x&quot;&amp;"));
});

test("an empty layer renders no path rather than an empty one", () => {
  const html = renderMapSection(map({ roads: "", waterFill: "", waterLine: "" }));
  assert.doesNotMatch(html, /d=""/, "an absent layer draws nothing at all");
  assert.doesNotMatch(html, /class="mroads"/);
});

test("a day with no drawable route still contributes its pins", () => {
  const html = renderMapSection(map({
    days: [{ index: 0, date: "2026-08-20", d: "", stops: [
      { x: 5, y: 6, name: "Only stop", n: 1, category: "food" },
    ] }],
  }));
  assert.doesNotMatch(html, /class="mline"/);
  assert.match(html, /class="mpin"[^>]*transform="translate\(5 6\)"/);
});

/* ---------- identity: which dot is which stop ---------- */

test("every dot carries its number and its category", () => {
  const html = renderMapSection(map());
  assert.match(html, /class="mpin" data-cat="entry"[^>]*transform="translate\(100 100\)"/);
  assert.match(html, /class="mpin" data-cat="food"[^>]*transform="translate\(300 200\)"/);
  assert.match(html, /<text class="mpt" x="0" y="0">1<\/text>/, "the number is drawn in the dot");
  assert.match(html, /<text class="mpt" x="0" y="0">2<\/text>/);
});

test("the number restarts at 1 each day, matching the day's own list", () => {
  const html = renderMapSection(map());
  const perDay = [...html.matchAll(/<g class="mroute"[^>]*>(.*?)<\/g><\/g><\/g>/gs)];
  // Day 2's single stop is numbered 1, not 3 — the list below it starts at 1 too.
  assert.match(html.split('data-day="1"')[1], /<text class="mpt" x="0" y="0">1<\/text>/);
  assert.ok(perDay.length >= 1);
});

test("a dot's colour is its category and never its day", () => {
  // Identity is the palette's job; the focused day is signalled by opacity and the route line.
  assert.doesNotMatch(MAP_CSS, /\.mroute\.mon \.mpin/, "focusing a day must not repaint its dots");
  assert.match(MAP_CSS, /\.mpin\[data-cat="food"\] \.mpd/);
  assert.match(MAP_CSS, /\.mpin\[data-cat="entry"\] \.mpd/);
  assert.match(MAP_CSS, /\.mpin\[data-cat="transit"\] \.mpd/);
});

test("the neutral slot is the default, so an unknown category still draws", () => {
  const html = renderMapSection(map({
    days: [{ index: 0, date: "2026-08-20", d: "", stops: [
      { x: 5, y: 6, name: "Odd", n: 1, category: "other" },
    ] }],
  }));
  assert.match(html, /data-cat="other"/);
  assert.match(MAP_CSS, /\.mpd\{fill:var\(--cat-other\)/, "other is the unqualified default fill");
});

test("the dot and its number scale together, so the glyph stays inside the circle", () => {
  // Two separate radius/font writes would drift; one transform on the group cannot.
  assert.match(MAP_RUNTIME, /pinScales\[i\]\.setAttribute\("transform", sc\)/);
  assert.match(MAP_RUNTIME, /scale\(/);
});

test("a legend names the colours, so identity is never colour alone", () => {
  const html = renderMapSection(map());
  for (const [cat, label] of [["food", "Food"], ["entry", "Sight"], ["transit", "Transit"], ["other", "Other"]]) {
    assert.match(html, new RegExp(`<li data-cat="${cat}">${label}</li>`), `${cat} is named`);
  }
  assert.match(MAP_CSS, /\.maplegend li\[data-cat="food"\]::before\{background:var\(--cat-food\)\}/);
});

test("hovering a dot still names the place, numbered", () => {
  assert.match(renderMapSection(map()), /<title>1\. Kunsthaus Zurich<\/title>/);
});

test("geolocation is opt-in and its absence is handled", () => {
  const html = renderMapSection(map());
  assert.match(html, /class="mgeo"/, "there is a button");
  assert.match(MAP_RUNTIME, /navigator\.geolocation/);
  assert.doesNotMatch(
    MAP_RUNTIME,
    /^\s*navigator\.geolocation\.watchPosition/m,
    "a watch must never start without a press",
  );
  assert.match(MAP_RUNTIME, /if \(!navigator\.geolocation\)/, "an unsupported browser hides the button");
  assert.match(MAP_RUNTIME, /clearWatch/, "the watch is released");
});

test("a region-scale trip says why it has no streets", () => {
  const html = renderMapSection(map({ mode: "region", roads: "", waterFill: "", waterLine: "" }));
  assert.match(html, /Too much ground between these stops/);
});

test("attribution is present as plain text, never as a link", () => {
  const html = renderMapSection(map());
  assert.match(html, /OpenStreetMap contributors/);
  assert.doesNotMatch(html, /<a /, "a link would carry a URL");
});

test("a number is only shown for the day it counts within", () => {
  // Every day restarts at 1, so two dots would otherwise wear the same label at once.
  assert.match(MAP_CSS, /\.map:not\(\[data-day\]\) \.mpt,\.map\[data-day\] \.mroute:not\(\.mon\) \.mpt\{opacity:0\}/);
  assert.match(MAP_CSS, /\.map:not\(\[data-day\]\) \.mpd,\.map\[data-day\] \.mroute:not\(\.mon\) \.mpd\{r:11px\}/,
    "an unlabelled dot needs no room for a glyph");
});

test("the map does not own the pinning, the bar it sits in does", () => {
  // One sticky container, measured once — two competing sticky elements is how an offset drifts.
  assert.doesNotMatch(MAP_CSS, /\.mapwrap\{position:sticky/);
  // Reading the offset is fine — dayInView probes at the line headings pin to. Writing it is not:
  // two scripts measuring one bar is how the offset drifts.
  assert.doesNotMatch(MAP_RUNTIME, /setProperty\(\s*"--stick"/, "only the header runtime measures the bar");
  assert.match(MAP_CSS, /body\.shrunk \.mapcredit\{display:none\}/, "the credit yields room once compact");
});

test("a day with nothing on the map is never focused", () => {
  // A real trip can carry an empty arrival or departure day; dimming every other route to
  // highlight nothing washed the entire map out.
  assert.match(MAP_RUNTIME, /if \(index !== null && !hasPins\(index\)\) return;/);
  assert.match(MAP_RUNTIME, /querySelectorAll\("\.mpin"\)\.length > 0/);
});

test("the highlighted day follows what the reader is looking at", () => {
  // Sticky headings mean several days are open at once, so "the last one toggled" is not an answer.
  assert.match(MAP_RUNTIME, /function dayInView\(\)/);
  assert.match(MAP_RUNTIME, /getPropertyValue\("--stick"\)/, "probed at the line headings pin to");
  assert.match(MAP_RUNTIME, /addEventListener\("scroll", refocus, \{ passive: true \}\)/);
});

test("scrolling re-highlights but never re-frames the map", () => {
  // frameDay moves the viewBox; running it from a scroll handler would yank the map about.
  const scrollHandler = MAP_RUNTIME.slice(MAP_RUNTIME.indexOf("function refocus"));
  assert.doesNotMatch(scrollHandler.slice(0, scrollHandler.indexOf("addEventListener")), /frameDay/);
});

test("the zoom cap clears the tightest stop pairs a real trip produces", () => {
  // Measured over every saved trip: the closest distinct pair is 0.91 user units apart (two
  // Amsterdam stops ~10m apart). A 40-unit dot separates only once 40/zoom < gap, so 44x is the
  // floor for that plan; Kyoto wants 29x. Below this, real itineraries carry dots that can never
  // be told apart at any magnification.
  const cap = /var MIN_W = W \/ (\d+);/.exec(MAP_RUNTIME);
  assert.ok(cap, "the zoom clamp must stay a single named constant");
  assert.ok(+cap[1] >= 44, `cap is ${cap[1]}x; 0.91-unit pairs need 44x to separate`);
});

test("the route and its dots are never simplified, so zoom cannot soften them", () => {
  // Only the context layers carry a tolerance; that is what makes a 48x cap defensible.
  const data = readFileSync(new URL("./exportMapData.ts", import.meta.url), "utf8");
  assert.match(data, /d: pathOf\(projectSegment\(numbered\.map\(\(entry\) => entry\.stop\), frame\)\)/,
    "the day route goes straight from projection to path, with no simplify step");
  for (const layer of ["roads", "waterFill", "waterLine"]) {
    assert.match(data, new RegExp(`${layer}: context\\s*\\?[\\s\\S]{0,160}SIMPLIFY_TOLERANCE`),
      `${layer} is a context layer and does carry the tolerance`);
  }
});
