"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./PolarLanding.css";
import "./WritingThePlan.css";
import Meridian from "@/components/Meridian";
import { formatMoney } from "@/lib/format";
import { STEP_GROUPS, TYPICAL_WAIT_PHRASE, generationProgress, isStepTerminal, stepGroupState, type StageProgress } from "@/lib/generationStages";
import { useMapCamera } from "@/lib/mapCamera";
import { dayColorToken } from "@/lib/mapRoute";
import { meriForGeneration } from "@/lib/meri";
import { dayOfLabel, daysLabel, tripLength, writtenDays } from "@/lib/planProgress";
import { monumentEms } from "@/lib/monumentFit";
import type { Itinerary, RawFetch } from "@/lib/types";
import { useAnchoredToMap } from "@/lib/useAnchoredToMap";

/**
 * The live map while a plan is written, as the canvas design "Live map, writing the plan · C
 * Monument" draws it: the landing's hero with the map where its photograph was. The night lens takes
 * the basemap down (HomeView turns it on with the run), the fact rotates as the hero's standfirst in
 * the display face, the days light up as the stream reaches them, each new stop arrives as a glass
 * card beside its own pin, and the city is set as the monument along the foot under one hairline of
 * instruments. Replaces `GenerationScreen`'s foot band for a generate; a refine keeps the band.
 *
 * Everything on it is the stream's: the four step groups from `stage` frames, the facts from
 * `buildDestinationFacts`, the days and stops from the draft as `sketch` and `stop` frames land, the
 * forecast from the trip-fetch bundle. Portalled to <body> under the navbar (z-20), passing every
 * pointer through to the map except on Cancel.
 */

/** ~150s of waiting at this interval is ~21 facts, under `destinationFacts`' cap. */
const FACT_INTERVAL_MS = 7000;
/** Cancel waits this long, as it did on the band: a stray click in the first seconds is not a decision. */
const CANCEL_AFTER_MS = 10_000;

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
}
function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60);
  return `${d}º ${String(m).padStart(2, "0")}’ ${String(s).padStart(2, "0")}” ${v >= 0 ? pos : neg}`;
}
/** "14:00" → "2:00 PM"; anything else (a model's "Late morning") is shown as written. */
function time12(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

export default function WritingThePlan({
  stages,
  facts,
  destination,
  coords,
  dateRange,
  tripDays,
  tierName,
  budget,
  rawFetch,
  draft,
  onCancel,
}: {
  stages: StageProgress[];
  facts: string[];
  destination: string;
  coords: { lat: number; lon: number } | null;
  dateRange: string | null;
  tripDays: number | null;
  tierName: string | null;
  budget: number;
  rawFetch: RawFetch | null;
  /** The half-written plan from the stream, or null before its first frame. */
  draft: Itinerary | null;
  onCancel: () => void;
}) {
  const bar = useRef<HTMLSpanElement>(null);
  const lede = useRef<HTMLElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [factIndex, setFactIndex] = useState(0);
  const [cancelReady, setCancelReady] = useState(false);
  const [clearLeft, setClearLeft] = useState(0);
  const { rendererRef, ready, setViewPadding } = useMapCamera();
  const strip = useRef<HTMLDivElement>(null);

  const city = destination.split(",")[0]?.trim() || destination.trim() || "Your trip";
  const complete = STEP_GROUPS.every((s) => isStepTerminal(stepGroupState(s, stages)));
  const streaming = draft?.days.some((d) => d.stops.length > 0) ?? false;
  const active = STEP_GROUPS.find((s) => stepGroupState(s, stages) === "active") ?? null;

  // Map chrome stands down while this is up (globals.css, `data-writing-plan`): the Map / Satellite
  // switch, the search and the zoom stack sit exactly where the standfirst and the monument go.
  useEffect(() => {
    document.documentElement.dataset.writingPlan = "true";
    return () => {
      delete document.documentElement.dataset.writingPlan;
    };
  }, []);
  // The bar eases toward the next stage between frames (GenerationScreen's rule), written straight
  // to the element so ten updates a second do not re-render the page.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const start = Date.now();
    let previous = 0;
    const tick = () => {
      previous = generationProgress(stages, Date.now() - start, previous);
      el.style.transform = `scaleX(${previous})`;
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [stages]);
  useEffect(() => {
    const id = setTimeout(() => setCancelReady(true), CANCEL_AFTER_MS);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (facts.length < 2) return;
    const id = setInterval(() => setFactIndex((i) => (i + 1) % facts.length), FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [facts.length]);
  // The standfirst column and the instruments are screen furniture the map must frame around: the
  // camera centres each day in the area right of the column and above the strip (camera padding),
  // and the arrival card keeps clear of the column. Off again on the way out, so the result view's
  // own framing is untouched. Phones have no column beside the map, so only the foot is cleared.
  useLayoutEffect(() => {
    const el = lede.current;
    const foot = strip.current;
    if (!el || !foot) return;
    const measure = () => {
      const right = Math.round(el.getBoundingClientRect().right + 16);
      const wide = window.innerWidth > 760;
      setClearLeft(wide ? right : 0);
      setViewPadding({ left: wide ? right : 0, bottom: Math.max(0, Math.round(window.innerHeight - foot.getBoundingClientRect().top)) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(foot);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      setViewPadding(null);
    };
  }, [setViewPadding]);

  // The trip's length is its dates', not however many days the stream has reached: rows for the days
  // still to come are ghosts, so the list and "Day k of N" agree with the header from the first frame.
  const total = tripLength(tripDays, draft?.days.length ?? 0);
  const days = Array.from({ length: total }, (_, i) => draft?.days[i] ?? null);
  const latestDay = writtenDays(draft?.days) - 1;
  const latest = latestDay >= 0 ? draft!.days[latestDay].stops[draft!.days[latestDay].stops.length - 1] : null;
  const point = latest ? { lat: latest.lat, lng: latest.lng } : null;
  useAnchoredToMap(card, rendererRef, point, ready, clearLeft);

  const weather = rawFetch?.weather.available ? rawFetch.weather.days : [];
  const calendar = rawFetch?.dateContext.days ?? [];
  const forecast = weather.slice(0, 3).map((d, i) => `${dayLabel(calendar[i]?.date ?? d.date)} ${Math.round(d.tempMinC)} to ${Math.round(d.tempMaxC)}º`);
  const summary = [dateRange, tripDays ? daysLabel(tripDays) : null, tierName, budget > 0 ? formatMoney(budget) : null].filter(Boolean).join(" · ");
  const now = complete
    ? "Every day written"
    : latest
      ? `${dayOfLabel(latestDay + 1, total)}${days[latestDay]?.theme ? ` · ${days[latestDay]!.theme}` : ""}`
      : draft?.days.some((d) => d.theme)
        ? "The days are sketched"
        : (active?.label ?? "Starting");
  const word = city.toUpperCase();

  return createPortal(
    <div className="tm wtp" data-appearance="dark">
      <p role="status" aria-live="polite" className="sr-only">
        {complete ? "Your itinerary is ready." : `Building your ${city} itinerary: ${active?.label ?? "starting"}.`}
      </p>
      <div className="wtp-vignette" aria-hidden />

      <section ref={lede} className="wtp-lede">
        <div className="flex items-center gap-3">
          <Meridian size={36} state={meriForGeneration({ complete, streaming })} />
          <div>
            <p className="tm-eyebrow text-[0.7em]">{complete ? "Ready" : `Planning ${city}`}</p>
            {summary && (
              <p className="tm-caption tm-on-dark-2" style={{ fontVariantNumeric: "tabular-nums" }}>
                {summary}
              </p>
            )}
          </div>
        </div>
        <p key={factIndex} className="wtp-fact">
          {facts[factIndex] ?? `Reading everything we can find about ${city}.`}
        </p>
        {coords && <p className="tm-coord tm-on-dark-2">[ {dms(coords.lat, "N", "S")}, {dms(coords.lon, "E", "W")} ]</p>}
        <ol className="wtp-days" aria-label="The days">
          {days.map((d, i) => (
            <li key={i} className={`wtp-day${i === latestDay ? " is-now" : ""}${d?.stops.length ? " has" : ""}`}>
              <span className="wtp-day-n" style={{ color: `var(${dayColorToken(i)})` }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              {/* The sketch's theme; without one (the sketch call can fail and the plan still streams),
                  where the day starts, so a written day never sits behind a placeholder. */}
              <span className="min-w-0 truncate">{d?.theme ?? (d?.stops[0] ? `From ${d.stops[0].name}` : <span className="wtp-ghost" />)}</span>
              <span className="wtp-day-count" style={{ fontVariantNumeric: "tabular-nums" }}>
                {d?.stops.length || ""}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* A stop arriving, beside its own pin: written to by useAnchoredToMap, never by React. */}
      <div ref={card} className="wtp-arrival" aria-hidden style={{ visibility: "hidden" }}>
        {latest && (
          <div key={`${latestDay}-${latest.name}`} className="wtp-arrival-in">
            <p className="wtp-arrival-day">
              <span className="wtp-arrival-dot" style={{ background: `var(${dayColorToken(latestDay)})` }} />
              Day {latestDay + 1} · {time12(latest.time)}
            </p>
            <p className="wtp-arrival-name">{latest.name}</p>
            {latest.durationLabel && <p className="wtp-arrival-note">{latest.durationLabel}</p>}
          </div>
        )}
      </div>

      <section className="wtp-foot">
        <div ref={strip} className="wtp-strip">
          <div className="wtp-progress">
            <span ref={bar} />
          </div>
          <div className="wtp-strip-row">
            <ol className="wtp-stages">
              {STEP_GROUPS.map((s, i) => {
                const state = stepGroupState(s, stages);
                return (
                  <li key={s.id} className={`is-${state}`}>
                    <span className="wtp-n">{String(i + 1).padStart(2, "0")}</span>
                    {s.label}
                    <span className={`wtp-word${state === "active" ? " is-active" : ""}`}>
                      {state === "done" ? "Done" : state === "active" ? "Now" : state === "failed" ? "Not run" : "Waiting"}
                    </span>
                  </li>
                );
              })}
            </ol>
            {forecast.length > 0 && (
              <p className="wtp-forecast" style={{ fontVariantNumeric: "tabular-nums" }}>
                {forecast.join(" · ")}
                {rawFetch?.weather.historical ? " · same dates last year" : ""}
              </p>
            )}
            {cancelReady ? (
              <button type="button" className="wtp-cancel" onClick={onCancel}>
                Cancel
              </button>
            ) : (
              <span className="tm-caption tm-on-dark-2 wtp-end">Usually about {TYPICAL_WAIT_PHRASE}.</span>
            )}
          </div>
          <p className="tm-caption tm-on-dark-2 wtp-now">{now}</p>
        </div>
        {/* Fitted to the screen's width, so a long name shrinks rather than running off, and set on a
            line box tall enough for Oswald's capitals so the foot of the letters is never cut off. */}
        <p
          className="tm-monument wtp-monument"
          aria-hidden
          style={{ fontSize: `min(calc((100vw - 2 * var(--wd-pad)) / ${monumentEms(word).toFixed(3)}), var(--wtp-monument-vh, 26vh), 15em)` }}
        >
          {word}
        </p>
      </section>
    </div>,
    document.body
  );
}
