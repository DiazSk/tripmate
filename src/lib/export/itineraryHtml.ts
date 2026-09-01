import { formatDateRange, formatDateWithWeekday, formatMoney } from "../format";
import { dayPlanned } from "../itinerary";
import type { DayPlan, Stop, Trip } from "../types";
import { costLabel, dayLegs, escapeHtml, slugify, stripEmoji } from "./exportPrimitives";

export interface ExportPhotos {
  cover: string | null;
  /** Index-aligned with `trip.itinerary.days`. A `null` entry renders a plain station node. */
  days: (string | null)[];
}

export interface ExportAssets {
  photos: ExportPhotos;
  /** A `data:font/woff2;base64,...` URI, or null to fall back to the system stack. */
  fontDataUri: string | null;
}

/** THESIS / OWN-WORLD / STORY / FIRST VIEWPORT / FORM / FINISH — see the design spec. Emitted as
 *  the first child of <body> so the contract is auditable in the shipped file, not only here. */
const DIRECTION_CONTRACT = `<!--
  THESIS: A day is a route, not a list. Refuses the itinerary-app default of stacked cards.
  OWN-WORLD: Transit-diagram grammar on #F5F7F7. 8px trunk in TripMate's own #0d2e37; stops are
    interchange nodes; #fb9826 marks only the active stop, per the app's reserved-accent rule.
  STORY: The traveler sees the trip as one line, taps into a day, and reads it like a metro map.
  FIRST VIEWPORT: Destination photo ~44svh, destination at clamp(3.2rem,17vw,5rem)/900, dates and
    budget beneath, then the trip line with one station per day.
  FORM: Route-as-spine, candidate 7 of 7, seed key e57fcfdf.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
    verdict, and DESIGN.md.
-->`;

/** The comp's CSS, verbatim: type scale, trunk weight, node treatment and spacing are the design
 *  authority (.impeccable/comps/comp-b-linemap.html), not re-derived here. The one addition the
 *  comp doesn't need to show — a per-day thumbnail sitting where its plain node (`.st i`) would
 *  go — mirrors that node's own size, border and "on" treatment exactly. */
const CSS = `
:root{
  --paper:#F5F7F7; --card:#fff; --ink:#0B2A32; --deep:#0d2e37;
  --muted:#5B7178; --hair:rgba(11,42,50,.14); --accent:#fb9826; --accent-ink:#A85C05;
  --trunk:8px;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{
  background:var(--paper); color:var(--ink);
  font-family:Archivo,ui-sans-serif,system-ui,sans-serif;
  font-size:.9375rem; line-height:1.6; letter-spacing:-.04em;
  -webkit-font-smoothing:antialiased;
}
/* ---------- cover ---------- */
.cover{position:relative;height:44svh;min-height:250px;overflow:hidden}
.cover img{width:100%;height:100%;object-fit:cover;object-position:50% 45%}
.mast{padding:24px 22px 0}
h1{font-size:clamp(3.2rem,17vw,5rem);font-weight:900;line-height:.88;letter-spacing:-.078em}
.dates{margin-top:12px;font-size:.9375rem;font-weight:500;color:var(--muted)}
.budget{margin-top:4px;font-size:.9375rem;font-weight:500;color:var(--muted)}
.budget b{color:var(--ink);font-weight:600}

/* ---------- the trip line (all days as stations on one line) ---------- */
.tripline{margin:30px 0 6px;padding:0 22px 16px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.tl{position:relative;display:flex;min-width:max-content;padding-top:26px}
.tl::before{content:"";position:absolute;left:14px;right:14px;top:32px;height:var(--trunk);
  background:var(--deep);border-radius:999px}
.savenote{margin:0 22px 6px;font-size:.75rem;font-weight:500;color:var(--muted)}
.st{position:relative;width:76px;flex:none;display:flex;flex-direction:column;align-items:center}
.st i{width:17px;height:17px;border-radius:50%;background:var(--card);
  border:4px solid var(--deep);position:relative;z-index:1;margin-top:1.5px}
.st img{width:17px;height:17px;border-radius:50%;object-fit:cover;background:var(--card);
  border:4px solid var(--deep);position:relative;z-index:1;margin-top:1.5px}
.st.on i,.st.on img{border-color:var(--accent-ink);background:var(--accent);
  box-shadow:0 0 0 5px rgba(251,152,38,.22)}
.st b{margin-top:11px;font-size:1.0625rem;font-weight:700;letter-spacing:-.06em;line-height:1}
.st span{margin-top:4px;font-size:.6875rem;font-weight:600;letter-spacing:-.03em;color:var(--muted)}
.st.on b{color:var(--accent-ink)}

/* ---------- day index ---------- */
.days{padding:14px 0 48px}
.day{border-top:1px solid var(--hair);background:var(--paper)}
.day>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:34px 1fr 18px;
  gap:14px;align-items:center;padding:16px 22px}
.day>summary::-webkit-details-marker{display:none}
.dnum{width:30px;height:30px;border-radius:50%;border:3px solid var(--deep);background:var(--card);
  display:grid;place-items:center;font-size:.8125rem;font-weight:700;letter-spacing:-.04em}
.day[open] .dnum{background:var(--accent);border-color:var(--accent-ink)}
.dtitle{font-size:1rem;font-weight:600;letter-spacing:-.045em;line-height:1.25}
.ddate{display:block;margin-top:2px;font-size:.8125rem;font-weight:400;color:var(--muted)}
.chev{width:16px;height:16px;stroke:var(--muted);stroke-width:2.2;fill:none;transition:transform .18s}
.day[open] .chev{transform:rotate(90deg)}

/* ---------- day body ---------- */
.dbody{padding:0 22px 32px}
.wx{display:inline-flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--hair);
  border-radius:999px;padding:6px 13px 6px 10px;font-size:.75rem;font-weight:600;
  letter-spacing:-.045em;color:var(--muted)}
.wx svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8}
.dsum{margin-top:12px;font-size:.9375rem;color:var(--muted);line-height:1.55}

/* ---------- the day's own line ---------- */
.route{list-style:none;margin-top:24px;position:relative;padding-left:0}
.route::before{content:"";position:absolute;left:64px;top:9px;bottom:34px;width:var(--trunk);
  background:var(--deep);border-radius:999px;transform:translateX(-50%)}
.stop{position:relative;display:grid;grid-template-columns:44px 1fr;gap:34px;padding-bottom:2px}
.time{font-size:.8125rem;font-weight:700;letter-spacing:-.05em;color:var(--muted);
  text-align:right;padding-top:2px;font-variant-numeric:tabular-nums}
.stop::before{content:"";position:absolute;left:64px;top:4px;width:16px;height:16px;border-radius:50%;
  background:var(--card);border:4px solid var(--deep);transform:translateX(-50%);z-index:1}
.stop.on::before{background:var(--accent);border-color:var(--accent-ink);
  box-shadow:0 0 0 5px rgba(251,152,38,.2)}
.stop[data-stop]{cursor:pointer}
.stop.done .sname{opacity:.55}
.stop.done::before{background:var(--deep)}
.sname{font-size:1.0625rem;font-weight:700;letter-spacing:-.055em;line-height:1.24}
.smeta{margin-top:4px;font-size:.8125rem;font-weight:500;color:var(--muted)}
.swhy{margin-top:8px;font-size:.875rem;color:var(--ink);opacity:.82;line-height:1.55}
.snote{margin-top:5px;font-size:.875rem;color:var(--muted);line-height:1.55}

/* legs: a label riding the line, the way a metro map labels a section */
.leg{position:relative;display:grid;grid-template-columns:44px 1fr;gap:34px;padding:13px 0 17px}
.legpill{display:inline-flex;align-items:center;gap:7px;background:var(--paper);
  border:1px solid var(--hair);border-radius:999px;padding:4px 11px 4px 9px;
  font-size:.6875rem;font-weight:700;letter-spacing:-.03em;color:var(--muted)}
.legpill svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2}

/* stay + total */
.stay{margin-top:22px;display:flex;gap:11px;align-items:flex-start;background:var(--card);
  border:1px solid var(--hair);border-radius:14px;padding:14px 15px}
.stay svg{width:17px;height:17px;flex:none;margin-top:1px;fill:none;stroke:var(--accent-ink);stroke-width:1.9}
.stay b{display:block;font-size:.9375rem;font-weight:700;letter-spacing:-.05em}
.stay span{display:block;margin-top:3px;font-size:.8125rem;color:var(--muted)}
.dtotal{margin-top:16px;display:flex;justify-content:space-between;align-items:baseline;
  border-top:2px solid var(--deep);padding-top:12px;font-size:.8125rem;font-weight:700;
  letter-spacing:-.045em;color:var(--muted)}
.dtotal b{font-size:1.25rem;font-weight:700;letter-spacing:-.07em;color:var(--ink)}

/* inline spans used as block rows */
.sname,.smeta,.dtitle,.ddate,.stop>span:last-child,.st b,.st span{display:block}
.leg .legpill{justify-self:start}
`;

/**
 * The whole client. It does two things and neither is load-bearing: without it the file is still
 * a complete, readable itinerary, because days are native <details> and check-off is additive.
 *
 * Dates are compared as strings. `new Date("2026-08-20")` parses as UTC midnight and formatting
 * it with local accessors rolls it back a day anywhere west of Greenwich — the trap that has
 * already put a wrong weekday into generated output. Building today's key from local parts and
 * doing a string compare never constructs a Date from the data at all.
 */
const RUNTIME = `<script>
(function(){
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

  var st = document.querySelector('.st[data-date="' + today + '"]');
  if (st) st.classList.add("on");

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
function stationLabel(iso: string): string {
  const full = formatDateWithWeekday(iso);
  const [weekday, monthDay] = full.split(", ");
  const day = (monthDay ?? "").split(" ")[1] ?? monthDay ?? full;
  return `${weekday} ${day}`;
}

function pluralStops(count: number): string {
  return `${count} stop${count === 1 ? "" : "s"}`;
}

function renderStop(stop: Stop, dayIndex: number, stopIndex: number): string {
  const why = stop.why ? `<p class="swhy">${escapeHtml(stop.why)}</p>` : "";
  const note = stop.note ? `<p class="snote">${escapeHtml(stop.note)}</p>` : "";
  const meta = [stop.durationLabel ? escapeHtml(stop.durationLabel) : null, costLabel(stop.cost)]
    .filter(Boolean)
    .join(" · ");
  return `<li class="stop" data-stop="${dayIndex}:${stopIndex}">
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
  const modeLabel = leg.mode === "transit" ? "tram" : leg.mode;
  const icon = leg.mode === "walk" ? WALK_ICON : TRANSIT_ICON;
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

function renderStation(day: DayPlan, index: number, thumb: string | null): string {
  // Decorative: the day number and date label right beside it already carry the meaning.
  const node = thumb ? `<img src="${escapeHtml(thumb)}" alt="">` : "<i></i>";
  return `<div class="st" data-date="${escapeHtml(day.date)}">${node}<b>${index + 1}</b><span>${escapeHtml(stationLabel(day.date))}</span></div>`;
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

  const fontFace = assets.fontDataUri
    ? `@font-face{font-family:Archivo;src:url(${assets.fontDataUri}) format('woff2');font-weight:100 900;font-display:swap}\n`
    : "";

  const cover = assets.photos.cover
    ? `<header class="cover">
  <img src="${escapeHtml(assets.photos.cover)}" alt="${escapeHtml(cityName)}">
</header>`
    : "";

  const tripline = days
    .map((day, i) => renderStation(day, i, assets.photos.days[i] ?? null))
    .join("\n    ");

  const dayList = days.map((day, i) => renderDay(day, i)).join("\n\n  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(cityName)} — TripMate</title>
<style>
${fontFace}${CSS}
</style>
</head>
<body data-trip="${escapeHtml(trip.id)}">
${DIRECTION_CONTRACT}

${cover}

<div class="mast">
  <h1>${escapeHtml(cityName)}</h1>
  <p class="dates">${escapeHtml(formatDateRange(trip.startDate, trip.endDate))} · ${days.length} day${days.length === 1 ? "" : "s"} · ${pluralStops(totalStops)}</p>
  <p class="budget"><b>${costLabel(tripTotal)}</b> planned of a ${formatMoney(trip.budget)} budget</p>
</div>

<nav class="tripline">
  <div class="tl">
    ${tripline}
  </div>
</nav>
<p class="savenote">Ticking a stop is saved on this phone only — it doesn't reach the app.</p>

<section class="days">

  ${dayList}

</section>

${RUNTIME}
</body>
</html>`;
}
