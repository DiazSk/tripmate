"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMapCamera } from "@/lib/mapCamera";
import { usePlaceSearch } from "@/lib/usePlaceSearch";
import { PLACE_CATEGORIES, type FoundPlace, type PlaceCategory } from "@/lib/placeSearch";
import { searchColourFor } from "@/lib/searchPalette";
import { dayColorToken } from "@/lib/mapRoute";
import { addPlaceToDay } from "@/lib/activeItinerary";
import { DEFAULT_VISIT_MIN, formatClock, parseDurationLabel, planSlot, suggestTimeOfDay } from "@/lib/daySlotting";
import { parseClockTime } from "@/lib/timeOfDay";
import {
  addPlaceAt,
  bestGap,
  DAY_END_MIN,
  DAY_START_MIN,
  fitInGap,
  gapsOfDay,
  REACH_WALK_MIN,
  spanLabel,
  suitsGap,
  walkMinutes,
  type DayGap,
  type GapFit,
} from "@/lib/dayGaps";
import { metresBetween } from "@/lib/peekRange";
import { forgetSearch, recentSearches } from "@/lib/searchHistory";
import { weekdayName } from "@/lib/guardrails";
import { useToast } from "@/lib/toast";
import type { ScreenPoint } from "@/lib/mapRenderer";
import type { Itinerary, Stop } from "@/lib/types";

/**
 * The trip page's map search: Spotlight's command bar with the day drawn inside it (canvas design
 * "Map search · 4 · Spotlight with the day").
 *
 * The gaps between the day's stops are the bar's second row, and pressing one makes it part of the
 * question ("in the 3 PM gap"), so what comes back is what fits there on foot. As the highlight
 * moves down the list, the day shows where that place would go (a ghost in its gap), the map shows
 * where it is (its numbered pin lit and a tag beside it), and the preview beside the list says why.
 *
 * Fitting is `dayGaps.ts`: walking reach, the gap's length, a visit length by kind and the day's
 * weekday against the place's closed days. The hours themselves are shown as written, never
 * evaluated (see that module's header).
 */

const CHIP_LABELS: Record<PlaceCategory, string> = {
  cafe: "Cafés",
  restaurant: "Food",
  bar: "Bars",
  sights: "Sights",
  park: "Parks",
  shop: "Shops",
  hotel: "Hotels",
  place: "Places",
};
const KIND: Record<PlaceCategory, string> = {
  cafe: "Café",
  restaurant: "Restaurant",
  bar: "Bar",
  sights: "Sight",
  park: "Park",
  shop: "Shop",
  hotel: "Hotel",
  place: "Place",
};

/** A highlighted pin the map has to fly to (it is under the bar or off screen) is held this long
 *  against re-searching, so arriving to show it is not taken for the traveller moving the view. */
const SHOW_FLIGHT_HOLD_MS = 3000;

type OkFit = Extract<GapFit, { ok: true }>;
interface Row {
  place: FoundPlace;
  /** Against the chosen gap, when there is one. */
  fit: GapFit | null;
  /** The first gap of the day it fits, for when none is chosen. */
  best: OkFit | null;
  /** The day's nearest stop, for "5 min from Lunch". */
  near: { stop: Stop; minutes: number; metres: number } | null;
}

const shortDistance = (metres: number) =>
  metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;

export default function TripSpotlight({
  itinerary,
  dayIndex,
  onDayChange,
  open,
  onOpenChange,
  onChange,
}: {
  itinerary: Itinerary;
  dayIndex: number;
  onDayChange: (dayIndex: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trip page's commit path, so a place added here saves the way a dragged stop does. */
  onChange: (next: Itinerary) => void;
}) {
  const { engine, globeWanted, rendererRef, ready, showTripRoute } = useMapCamera();
  const toast = useToast();
  // Map only, as the map chrome's search is: the vector map is the surface with venue labels.
  const shown = engine === "maplibre" && globeWanted;
  const isOpen = open && shown;

  const day = itinerary.days[Math.min(dayIndex, itinerary.days.length - 1)];
  const stops = useMemo(() => day?.stops ?? [], [day]);
  const date = day?.date ?? "";
  const gaps = useMemo(() => gapsOfDay(stops), [stops]);
  /** The chosen gap, by its start (a gap's identity within a day). Null is "any time". */
  const [gapStart, setGapStart] = useState<number | null>(null);
  const gap = gaps.find((g) => g.start === gapStart) ?? null;
  /** Places added from here, by result id, so a row keeps saying where it went. */
  const [added, setAdded] = useState<Record<string, { day: number; minutes: number | null; time: string }>>({});

  const search = usePlaceSearch({
    open: isOpen,
    // A gap alone is a question too: what suits that time of day.
    fallbackCategories: gap ? (suitsGap(gap) as PlaceCategory[]) : undefined,
    factsDwellMs: 350,
  });
  const { query, setQuery, categories, setCategories, hasQuery, visiblePlaces, selectedId, setSelectedId, state, history, setHistory, withFacts, holdResearch } = search;

  const rows: Row[] = useMemo(() => {
    const out = visiblePlaces.map((raw) => {
      const place = withFacts(raw);
      let near: Row["near"] = null;
      for (const stop of stops) {
        // A place already added is in the day now; it is not its own neighbour.
        if (stop.name === place.name) continue;
        const metres = metresBetween(stop, place);
        if (!near || metres < near.metres) near = { stop, metres, minutes: walkMinutes(stop, place) };
      }
      return {
        place,
        fit: gap ? fitInGap(place, gap, stops, date) : null,
        best: bestGap(place, gaps, stops, date),
        near,
      };
    });
    // With a gap chosen, what fits it comes first; the rest stay, greyed, with the reason, and what
    // is already in the plan goes last.
    const rank = (r: Row) => (added[r.place.id] ? 0 : r.fit?.ok ? 2 : 1);
    return gap ? [...out].sort((a, b) => rank(b) - rank(a)) : out;
  }, [visiblePlaces, withFacts, stops, gap, gaps, date, added]);

  const cur = rows.find((r) => r.place.id === selectedId) ?? rows[0] ?? null;
  const curIndex = cur ? rows.indexOf(cur) : -1;

  // The pins, numbered in the list's own order.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive()) return;
    renderer.showSearchResults(
      isOpen
        ? rows.map((r, i) => ({
            id: r.place.id,
            lat: r.place.lat,
            lng: r.place.lng,
            name: r.place.name,
            selected: r.place.id === cur?.place.id,
            colorHex: searchColourFor(r.place.category),
            badge: String(i + 1),
          }))
        : []
    );
  }, [rows, cur?.place.id, isOpen, rendererRef, ready]);
  // Closing hands the map back clean.
  useEffect(() => () => rendererRef.current?.showSearchResults([]), [rendererRef]);

  // ⌘K / Ctrl+K opens it from anywhere on the page.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!open) setHistory(recentSearches());
        onOpenChange(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, open, onOpenChange, setHistory]);

  // The tag beside the highlighted pin and the reach ring around the gap's stop, kept on the map by
  // writing their styles each frame the camera moves (the `useAnchoredToMap` discipline: no React
  // render per frame, one preallocated point).
  const tagRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const anchorStop = gap ? stops[gap.before ?? gap.after ?? -1] : undefined;
  const tagPoint = cur ? { lat: cur.place.lat, lng: cur.place.lng } : null;
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive() || !isOpen) return;
    const p: ScreenPoint = { x: 0, y: 0 };
    const q: ScreenPoint = { x: 0, y: 0 };
    // Straight-line metres a REACH_WALK_MIN walk covers, at `dayGaps`' pace and detour.
    const reachM = ((REACH_WALK_MIN / 60) * 4500) / 1.3;
    const place = () => {
      const canvas = renderer.canvas();
      const width = canvas?.clientWidth ?? window.innerWidth;
      const barBottom = barRef.current?.getBoundingClientRect().bottom ?? 0;
      const tag = tagRef.current;
      if (tag) {
        if (!tagPoint) tag.style.visibility = "hidden";
        else {
          renderer.project(tagPoint.lat, tagPoint.lng, 0, p);
          const left = p.x > width - tag.offsetWidth - 48;
          const x = left ? p.x - tag.offsetWidth - 20 : p.x + 20;
          const y = p.y - tag.offsetHeight / 2;
          const hidden = p.y < barBottom + 8 || p.x < 0 || p.x > width;
          tag.style.visibility = hidden ? "hidden" : "visible";
          tag.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
          tag.dataset.side = left ? "left" : "right";
        }
      }
      const ring = ringRef.current;
      if (ring) {
        if (!anchorStop) ring.style.visibility = "hidden";
        else {
          renderer.project(anchorStop.lat, anchorStop.lng, 0, p);
          renderer.project(anchorStop.lat + reachM / 111_320, anchorStop.lng, 0, q);
          const ry = Math.abs(p.y - q.y);
          renderer.project(anchorStop.lat, anchorStop.lng + reachM / (111_320 * Math.cos((anchorStop.lat * Math.PI) / 180)), 0, q);
          const rx = Math.hypot(q.x - p.x, q.y - p.y);
          ring.style.visibility = rx > 4 ? "visible" : "hidden";
          ring.style.transform = `translate3d(${Math.round(p.x - rx)}px, ${Math.round(p.y - ry)}px, 0)`;
          ring.style.width = `${Math.round(rx * 2)}px`;
          ring.style.height = `${Math.round(ry * 2)}px`;
        }
      }
    };
    place();
    return renderer.onFrame(place);
  }, [rendererRef, ready, isOpen, tagPoint?.lat, tagPoint?.lng, anchorStop, cur?.place.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Move the highlight, and bring its pin out from under the bar if that is where it is. */
  const highlight = (row: Row, show: boolean, select = true) => {
    if (select) setSelectedId(row.place.id);
    if (!show) return;
    const renderer = rendererRef.current;
    if (!renderer?.isAlive()) return;
    const p: ScreenPoint = { x: 0, y: 0 };
    renderer.project(row.place.lat, row.place.lng, 0, p);
    const canvas = renderer.canvas();
    const barBottom = barRef.current?.getBoundingClientRect().bottom ?? 0;
    const off = p.y < barBottom + 24 || p.y > (canvas?.clientHeight ?? window.innerHeight) - 24 || p.x < 24 || p.x > (canvas?.clientWidth ?? window.innerWidth) - 24;
    const view = renderer.cameraState();
    if (off && view) {
      // A pan at the current range and heading, not `flyToSearchResult`: that frames a whole
      // neighbourhood and would pull a street-level view back out to the city. The view padding
      // the page sets puts the place below the bar.
      holdResearch(SHOW_FLIGHT_HOLD_MS);
      renderer.flyToPoint({
        lat: row.place.lat,
        lng: row.place.lng,
        rangeM: view.rangeM,
        pitchDeg: view.pitchDeg,
        headingRad: view.headingRad,
        durationS: 0.9,
      });
    }
  };

  // A new set of results whose first place is under the bar is a set nobody can see: bring it out.
  // Keyed on the first id, so moving the highlight or re-sorting for a gap does not fly again.
  const firstId = rows[0]?.place.id;
  useEffect(() => {
    if (!isOpen || !firstId) return;
    const row = rows.find((r) => r.place.id === firstId);
    if (row) highlight(row, true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per result set, see above
  }, [firstId, isOpen]);

  /** Where a row goes: into the chosen gap if it fits, else its best gap, else the usual time for its kind. */
  const when = (row: Row): OkFit | null => (row.fit?.ok ? row.fit : gap ? null : row.best);
  const add = (row: Row) => {
    const { place } = row;
    const at = when(row);
    if (at) {
      const next = addPlaceAt(itinerary, dayIndex, place, at.start);
      onChange(next);
      setAdded((a) => ({ ...a, [place.id]: { day: dayIndex, minutes: at.start, time: formatClock(at.start) } }));
      // The stop just added shortens the gap it went into; keep asking about what is left of it.
      if (gap) setGapStart(gapsOfDay(next.days[dayIndex]?.stops ?? []).find((g) => g.start >= at.start && g.start < gap.end)?.start ?? null);
      toast.show(`${place.name} added`, `Day ${dayIndex + 1} · ${formatClock(at.start)}`);
      return;
    }
    const slot = suggestTimeOfDay(place);
    const plan = planSlot(stops, slot);
    onChange(addPlaceToDay(itinerary, dayIndex, place, slot));
    setAdded((a) => ({ ...a, [place.id]: { day: dayIndex, minutes: parseClockTime(plan.time), time: plan.time } }));
    toast.show(`${place.name} added`, `Day ${dayIndex + 1} · ${plan.time}${plan.tight ? " · tight fit" : ""}`);
  };

  const close = () => {
    onOpenChange(false);
    setSelectedId(null);
  };
  const changeDay = (next: number) => {
    onDayChange(next);
    setGapStart(null);
    // The board is put away while this is open, and it is what draws the day; so the day the search
    // is about is drawn and framed here, the way a day tab on the board does it.
    showTripRoute(
      itinerary.days.map((d, i) => d.stops.map((st) => ({ lat: st.lat, lng: st.lng, name: st.name, day: i, time: st.time }))),
      next,
      false,
      true
    );
  };
  const moveGap = (dir: 1 | -1) => {
    if (!gaps.length) return;
    const i = gap ? gaps.indexOf(gap) : -1;
    setGapStart(gaps[(i + dir + gaps.length) % gaps.length].start);
  };

  if (!shown || !day) return null;

  if (!isOpen) {
    return (
      <button
        type="button"
        className="tm tsl-closed"
        data-appearance="light"
        onClick={() => {
          setHistory(recentSearches());
          onOpenChange(true);
        }}
        aria-label="Search the map for places"
      >
        <SearchIcon />
        <span>Search near this view, or fill a gap in Day {dayIndex + 1}</span>
        <kbd>⌘K</kbd>
      </button>
    );
  }

  const pos = (m: number) => `${((Math.min(DAY_END_MIN, Math.max(DAY_START_MIN, m)) - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)) * 100}%`;
  const width = (a: number, b: number) => `calc(${pos(b)} - ${pos(a)})`;
  const ghost = cur && !added[cur.place.id] ? when(cur) : null;
  const fitting = rows.filter((r) => r.fit?.ok && !added[r.place.id]).length;
  const addedToday = Object.values(added).filter((a) => a.day === dayIndex && a.minutes !== null);
  const curAdded = cur ? added[cur.place.id] : undefined;
  const curWhen = cur ? when(cur) : null;

  return (
    <>
      {/* On the map: the gap's walking reach, and the highlighted place's tag beside its pin. */}
      <div ref={ringRef} className="tsl-reach" aria-hidden="true" style={{ visibility: "hidden" }}>
        <span>{REACH_WALK_MIN} min on foot</span>
      </div>
      {cur && (
        <div
          ref={tagRef}
          className="tm tsl-tag"
          data-appearance="light"
          style={{ ["--c" as string]: searchColourFor(cur.place.category), visibility: "hidden" }}
        >
          <p className="tsl-tag-kind">
            <i className="tsl-swatch" /> {KIND[cur.place.category]}
            {cur.near ? ` · ${cur.near.minutes} min walk` : ""}
          </p>
          <b>{cur.place.name}</b>
          {curAdded ? (
            <em className="tsl-tag-done">
              In your plan · Day {curAdded.day + 1}, {curAdded.time}
            </em>
          ) : curWhen ? (
            <button type="button" onClick={() => add(cur)}>
              Add at {formatClock(curWhen.start)}
            </button>
          ) : cur.fit && !cur.fit.ok ? (
            <em className="tsl-tag-no">{cur.fit.why}</em>
          ) : (
            <button type="button" onClick={() => add(cur)}>
              Add to Day {dayIndex + 1}
            </button>
          )}
        </div>
      )}

      <section ref={barRef} className="tm trip-spotlight" data-appearance="light" aria-label="Search the map">
        <div className="tsl-field">
          <SearchIcon />
          {gap && (
            <button type="button" className="tsl-token is-gap" onClick={() => setGapStart(null)} aria-label="Search any time of the day">
              {formatClock(gap.start)} gap
              <span aria-hidden="true">×</span>
            </button>
          )}
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className="tsl-token"
              style={{ ["--c" as string]: searchColourFor(c) }}
              onClick={() => setCategories(categories.filter((x) => x !== c))}
              aria-label={`Remove ${CHIP_LABELS[c]}`}
            >
              <i className="tsl-swatch" />
              {CHIP_LABELS[c]}
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={gap ? `What fits ${formatClock(gap.start)} to ${formatClock(gap.end)}?` : "Search near this view…"}
            aria-label="Search near this view"
            aria-controls="tsl-results"
            aria-activedescendant={cur ? `tsl-row-${cur.place.id}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const next = rows[Math.max(0, Math.min(rows.length - 1, curIndex + (e.key === "ArrowDown" ? 1 : -1)))];
                if (next) highlight(next, true);
              } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !query) {
                e.preventDefault();
                moveGap(e.key === "ArrowRight" ? 1 : -1);
              } else if (e.key === "Enter" && cur && !added[cur.place.id] && (!gap || cur.fit?.ok)) {
                e.preventDefault();
                add(cur);
              } else if (e.key === "Backspace" && !query && (categories.length || gap)) {
                if (categories.length) setCategories(categories.slice(0, -1));
                else setGapStart(null);
              } else if (e.key === "Escape") {
                if (query || categories.length || gap) {
                  setQuery("");
                  setCategories([]);
                  setGapStart(null);
                } else close();
              }
            }}
          />
          {state === "searching" && <span className="tsl-spin" role="status" aria-label="Searching" />}
          <button type="button" className="tsl-x" onClick={close} aria-label="Close search" title="Close (Esc)">
            <kbd>esc</kbd>
          </button>
        </div>

        {/* The day, inside the bar: stops as blocks, gaps as what you press, the highlighted place as a ghost. */}
        <div className="tsl-day">
          <div className="tsl-day-head">
            <button type="button" aria-label="Previous day" disabled={dayIndex === 0} onClick={() => changeDay(dayIndex - 1)}>
              ‹
            </button>
            <span>
              <b>Day {dayIndex + 1}</b> {date ? weekdayName(date) : ""}
            </span>
            <button type="button" aria-label="Next day" disabled={dayIndex >= itinerary.days.length - 1} onClick={() => changeDay(dayIndex + 1)}>
              ›
            </button>
          </div>
          <div className="tsl-track" role="group" aria-label={`Day ${dayIndex + 1}, 9 AM to 10 PM`}>
            {[12, 15, 18, 21].map((h) => (
              <span key={h} className="tsl-hour" style={{ left: pos(h * 60) }}>
                {h % 12 || 12}
                {h < 12 ? "a" : "p"}
              </span>
            ))}
            {stops.map((s, i) => {
              const start = parseClockTime(s.time);
              if (start === null) return null;
              const end = start + (parseDurationLabel(s.durationLabel) ?? DEFAULT_VISIT_MIN);
              if (end <= DAY_START_MIN || start >= DAY_END_MIN) return null;
              return (
                <span
                  key={`${s.name}-${i}`}
                  className="tsl-stop"
                  style={{ left: pos(start), width: width(start, end), background: `var(${dayColorToken(dayIndex)})` }}
                  title={`${s.time} · ${s.name}`}
                />
              );
            })}
            {gaps.map((g: DayGap) => (
              <button
                key={g.start}
                type="button"
                className={`tsl-gap${gap?.start === g.start ? " is-on" : ""}`}
                style={{ left: pos(g.start), width: width(g.start, g.end) }}
                onClick={() => setGapStart(gap?.start === g.start ? null : g.start)}
                aria-pressed={gap?.start === g.start}
                aria-label={`${formatClock(g.start)} to ${formatClock(g.end)}, ${spanLabel(g.end - g.start)} free`}
              >
                <span>{spanLabel(g.end - g.start)}</span>
              </button>
            ))}
            {addedToday.map((a, i) => (
              // Over the stop it became, in signal: added from here. Spaced as the day spaces it.
              <span key={i} className="tsl-new" style={{ left: pos(a.minutes!), width: width(a.minutes!, a.minutes! + DEFAULT_VISIT_MIN) }} />
            ))}
            {ghost && <span className="tsl-ghost" style={{ left: pos(ghost.start), width: width(ghost.start, ghost.end) }} aria-hidden="true" />}
          </div>
        </div>

        <div className="tsl-cats" role="group" aria-label="Kinds of place">
          {PLACE_CATEGORIES.filter((c) => !categories.includes(c)).map((c) => (
            <button key={c} type="button" style={{ ["--c" as string]: searchColourFor(c) }} onClick={() => setCategories([...categories, c])}>
              <i className="tsl-swatch" />
              {CHIP_LABELS[c]}
              {gap && suitsGap(gap).includes(c) && <em aria-label="suits this time">•</em>}
            </button>
          ))}
        </div>

        {!hasQuery && rows.length === 0 ? (
          <div className="tsl-idle">
            <p>Press a gap in the day, pick a kind of place, or type a name.</p>
            {history.length > 0 && (
              <div className="tsl-recent">
                {history.map((entry) => (
                  <span key={entry}>
                    <button type="button" onClick={() => setQuery(entry)}>
                      {entry}
                    </button>
                    <button type="button" className="tsl-rm" aria-label={`Remove "${entry}" from recent searches`} onClick={() => setHistory(forgetSearch(entry))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : state === "throttled" ? (
          <p className="tsl-alert" role="status">
            Search is busy right now: the free places index rate-limits. Try again in a moment.
          </p>
        ) : state === "searching" && rows.length === 0 ? (
          <ul className="tsl-skel" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <span style={{ width: "1.5em", height: "1.5em", borderRadius: "50%" }} />
                <span style={{ width: `${45 + i * 12}%` }} />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <p className="tsl-none">Nothing of that kind near this view. Pan somewhere else, or clear a filter.</p>
        ) : (
          <>
            <p className="tsl-h">
              {gap
                ? `${fitting} of ${rows.length} fit ${formatClock(gap.start)} to ${formatClock(gap.end)} on foot`
                : `${rows.length} near this view · each placed where it fits Day ${dayIndex + 1}`}
            </p>
            <div className="tsl-split">
              <ul id="tsl-results" className="tsl-list" role="listbox" aria-label="Places">
                {rows.map((r, i) => {
                  const on = cur?.place.id === r.place.id;
                  const done = added[r.place.id];
                  const fits = r.fit ? r.fit.ok : !!r.best;
                  const at = when(r);
                  return (
                    <li
                      key={r.place.id}
                      id={`tsl-row-${r.place.id}`}
                      role="option"
                      aria-selected={on}
                      className={`tsl-row${on ? " is-on" : ""}${fits || done ? "" : " is-out"}`}
                      style={{ ["--c" as string]: searchColourFor(r.place.category) }}
                      onMouseEnter={() => highlight(r, false)}
                      onClick={() => highlight(r, true)}
                    >
                      <span className="tsl-n">{i + 1}</span>
                      <span className="tsl-what">
                        <b>{r.place.name}</b>
                        <span>
                          {KIND[r.place.category]}
                          {r.near ? ` · ${r.near.minutes} min from ${r.near.stop.name}` : r.place.address ? ` · ${r.place.address}` : ""}
                        </span>
                      </span>
                      <span className={`tsl-fit${fits ? "" : " is-no"}`}>
                        {done ? "" : at ? (gap ? `Fits ${formatClock(at.start)}` : `${formatClock(at.gap.start)} gap`) : r.fit && !r.fit.ok ? r.fit.why : "No gap fits"}
                      </span>
                      {done ? (
                        <span className="tsl-done">✓ {done.time}</span>
                      ) : (
                        <button
                          type="button"
                          className="tsl-add"
                          disabled={!!gap && !r.fit?.ok}
                          onClick={(e) => {
                            e.stopPropagation();
                            add(r);
                          }}
                          aria-label={at ? `Add ${r.place.name} at ${formatClock(at.start)}` : `Add ${r.place.name} at the usual time for its kind`}
                        >
                          + {at ? formatClock(at.start) : "Add"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {cur && <Preview row={cur} gap={gap} added={curAdded} at={curWhen} stops={stops} />}
            </div>
          </>
        )}

        <footer className="tsl-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> place · <kbd>←</kbd>
            <kbd>→</kbd> gap · <kbd>↵</kbd> add · <kbd>esc</kbd> back
          </span>
          <span>Walking times over streets · places by {search.provider === "google" ? "Google" : "OpenStreetMap"}</span>
        </footer>
      </section>
    </>
  );
}

/** The quick read on the highlighted place, beside the list: what it is, how far, its hours, and
 *  exactly where it would go in the day and why, or why it would not. */
function Preview({
  row,
  gap,
  added,
  at,
  stops,
}: {
  row: Row;
  gap: DayGap | null;
  added?: { day: number; time: string };
  at: OkFit | null;
  stops: Stop[];
}) {
  const { place } = row;
  const facts: [string, string][] = [];
  if (place.openingHours) facts.push(["Hours", place.openingHours]);
  if (place.cuisine) facts.push(["Serves", place.cuisine.replace(/[_;]/g, " ")]);
  if (place.outdoorSeating) facts.push(["Seating", "Tables outside"]);
  if (place.wheelchair === "yes") facts.push(["Access", "Step-free"]);
  if (place.wheelchair === "limited") facts.push(["Access", "Partly step-free"]);
  if (place.phone) facts.push(["Phone", place.phone]);
  const anchor = at ? stops[at.gap.before ?? at.gap.after ?? -1] : undefined;
  return (
    <aside className="tsl-preview" aria-label={`About ${place.name}`} style={{ ["--c" as string]: searchColourFor(place.category) }}>
      <div className="tsl-pv-head">
        <div className="tsl-art" aria-hidden="true">
          <b>{place.name.slice(0, 1)}</b>
        </div>
        <div>
          <p className="tsl-eyebrow">
            <i className="tsl-swatch" /> {KIND[place.category]}
            {row.near ? ` · ${shortDistance(row.near.metres)}` : ""}
          </p>
          <h3>{place.name}</h3>
          {place.address && <p className="tsl-addr">{place.address}</p>}
        </div>
      </div>
      {facts.length > 0 && (
        <dl>
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="tsl-why">
        {added ? (
          <>
            In your plan: <b>Day {added.day + 1}, {added.time}</b>.
          </>
        ) : at ? (
          <>
            Fits the <b>{formatClock(at.gap.start)} gap</b> at <b>{formatClock(at.start)}</b>
            {anchor ? `, ${at.walkFrom} min on foot from ${anchor.name}` : ""}.
          </>
        ) : row.fit && !row.fit.ok ? (
          <>Won&rsquo;t fit this gap. {row.fit.why}.</>
        ) : gap ? null : (
          <>No gap in the day fits it; Add puts it at the usual time for its kind.</>
        )}
      </p>
      {place.website && (
        <a className="tsl-link" href={place.website} target="_blank" rel="noopener noreferrer">
          Website ↗
        </a>
      )}
    </aside>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
