/**
 * The map section of the exported itinerary: inline SVG, its stylesheet, and its client runtime.
 *
 * Three constraints shape every line here, and all three are enforced by `itineraryHtml.test.mjs`:
 *
 * 1. **No absolute URL may appear anywhere**, including inside script strings and comments. That
 *    rules out the two obvious ways to build SVG from script — `createElementNS` and an `xmlns`
 *    attribute both carry the SVG namespace literal, which is a URL. Every element the runtime
 *    shows or moves is therefore pre-rendered here and driven by attribute alone. Do not add a
 *    reference link to a comment in this file; it fails the suite.
 * 2. **Inline SVG in an HTML document needs no `xmlns`** — the parser namespaces it. Adding one is
 *    both redundant and a test failure.
 * 3. **The document is complete without the script.** With JS disabled the static SVG is still a
 *    correct map of the trip; pan, zoom, day focus and the GPS dot are all additive, exactly as
 *    the check-off runtime in `itineraryHtml.ts` is.
 */

import type { ExportMap } from "./exportMapData";
import { escapeHtml } from "./exportPrimitives";

export const MAP_CSS = `
/* ---------- offline map ---------- */
.mapwrap{margin:20px 0 2px;padding:0 22px}
/* The map rides inside .topbar, which is what is pinned — see the header rules in the main
   stylesheet. The credit line drops out once the bar is compact so the day's stops keep the room;
   it is still in the document and visible at the top of the page. */
body.shrunk .mapcredit{display:none}
.mapbox{position:relative;overflow:hidden;border-radius:16px;border:1px solid var(--hair);background:#E9EEEF}
/* touch-action is load-bearing: without it a phone scrolls the page instead of panning the map,
   and pinch-zoom never reaches the handlers at all. */
.map{display:block;width:100%;height:auto;touch-action:none;cursor:grab}
.map:active{cursor:grabbing}
.mwfill{fill:#D5E2E5;stroke:none}
.mwline{fill:none;stroke:#C3D5D9;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.mroads{fill:none;stroke:rgba(11,42,50,.15);stroke-width:1.1;stroke-linecap:round;stroke-linejoin:round}
.mline{fill:none;stroke:var(--deep);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
/* A dot carries two encodings: its colour is the kind of stop, its number is which stop. The
   number is not decoration — the palette's CVD separation sits in the band that is only legal
   with a secondary channel, and this is that channel. It is also what lets a 14-stop day work at
   all, where 14 distinguishable hues do not exist. */
.mpd{fill:var(--cat-other);stroke:#fff;stroke-width:2.5}
.mpin[data-cat="food"] .mpd{fill:var(--cat-food)}
.mpin[data-cat="entry"] .mpd{fill:var(--cat-entry)}
.mpin[data-cat="transit"] .mpd{fill:var(--cat-transit)}
.mpt{fill:#fff;font-weight:700;font-size:19px;letter-spacing:-.04em;text-anchor:middle;
  dominant-baseline:central;font-variant-numeric:tabular-nums;pointer-events:none}
/* A number only means something inside the day it counts. With nothing focused, day 1's "4" and
   day 2's "4" are two different places wearing one label — so the overview shows the trip's shape
   and its mix of stops, and identity arrives with the day the reader opens. The dots shrink to
   match, since an unlabelled mark needs no room for a glyph. (The r geometry property is widely
   supported; where it is not, the attribute's own 20 stands and only the sizing is lost.) */
.map:not([data-day]) .mpt,.map[data-day] .mroute:not(.mon) .mpt{opacity:0}
.map:not([data-day]) .mpd,.map[data-day] .mroute:not(.mon) .mpd{r:11px}
/* Quieten every other day only once a day is actually focused, so the default view reads as the
   whole trip rather than as one day with the rest greyed out. */
.map[data-day] .mroute{opacity:.17}
.map[data-day] .mroute.mon{opacity:1}
/* The ink shade, not the fill shade: as a 2.6px stroke the fill shade measures 2.15:1 on the
   map ground, under the 3:1 floor for a graphical object. This is 6.48:1, and still 4.69:1
   against the inactive lines, which composite to #c4cdd0 at their 17% opacity. */
.mroute.mon .mline{stroke:var(--accent-ink)}
.mhalo{fill:rgba(251,152,38,.16);stroke:none}
.mdot{fill:var(--accent);stroke:#fff;stroke-width:2.4}
.mhide{display:none}
.mapctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
.mapctl button{font:inherit;font-weight:600;font-size:.8125rem;letter-spacing:-.02em;
  padding:9px 15px;border-radius:999px;border:1px solid var(--hair);
  background:var(--card);color:var(--ink);cursor:pointer}
.mapctl button:disabled{opacity:.5;cursor:default}
.mapmsg{flex-basis:100%;font-size:.8125rem;color:var(--muted)}
.maplegend{list-style:none;display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px;
  font-size:.75rem;font-weight:600;letter-spacing:-.03em;color:var(--muted)}
.maplegend li{display:flex;align-items:center;gap:6px}
.maplegend li::before{content:"";width:11px;height:11px;border-radius:50%;background:var(--cat-other)}
.maplegend li[data-cat="food"]::before{background:var(--cat-food)}
.maplegend li[data-cat="entry"]::before{background:var(--cat-entry)}
.maplegend li[data-cat="transit"]::before{background:var(--cat-transit)}
.mapcredit{margin-top:8px;font-size:.75rem;color:var(--muted)}
@media (prefers-reduced-motion: reduce){.map{scroll-behavior:auto}}
`;

/**
 * The map's client. Separate from the check-off runtime rather than folded into it: that one's
 * doc comment promises it does two things and neither is load-bearing, and keeping two IIFEs that
 * share nothing but the DOM keeps that true of both.
 *
 * The Mercator formula below must stay algebraically identical to `mercatorXY` in
 * `mapProjection.ts`. If they drift, the dot lands somewhere plausible but wrong, which is worse
 * than not drawing it — `mapSvg.test.mjs` asserts this script still contains `Math.tan`.
 */
export const MAP_RUNTIME = `<script>
(function(){
  var svg = document.querySelector(".map");
  if (!svg) return;

  var W = +svg.dataset.w, H = +svg.dataset.h;
  var x0 = +svg.dataset.x0, y0 = +svg.dataset.y0;
  var sx = +svg.dataset.sx, sy = +svg.dataset.sy, upm = +svg.dataset.upm;

  var pins = svg.querySelectorAll(".mpin");
  var pinScales = svg.querySelectorAll(".mpz");
  var routes = svg.querySelectorAll(".mroute");
  var here = svg.querySelector(".mhere");
  var halo = svg.querySelector(".mhalo");
  var dot = svg.querySelector(".mdot");
  var geoBtn = document.querySelector(".mgeo");
  var resetBtn = document.querySelector(".mrst");
  var msg = document.querySelector(".mapmsg");

  // 48x, and the number comes from the stops rather than from taste. Measured across every saved
  // trip, the tightest pair a real plan produces is 0.91 units apart (two Amsterdam stops about
  // ten metres apart); a 40-unit dot only clears its neighbour once 40/zoom drops under that gap,
  // which needs 44x. Kyoto's tightest wants 29x and Lisbon's 14x, so anything under about 45x
  // leaves real itineraries with dots that can never be told apart.
  //
  // What softens up here is only the *background*: road, water and boundary paths carry a 0.4-unit
  // simplification, so past roughly 20x they read as slightly angular. The day's route line and
  // the stop dots are projected exactly and never simplified, so the things a reader zooms this
  // far to look at stay sharp at any magnification. Trading road coverage for road smoothness
  // would be the wrong way round — coverage is what matters at the zoom people actually sit at.
  var MIN_W = W / 48;
  var view = { x: 0, y: 0, w: W, h: H };
  var accuracyUnits = 0;

  function say(text) {
    if (!msg) return;
    msg.textContent = text || "";
    msg.classList.toggle("mhide", !text);
  }

  function apply() {
    view.w = Math.max(MIN_W, Math.min(W, view.w));
    view.h = view.w * H / W;
    view.x = Math.max(0, Math.min(W - view.w, view.x));
    view.y = Math.max(0, Math.min(H - view.h, view.y));
    svg.setAttribute("viewBox", view.x + " " + view.y + " " + view.w + " " + view.h);

    // Strokes hold their width through vector-effect, but a circle's radius and a glyph's size are
    // geometry and do scale, so at 8x every pin would swallow the block it marks. One scale on the
    // group counter-scales the dot and its number together.
    var k = view.w / W;
    var sc = "scale(" + k.toFixed(4) + ")";
    for (var i = 0; i < pinScales.length; i++) pinScales[i].setAttribute("transform", sc);
    if (dot) dot.setAttribute("r", (6.5 * k).toFixed(2));
    if (halo) {
      // The halo is a real-world distance, so unlike the pins it must NOT rescale with zoom.
      var r = Math.min(accuracyUnits, W * 0.6);
      halo.setAttribute("r", r > 6.5 * k ? r.toFixed(1) : "0");
    }
  }

  function userPoint(clientX, clientY) {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return { x: view.x, y: view.y };
    return {
      x: view.x + (clientX - r.left) / r.width * view.w,
      y: view.y + (clientY - r.top) / r.height * view.h
    };
  }

  function zoomAt(px, py, factor) {
    var nw = Math.max(MIN_W, Math.min(W, view.w * factor));
    var nh = nw * H / W;
    view.x = px - (px - view.x) * (nw / view.w);
    view.y = py - (py - view.y) * (nh / view.h);
    view.w = nw;
    view.h = nh;
    apply();
  }

  function reset() { view.x = 0; view.y = 0; view.w = W; view.h = H; apply(); }

  // passive:false, or preventDefault is ignored and the page scrolls while the map zooms.
  svg.addEventListener("wheel", function (e) {
    e.preventDefault();
    var p = userPoint(e.clientX, e.clientY);
    zoomAt(p.x, p.y, e.deltaY > 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });

  var active = {};
  svg.addEventListener("pointerdown", function (e) {
    try { svg.setPointerCapture(e.pointerId); } catch (err) {}
    active[e.pointerId] = { x: e.clientX, y: e.clientY };
  });

  svg.addEventListener("pointermove", function (e) {
    if (!active[e.pointerId]) return;
    var ids = Object.keys(active);
    var rect = svg.getBoundingClientRect();
    if (!rect.width) return;

    if (ids.length === 1) {
      var prev = active[e.pointerId];
      view.x -= (e.clientX - prev.x) / rect.width * view.w;
      view.y -= (e.clientY - prev.y) / rect.height * view.h;
      active[e.pointerId] = { x: e.clientX, y: e.clientY };
      apply();
      return;
    }

    var a = active[ids[0]], b = active[ids[1]];
    var before = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
    active[e.pointerId] = { x: e.clientX, y: e.clientY };
    a = active[ids[0]]; b = active[ids[1]];
    var after = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
    if (before > 0 && after > 0) {
      var mid = userPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomAt(mid.x, mid.y, before / after);
    }
  });

  function release(e) { delete active[e.pointerId]; }
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);
  svg.addEventListener("dblclick", function (e) { e.preventDefault(); reset(); });
  if (resetBtn) resetBtn.addEventListener("click", reset);

  function frameDay(index) {
    var group = routes[index];
    if (!group) return;
    var marks = group.querySelectorAll(".mpin");
    if (!marks.length) return;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < marks.length; i++) {
      var cx = +marks[i].dataset.x, cy = +marks[i].dataset.y;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
    }

    var padX = Math.max(70, (maxX - minX) * 0.3);
    var padY = Math.max(70, (maxY - minY) * 0.3);
    var wantW = Math.max((maxX - minX) + padX * 2, ((maxY - minY) + padY * 2) * W / H);
    view.w = Math.max(MIN_W, Math.min(W, wantW));
    view.h = view.w * H / W;
    view.x = (minX + maxX) / 2 - view.w / 2;
    view.y = (minY + maxY) / 2 - view.h / 2;
    apply();
  }

  function hasPins(index) {
    return !!routes[index] && routes[index].querySelectorAll(".mpin").length > 0;
  }

  function focusDay(index) {
    // Refuse to focus a day with nothing on the map. A trip can carry an empty day — an arrival
    // or departure with no stops planned — and dimming every other route to highlight nothing
    // washes the whole map out, which is what it did.
    if (index !== null && !hasPins(index)) return;
    if (index === null) svg.removeAttribute("data-day");
    else svg.dataset.day = String(index);
    for (var i = 0; i < routes.length; i++) {
      routes[i].classList.toggle("mon", index !== null && i === index);
    }
  }

  /**
   * Which open day the reader is actually looking at, probed just under the pinned bar — the same
   * line the day's own sticky heading locks to. Several days being open at once is the normal
   * state now that headings pin, so "the last one toggled" is not an answer.
   */
  function dayInView() {
    var stick = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--stick")) || 0;
    var probe = stick + 8;
    var open = [];
    for (var i = 0; i < details.length; i++) if (details[i].open && hasPins(i)) open.push(i);
    if (!open.length) return null;
    for (var j = 0; j < open.length; j++) {
      var r = details[open[j]].getBoundingClientRect();
      if (r.top <= probe && r.bottom > probe) return open[j];
    }
    return details[open[0]].getBoundingClientRect().top > probe ? open[0] : open[open.length - 1];
  }

  var details = document.querySelectorAll("details.day");
  for (var d = 0; d < details.length; d++) {
    (function (el, index) {
      // Attached per element rather than delegated: toggle does not bubble.
      el.addEventListener("toggle", function () {
        if (el.open) { focusDay(index); frameDay(index); }
        else { focusDay(dayInView()); }
      });
      // The check-off runtime opens today's day before this script runs, so the initial state has
      // to be read rather than assumed closed.
      if (el.open) { focusDay(index); frameDay(index); }
    })(details[d], d);
  }

  // Highlight only — reframing the map while the reader is mid-scroll would yank it about.
  var focusQueued = 0;
  function refocus() {
    if (focusQueued) return;
    focusQueued = requestAnimationFrame(function () {
      focusQueued = 0;
      focusDay(dayInView());
    });
  }
  window.addEventListener("scroll", refocus, { passive: true });
  refocus();

  if (!geoBtn) return;
  if (!navigator.geolocation) { geoBtn.classList.add("mhide"); return; }

  var watch = null;

  function stopWatch() {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
    accuracyUnits = 0;
    if (here) here.classList.add("mhide");
    geoBtn.textContent = "Show my location";
  }

  function onFix(pos) {
    var c = pos.coords;
    var lat = Math.max(-85.051129, Math.min(85.051129, c.latitude));
    var phi = lat * Math.PI / 180;
    var mx = (c.longitude + 180) / 360;
    var my = (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2;
    var x = (mx - x0) / sx * W;
    var y = (my - y0) / sy * H;

    geoBtn.textContent = "Hide my location";

    if (x < -W * 0.1 || x > W * 1.1 || y < -H * 0.1 || y > H * 1.1) {
      if (here) here.classList.add("mhide");
      say("You are outside the area this map covers.");
      return;
    }

    if (here) {
      here.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")");
      here.classList.remove("mhide");
    }
    accuracyUnits = (c.accuracy || 0) * upm;
    apply();
    say("");
  }

  function onError(err) {
    if (err && err.code === 1) {
      stopWatch();
      say("Location permission was denied. On an iPhone, a file opened from Files cannot use GPS.");
    } else if (err && err.code === 3) {
      say("Still searching. With no signal a first GPS fix can take a minute, and rarely works indoors.");
    } else {
      say("No GPS signal yet.");
    }
  }

  geoBtn.addEventListener("click", function () {
    if (watch !== null) { stopWatch(); say(""); return; }
    say("Finding you. With no signal a first GPS fix can take a minute.");
    geoBtn.textContent = "Searching\\u2026";
    watch = navigator.geolocation.watchPosition(onFix, onError, {
      enableHighAccuracy: true, timeout: 60000, maximumAge: 30000
    });
  });

  window.addEventListener("pagehide", function () {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
  });
})();
</script>`;

function renderRoute(day: ExportMap["days"][number]): string {
  const line = day.d
    ? `<path class="mline" vector-effect="non-scaling-stroke" d="${day.d}"/>`
    : "";
  const pins = day.stops
    .map(
      (stop) =>
        `<g class="mpin" data-cat="${stop.category}" data-x="${stop.x}" data-y="${stop.y}" ` +
        `transform="translate(${stop.x} ${stop.y})"><g class="mpz">` +
        `<circle class="mpd" vector-effect="non-scaling-stroke" r="20"/>` +
        `<text class="mpt" x="0" y="0">${stop.n}</text>` +
        `<title>${escapeHtml(stop.n + ". " + stop.name)}</title>` +
        `</g></g>`,
    )
    .join("");
  return `<g class="mroute" data-day="${day.index}" data-date="${escapeHtml(day.date)}">${line}${pins}</g>`;
}

/**
 * The whole section. `map` is never null here — `renderItineraryHtml` omits the section entirely
 * rather than rendering an empty one, the same rule an absent cover photo follows.
 *
 * The SVG is `aria-hidden` because it duplicates information the day list below already carries in
 * text, and a screen reader walking a few hundred anonymous `<path>` elements gains nothing. Same
 * reasoning the app's floating stop markers use.
 */
export function renderMapSection(map: ExportMap): string {
  const layers = [
    map.waterFill ? `<path class="mwfill" d="${map.waterFill}"/>` : "",
    map.waterLine
      ? `<path class="mwline" vector-effect="non-scaling-stroke" d="${map.waterLine}"/>`
      : "",
    map.roads ? `<path class="mroads" vector-effect="non-scaling-stroke" d="${map.roads}"/>` : "",
  ].join("");

  const routes = map.days.map(renderRoute).join("");

  // Pre-rendered and hidden rather than created on the first fix: building an SVG element from
  // script needs the namespace URL, and no URL may reach this document.
  const here =
    `<g class="mhere mhide">` +
    `<circle class="mhalo" r="0"/>` +
    `<circle class="mdot" vector-effect="non-scaling-stroke" r="6.5"/>` +
    `</g>`;

  const hint =
    map.mode === "city"
      ? map.basemap
        ? "Map data from OpenStreetMap contributors, ODbL."
        : "Street detail was unavailable when this file was saved, so only the route is drawn. Map data from OpenStreetMap contributors, ODbL."
      : "Too much ground between these stops for street detail. Map data from OpenStreetMap contributors, ODbL.";

  return `<section class="mapwrap">
  <div class="mapbox">
    <svg class="map" viewBox="0 0 ${map.width} ${map.height}" preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      data-w="${map.width}" data-h="${map.height}"
      data-x0="${map.x0}" data-y0="${map.y0}" data-sx="${map.spanX}" data-sy="${map.spanY}"
      data-upm="${map.unitsPerMetre}">${layers}${routes}${here}</svg>
  </div>
  <div class="mapctl">
    <button type="button" class="mgeo">Show my location</button>
    <button type="button" class="mrst">Reset view</button>
    <p class="mapmsg mhide"></p>
  </div>
  <ul class="maplegend">
    <li data-cat="food">Food</li>
    <li data-cat="entry">Sight</li>
    <li data-cat="transit">Transit</li>
    <li data-cat="other">Other</li>
  </ul>
  <p class="mapcredit">${hint}</p>
</section>`;
}
