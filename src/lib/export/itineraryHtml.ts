import { formatDateRange, formatDateWithWeekday, formatMoney } from "../format";
import { dayPlanned } from "../itinerary";
import type { DayPlan, Stop, Trip } from "../types";
import { costLabel, dayLegs, escapeHtml, slugify, stripEmoji } from "./exportPrimitives";
import type { ExportMap } from "./exportMapData";
import { MAP_CSS, MAP_RUNTIME, renderMapSection } from "./mapSvg";

export interface ExportAssets {
  /** A `data:font/woff2;base64,...` URI, or null to fall back to the system stack. */
  /** The text face (Switzer), inlined. */
  fontDataUri: string | null;
  /** The display face (Melodrama), inlined. Sets the destination only. */
  displayFontDataUri?: string | null;
  /** The offline map, or absent/null for a document without one. Optional rather than
   *  required-nullable so "the geometry could not be fetched" and "this caller wants no map" stay
   *  one code path — and so the fixtures that prove the document survives with no assets at all
   *  keep proving exactly that. */
  map?: ExportMap | null;
}

/** THESIS / OWN-WORLD / STORY / FIRST VIEWPORT / FORM / FINISH — see the design spec. Emitted as
 *  the first child of <body> so the contract is auditable in the shipped file, not only here. */
const DIRECTION_CONTRACT = `<!--
  THESIS: A day is a route, not a list. Refuses the itinerary-app default of stacked cards.
  OWN-WORLD: Transit-diagram grammar on #F5F7F7. 8px trunk in TripMate's own #0d2e37; stops are
    interchange nodes; jade #28b981 (fills) / #0D6042 (strokes) marks only what is active, per the
    app's reserved-accent rule.
  STORY: The traveler sees the trip as one line, taps into a day, and reads it like a metro map.
  FIRST VIEWPORT: Destination photo ~44svh, destination in Melodrama 400 at
    clamp(3.2rem,17vw,5rem), dates and budget beneath, then the trip line with one station per day.
  FORM: Route-as-spine, candidate 7 of 7, seed key e57fcfdf.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
    verdict, and DESIGN.md.
-->`;

/** The comp's CSS, verbatim: type scale, trunk weight, node treatment and spacing are the design
 *  authority (.impeccable/comps/comp-b-linemap.html), not re-derived here. The one addition the
 *  comp doesn't need to show — a per-day thumbnail sitting where its plain node (`.st i`) would
 *  go — mirrors that node's own size, border and "on" treatment exactly. */
/**
 * Why the export's accent is jade, and why it is two shades.
 *
 * Kept out of the CSS template literal on purpose: everything in there ships inside the `.html`
 * file a traveler keeps and forwards, and the first version of this note put ~1.5KB of rationale
 * about a superseded hex into every export. The `DIRECTION_CONTRACT` ships deliberately because a
 * reader of the artifact can audit it; a changelog cannot be audited from the artifact and does
 * not belong there.
 *
 * This carried the previous system's amber (`#fb9826` / `#A85C05`) through two palettes, purely
 * because the file had been byte-verified against its own approved comp and nobody wanted to
 * disturb it. DESIGN.md tracked it as an open item rather than aligning it quietly.
 *
 * **Re-hued by measurement, not by copying the app's hex.** The export's marks are validated
 * *all-pairs*, because on the map any two of them can sit side by side. Against the category hues
 * jade's worst pair is dE2000 18.7 (jade/transit) on a 15.5 floor, where amber was 18.5 — a small
 * improvement rather than a risk — and the worst CVD pair is `food/transit` at 10.9 either way, so
 * the accent does not touch it. Coral was rejected outright at dE 4.0 against transit under
 * simulated protanopia. Gold separated best but had the worst contrast, and gold means money here.
 *
 * **Two shades, split by fills versus strokes.** On a light ground one mid-tone cannot do both
 * jobs. `--accent` fills, where dark ink sits on it (6:1 for the day number) and a white ring
 * separates it. `--accent-ink` strokes and rims, where the mark *is* the colour and has to carry
 * itself against paper: 7.58:1 on white for the 1.9px stay icon, 3.01:1 against the jade fill for
 * the open day's rim.
 *
 * That split is also a fix. The map's active route line used the fill shade, which as a 2.6px
 * stroke measured 1.86:1 on land and 1.65:1 over water — under the 3:1 floor for a graphical
 * object. On the ink shade it is 6.48:1 and 5.72:1, and still 4.69:1 against the inactive lines,
 * which composite to #c4cdd0 at their 17% opacity.
 */
const CSS = `
:root{
  --paper:#F5F7F7; --card:#fff; --ink:#0B2A32; --deep:#0d2e37;
  --muted:#5B7178; --hair:rgba(11,42,50,.14);
  /* One colour, marking only what is active. Jade fills, dark jade strokes. */
  --accent:#28b981; --accent-ink:#0D6042;
  --trunk:8px;
  /* Stop categories. Three hues carrying identity, validated all-pairs (the pairlist a map of
     dots needs, since any two marks can sit side by side) against both #E9EEEF and #fff:
     lightness band, chroma floor, normal-vision floor 15.5 and contrast all pass; CVD sits at
     dE 6.2, which is legal only because every mark also carries its number. The 'other' slot is
     deliberately achromatic — it is the absence of a category, not a fourth one competing for
     identity, and it is 24% of real stops. */
  --cat-food:#B4650E; --cat-entry:#31699E; --cat-transit:#357F52; --cat-other:#0d2e37;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{
  background:var(--paper); color:var(--ink);
  font-family:Switzer,ui-sans-serif,system-ui,sans-serif;
  font-size:.9375rem; line-height:1.6; letter-spacing:0;
  -webkit-font-smoothing:antialiased;
}
/* ---------- the pinned bar: title + map ---------- */
/* Both sticky rules are gated on the js class, which the runtime adds. Without it --stick is 0
   day heading would pin underneath the map covering it — so with no script the file stays the
   plain single-column document it promises to be, rather than a broken sticky one. */
body.js .topbar{position:sticky;top:0;z-index:20;background:var(--paper)}
body.shrunk .topbar{box-shadow:0 12px 16px -14px rgba(11,42,50,.55)}
.mast{padding:26px 22px 0;transition:padding-top .26s cubic-bezier(.4,0,.2,1)}
/* Two states with a transition between them, rather than a size scrubbed from scrollY.
   Scrubbing was tried and is a feedback loop: the bar collapsing shortens the document, which
   moves scrollY, which feeds back into the size — measured settling at 0.24 where it should have
   been 1. A latched state cannot chase itself, and the transition is what makes it read as one
   continuous movement. */
h1{font-family:Melodrama,ui-serif,Georgia,serif;
  font-size:clamp(3.2rem,17vw,5rem);font-weight:400;line-height:.95;letter-spacing:-.018em;
  transition:font-size .26s cubic-bezier(.4,0,.2,1)}
.trmeta{overflow:hidden;max-height:3.6rem;opacity:1;
  transition:max-height .26s cubic-bezier(.4,0,.2,1),opacity .18s linear}
body.shrunk h1{font-size:1.7rem}
body.shrunk .trmeta{max-height:0;opacity:0}
body.shrunk .mast{padding-top:11px}
.dates{margin-top:12px;font-size:.9375rem;font-weight:500;color:var(--muted)}
.budget{margin-top:4px;font-size:.9375rem;font-weight:500;color:var(--muted)}
.budget b{color:var(--ink);font-weight:600}
@media (prefers-reduced-motion: reduce){h1,.mast,.trmeta{transition:none}}

/* ---------- day index ---------- */
.days{padding:14px 0 48px}
.day{border-top:1px solid var(--hair);background:var(--paper);scroll-margin-top:var(--stick,0px)}
.day>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:34px 1fr 18px;
  gap:14px;align-items:center;padding:16px 22px;background:var(--paper)}
/* --stick is the measured height of the pinned bar, so the heading locks flush under the map
   instead of overlapping it. Its sticky container is its own <details>, which is exactly the
   scope wanted: Day 1's heading rides along while Day 1 is on screen and leaves with it. */
body.js .day>summary{position:sticky;top:var(--stick,0px);z-index:10;
  border-top:1px solid var(--hair);margin-top:-1px}
.day>summary::-webkit-details-marker{display:none}
.dnum{width:30px;height:30px;border-radius:50%;border:3px solid var(--deep);background:var(--card);
  display:grid;place-items:center;font-size:.8125rem;font-weight:600;letter-spacing:0;
  font-variant-numeric:tabular-nums}
.day[open] .dnum{background:var(--accent);border-color:var(--accent-ink)}
.dtitle{font-size:1rem;font-weight:600;letter-spacing:-.012em;line-height:1.25}
.ddate{display:block;margin-top:2px;font-size:.8125rem;font-weight:400;color:var(--muted)}
.chev{width:16px;height:16px;stroke:var(--muted);stroke-width:2.2;fill:none;transition:transform .18s}
.day[open] .chev{transform:rotate(90deg)}

/* ---------- day body ---------- */
.dbody{padding:0 22px 32px}
.wx{display:inline-flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--hair);
  border-radius:999px;padding:6px 13px 6px 10px;font-size:.75rem;font-weight:600;
  letter-spacing:0;color:var(--muted)}
.wx svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8}
.dsum{margin-top:12px;font-size:.9375rem;color:var(--muted);line-height:1.55}

/* ---------- the day's own line ---------- */
.route{list-style:none;margin-top:24px;position:relative;padding-left:0}
.route::before{content:"";position:absolute;left:64px;top:9px;bottom:34px;width:var(--trunk);
  background:var(--deep);border-radius:999px;transform:translateX(-50%)}
.stop{position:relative;display:grid;grid-template-columns:44px 1fr;gap:34px;padding-bottom:2px}
.time{font-size:.8125rem;font-weight:600;letter-spacing:0;color:var(--muted);
  text-align:right;padding-top:2px;font-variant-numeric:tabular-nums}
.snode{position:absolute;left:64px;top:1px;width:24px;height:24px;border-radius:50%;
  transform:translateX(-50%);z-index:1;display:flex;align-items:center;justify-content:center;
  font-size:.6875rem;font-weight:600;letter-spacing:0;font-variant-numeric:tabular-nums;
  color:#fff;background:var(--cat-other);border:3px solid var(--paper)}
.snode[data-cat="food"]{background:var(--cat-food)}
.snode[data-cat="entry"]{background:var(--cat-entry)}
.snode[data-cat="transit"]{background:var(--cat-transit)}
.stop[data-stop]{cursor:pointer}
.stop.done .sname{opacity:.55}
.stop.done .snode{opacity:.4}
.sname{font-size:1.0625rem;font-weight:600;letter-spacing:-.012em;line-height:1.24}
.smeta{margin-top:4px;font-size:.8125rem;font-weight:500;color:var(--muted)}
.swhy{margin-top:8px;font-size:.875rem;color:var(--ink);opacity:.82;line-height:1.55}
.snote{margin-top:5px;font-size:.875rem;color:var(--muted);line-height:1.55}

/* legs: a label riding the line, the way a metro map labels a section */
.leg{position:relative;display:grid;grid-template-columns:44px 1fr;gap:34px;padding:13px 0 17px}
.legpill{display:inline-flex;align-items:center;gap:7px;background:var(--paper);
  border:1px solid var(--hair);border-radius:999px;padding:4px 11px 4px 9px;
  font-size:.6875rem;font-weight:600;letter-spacing:0;color:var(--muted)}
.legpill svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2}

/* stay + total */
.stay{margin-top:22px;display:flex;gap:11px;align-items:flex-start;background:var(--card);
  border:1px solid var(--hair);border-radius:14px;padding:14px 15px}
.stay svg{width:17px;height:17px;flex:none;margin-top:1px;fill:none;stroke:var(--accent-ink);stroke-width:1.9}
.stay b{display:block;font-size:.9375rem;font-weight:600;letter-spacing:0}
.stay span{display:block;margin-top:3px;font-size:.8125rem;color:var(--muted)}
.dtotal{margin-top:16px;display:flex;justify-content:space-between;align-items:baseline;
  border-top:2px solid var(--deep);padding-top:12px;font-size:.8125rem;font-weight:600;
  letter-spacing:0;color:var(--muted)}
.dtotal b{font-family:Melodrama,ui-serif,Georgia,serif;font-size:1.5rem;font-weight:400;
  letter-spacing:-.005em;font-variant-numeric:proportional-nums lining-nums;color:var(--ink)}

/* inline spans used as block rows */
.sname,.smeta,.dtitle,.ddate,.stop>span:last-child,.st b,.st span{display:block}
.leg .legpill{justify-self:start}
`;

/**
 * The whole client. Nothing here is load-bearing: without it the file is still a complete,
 * readable itinerary, because days are native <details>, check-off is additive, and both sticky
 * rules are gated behind the `js` class this adds.
 *
 * It owns the document's chrome — the pinned bar's scrub and its measured height — while
 * `MAP_RUNTIME` owns the map. They share only the DOM.
 *
 * The bar's height is *measured* into `--stick` rather than assumed, because a day heading pins
 * against it: guess low and the heading overlaps the map, guess high and it floats. The title
 * shrinking changes that height on every frame of a scroll, so it is re-read on each one, and a
 * ResizeObserver catches the rest (a rotation, a wrapped legend, the map's own aspect).
 *
 * Dates are compared as strings. `new Date("2026-08-20")` parses as UTC midnight and formatting
 * it with local accessors rolls it back a day anywhere west of Greenwich — the trap that has
 * already put a wrong weekday into generated output. Building today's key from local parts and
 * doing a string compare never constructs a Date from the data at all.
 */
const RUNTIME = `<script>
(function(){
  var root = document.documentElement;
  var body = document.body;
  body.classList.add("js");

  var topbar = document.querySelector(".topbar");
  // Collapsing the bar removes its own height from the document, which drags the scroll position
  // back toward the top — the very position that decided to collapse it. Measured at 31 class
  // flips a second with the thresholds 56/20. So the gap between them has to be wider than the
  // collapse itself: the bar sheds at most the title's 5rem-to-1.7rem, the trip meta's 3.6rem and
  // 15px of padding, about 126px, so shrinking at 220 leaves the post-collapse position near 94
  // and nowhere near the 24 that would grow it back.
  var SHRINK_AT = 220;
  var GROW_AT = 24;
  var shrunk = false;
  var queued = 0;

  function measure() {
    if (topbar) root.style.setProperty("--stick", Math.round(topbar.getBoundingClientRect().height) + "px");
  }

  function onScroll() {
    if (queued) return;
    queued = requestAnimationFrame(function () {
      queued = 0;
      var y = window.scrollY;
      // A page with barely anything to scroll cannot afford the collapse: removing that much
      // height would drag the scroll position back past the threshold and oscillate.
      var room = root.scrollHeight - window.innerHeight > 420;
      shrunk = room && (shrunk ? y > GROW_AT : y > SHRINK_AT);
      body.classList.toggle("shrunk", shrunk);
      measure();
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  if (window.ResizeObserver && topbar) new ResizeObserver(measure).observe(topbar);
  onScroll();

  var pad = function(n){ return n < 10 ? "0" + n : "" + n; };
  var now = new Date();
  var today = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());

  var days = document.querySelectorAll("details.day");
  for (var i = 0; i < days.length; i++) {
    if (days[i].dataset.date === today) {
      days[i].open = true;
      days[i].scrollIntoView({ block: "start" });
    }
  }

  var trip = document.body.dataset.trip;
  var key = "tripmate:" + trip + ":done";
  var done = {};
  try { done = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { done = {}; }

  var stops = document.querySelectorAll("[data-stop]");
  for (var j = 0; j < stops.length; j++) {
    (function (el) {
      var id = el.dataset.stop;
      if (done[id]) el.classList.add("done");
      el.addEventListener("click", function () {
        if (done[id]) { delete done[id]; el.classList.remove("done"); }
        else { done[id] = 1; el.classList.add("done"); }
        try { localStorage.setItem(key, JSON.stringify(done)); } catch (e) {}
      });
    })(stops[j]);
  }
})();
</script>`;

const WEATHER_ICON =
  '<svg viewBox="0 0 24 24"><path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 6.5 19z"/><path d="M9 21.5 8 23M13 21.5 12 23"/></svg>';
const WALK_ICON =
  '<svg viewBox="0 0 24 24"><path d="M13 4.5a1.5 1.5 0 1 0 0-.01M11 21l1.5-5.5L9.5 13l1-4.5 3 2 3 .8"/><path d="m7.5 21 2.2-4.6M9 8.5 6 10"/></svg>';
const TRANSIT_ICON =
  '<svg viewBox="0 0 24 24"><rect x="6" y="3.5" width="12" height="13" rx="2.5"/><path d="M6 10h12M9.5 20.5 8 22.5M14.5 20.5 16 22.5"/></svg>';
/** Two wheels, a frame and bars — drawn in the same 24px box and single-stroke style as its
 *  siblings so the leg rail stays one family at export scale. */
const BIKE_ICON =
  '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-8h5l-3 8h7M14 6.5h2.5"/></svg>';
const STAY_ICON =
  '<svg viewBox="0 0 24 24"><path d="M3 21V8.5L12 3l9 5.5V21"/><path d="M9.5 21v-6h5v6"/></svg>';
const CHEV_ICON = '<svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';

export function dayHeading(day: DayPlan, index: number): string {
  if (day.title) return day.title;
  if (day.summary) {
    const stripped = stripEmoji(day.summary);
    if (stripped) return stripped;
  }
  return `Day ${index + 1}`;
}

export function exportFilename(destination: string): string {
  // `cityName`'s rule, matching ItineraryCard: the part before the first comma.
  return `${slugify(destination.split(",")[0].trim())}-itinerary.html`;
}

/** "Thu, Aug 20" (formatDateWithWeekday's own shape) -> "Thu 20": the short label the trip line's
 *  station wears. Derived from formatDateWithWeekday rather than re-parsing the ISO date, so this
 *  still routes through format.ts for the actual date math. */
function pluralStops(count: number): string {
  return `${count} stop${count === 1 ? "" : "s"}`;
}

/** The four values `Stop.category` is declared with. An itinerary saved before the field existed —
 *  or a model answer that invented a fifth — falls through to the neutral `other`. */
const STOP_CATEGORIES: readonly string[] = ["food", "entry", "transit", "other"];

function renderStop(stop: Stop, dayIndex: number, stopIndex: number): string {
  const why = stop.why ? `<p class="swhy">${escapeHtml(stop.why)}</p>` : "";
  const note = stop.note ? `<p class="snote">${escapeHtml(stop.note)}</p>` : "";
  const meta = [stop.durationLabel ? escapeHtml(stop.durationLabel) : null, costLabel(stop.cost)]
    .filter(Boolean)
    .join(" · ");
  const category = STOP_CATEGORIES.includes(stop.category) ? stop.category : "other";
  return `<li class="stop" data-stop="${dayIndex}:${stopIndex}">
          <b class="snode" data-cat="${category}">${stopIndex + 1}</b>
          <span class="time">${stop.time ? escapeHtml(stop.time) : ""}</span>
          <span>
            <span class="sname">${escapeHtml(stop.name)}</span>
            <span class="smeta">${meta}</span>
            ${why}
            ${note}
          </span>
        </li>`;
}

function renderLeg(leg: { mode: string; minutes: number; distanceKm: number }): string {
  // Not a `switch`, and not exhaustive over `TransportMode` — `leg.mode` is a plain string here
  // because the export reads legs it did not build. A mode with no case falls through to its own
  // name and the transit icon, which is the honest default; `"bike"` gets a real case because
  // labelling a cycle leg with a tram is a straightforwardly wrong picture.
  const modeLabel = leg.mode === "transit" ? "tram" : leg.mode;
  const icon = leg.mode === "walk" ? WALK_ICON : leg.mode === "bike" ? BIKE_ICON : TRANSIT_ICON;
  return `<li class="leg"><span></span>
          <span class="legpill">
            ${icon}
            ${leg.minutes} min ${escapeHtml(modeLabel)} · ${leg.distanceKm} km
          </span>
        </li>`;
}

function renderRoute(stops: Stop[], dayIndex: number): string {
  const legs = dayLegs(stops);
  const parts: string[] = [];
  stops.forEach((stop, i) => {
    parts.push(renderStop(stop, dayIndex, i));
    const leg = legs[i];
    if (leg) parts.push(renderLeg(leg));
  });
  return `<ol class="route">
        ${parts.join("\n        ")}
      </ol>`;
}

function renderDay(day: DayPlan, index: number): string {
  const stopCount = pluralStops(day.stops.length);
  const total = dayPlanned(day);
  const summary = day.summary ? `<p class="dsum">${escapeHtml(stripEmoji(day.summary))}</p>` : "";
  const lodging = day.lodging
    ? `<div class="stay">
        ${STAY_ICON}
        <span>
          <b>${escapeHtml(day.lodging.name)}</b>
          <span>${[costLabel(day.lodging.cost), day.lodging.note ? escapeHtml(day.lodging.note) : null].filter(Boolean).join(" · ")}</span>
        </span>
      </div>`
    : "";
  return `<details class="day" data-date="${escapeHtml(day.date)}">
    <summary>
      <span class="dnum">${index + 1}</span>
      <span><span class="dtitle">${escapeHtml(dayHeading(day, index))}</span>
      <span class="ddate">${escapeHtml(formatDateWithWeekday(day.date))} · ${stopCount} · ${costLabel(total)}</span></span>
      ${CHEV_ICON}
    </summary>

    <div class="dbody">
      <span class="wx">
        ${WEATHER_ICON}
        ${escapeHtml(day.weather)}
      </span>
      ${summary}

      ${renderRoute(day.stops, index)}

      ${lodging}

      <p class="dtotal"><span>Day ${index + 1} planned</span><b>${costLabel(total)}</b></p>
    </div>
  </details>`;
}

export function renderItineraryHtml(trip: Trip, assets: ExportAssets): string {
  const days = trip.itinerary.days;
  const cityName = trip.destination.split(",")[0].trim();
  const totalStops = days.reduce((sum, d) => sum + d.stops.length, 0);
  const tripTotal = days.reduce((sum, d) => sum + dayPlanned(d), 0);

  // One rule per face. Both are optional and independently so: a missing display face drops the
  // destination to the text face rather than to the system stack, which is the better fallback.
  const fontFace =
    (assets.fontDataUri
      ? `@font-face{font-family:Switzer;src:url(${assets.fontDataUri}) format('woff2');font-weight:100 900;font-display:swap}\n`
      : "") +
    (assets.displayFontDataUri
      ? `@font-face{font-family:Melodrama;src:url(${assets.displayFontDataUri}) format('woff2');font-weight:300 700;font-display:swap}\n`
      : "");

  // Both are omitted entirely without a map, rather than shipping dead CSS and a script that
  // would find no `.map` to bind to.
  const mapSection = assets.map ? `\n${renderMapSection(assets.map)}\n` : "";
  const mapCss = assets.map ? MAP_CSS : "";
  const mapRuntime = assets.map ? `\n${MAP_RUNTIME}` : "";

  const dayList = days.map((day, i) => renderDay(day, i)).join("\n\n  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(cityName)} — TripMate</title>
<style>
${fontFace}${CSS}${mapCss}
</style>
</head>
<body data-trip="${escapeHtml(trip.id)}">
${DIRECTION_CONTRACT}

<div class="topbar">
<div class="mast">
  <h1>${escapeHtml(cityName)}</h1>
  <div class="trmeta">
  <p class="dates">${escapeHtml(formatDateRange(trip.startDate, trip.endDate))} · ${days.length} day${days.length === 1 ? "" : "s"} · ${pluralStops(totalStops)}</p>
  <p class="budget"><b>${costLabel(tripTotal)}</b> planned of a ${formatMoney(trip.budget)} budget</p>
  </div>
</div>
${mapSection}
</div>

<section class="days">

  ${dayList}

</section>

${RUNTIME}${mapRuntime}
</body>
</html>`;
}
