"use client";

import { useId, useRef, useState } from "react";
import DestinationSearch from "@/components/DestinationSearch";
import type { PlanPrefill } from "./planExamples";

/** Local date as `YYYY-MM-DD`. `sv-SE` gives ISO shape from a *local* clock, which is what the
 *  native date input compares `min` against — `toISOString()` would hand a traveller west of
 *  Greenwich yesterday's date and reject today. Mirrors `todayISO` in HomeView. */
const todayISO = () => new Date().toLocaleDateString("sv-SE");

/**
 * The hero's entry capsule: where and when, and nothing else.
 *
 * This is the first viewport doing work instead of posing. The hero it replaces carried a single
 * word and a "Plan a trip" button that opened a form on another screen — a composition read off an
 * external reference, where the button is the entire ask. Here the ask is three fields, answered
 * in place, and the plan step opens already filled in.
 *
 * **Budget is deliberately absent.** It is the field that makes people bounce, it is the one the
 * plan step is actually built to explain, and `HomeView` already treats `budget === 0` as "this
 * field asks rather than answers". Three fields is the shape a traveller expects from a search
 * capsule; four with money in it is a quote form.
 *
 * It owns no state the wizard also owns. It collects, calls `onPlan` once, and unmounts — which is
 * why it needs no lifting, no context and no synchronisation. `startPlanning` already accepted a
 * `PlanPrefill` for the featured-plan cards; this is the second caller of a path that existed.
 */
export default function HeroSearch({ onPlan }: { onPlan: (prefill?: PlanPrefill) => void }) {
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const startId = useId();
  const endId = useId();

  // A destination is the only genuinely required answer: the plan step can and does ask for dates
  // again, but it cannot open on a place it was not given. Submitting with dates blank is allowed
  // and normal — `startPlanning` sets what it is handed and leaves the rest.
  const canSubmit = destination.trim().length > 0;
  const destinationRef = useRef<HTMLDivElement>(null);

  return (
    <form
      className="hero-search hero-rise pointer-events-auto mt-8 w-full max-w-[46rem]"
      style={{ animationDelay: "300ms" }}
      onSubmit={(e) => {
        e.preventDefault();
        // Validation lands here rather than on the button's appearance. The button is the page's
        // primary action and ships at full strength (see `.hero-search-go`), so an empty submit has
        // to say something — it moves focus to the field that is missing instead of doing nothing.
        if (!canSubmit) {
          destinationRef.current?.querySelector("input")?.focus();
          return;
        }
        onPlan({ destination: destination.trim(), startDate, endDate });
      }}
    >
      <div className="hero-search-shell">
        <div className="hero-search-cell hero-search-cell--wide" ref={destinationRef}>
          <span className="hero-search-label">Where</span>
          {/* `variant="bare"` because this cell already draws the box. Controlled, so a typed-but-
              never-selected destination still submits — the same reason the plan step controls it.

              `onPick` is deliberately empty. In controlled mode `DestinationSearch.pick()` already
              routes the chosen suggestion through `setQuery(suggestionLabel(s))`, which calls
              `onQueryChange` — so the destination is set before this fires, and writing it again
              here would be a second, differently-formatted source of truth for the same string.
              The prop is required because the plan step needs the coordinates to fly the globe;
              this capsule has no globe to fly, so it wants the side effect and not the payload. */}
          <DestinationSearch
            variant="bare"
            className="hero-search-field"
            // Short enough to fit the cell at every width. The component's own default
            // ("Search cities and countries") clipped mid-word to "Search cities and countrie" at
            // 1440 and 2560 — the copy was shortened rather than the cell widened, because the cell
            // is sized by the capsule's three-way split and widening it would take the room from
            // the dates. "Anywhere you like" was the other obvious phrase and is already taken:
            // HomeView uses it for the *arrival point* field two screens later.
            placeholder="Where to?"
            ariaLabel="Destination"
            value={destination}
            onQueryChange={setDestination}
            onPick={() => {}}
          />
        </div>

        {/* `data-empty` drives the cell's own placeholder copy and hides the UA's `mm/dd/yyyy`.
            An empty native date input paints that string itself, in the platform's colour, next to
            a platform calendar glyph — two OS widgets sitting in the one light surface this system
            spends a rule on. See `.hero-search-cell[data-empty]` in globals.css. */}
        <div
          className="hero-search-cell hero-search-cell--date"
          data-empty={startDate === ""}
          data-empty-label="Add dates"
        >
          <label className="hero-search-label" htmlFor={startId}>
            Arriving
          </label>
          <input
            id={startId}
            type="date"
            className="hero-search-field"
            value={startDate}
            min={todayISO()}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <CalendarGlyph />
        </div>

        <div
          className="hero-search-cell hero-search-cell--date"
          data-empty={endDate === ""}
          data-empty-label="Add dates"
        >
          <label className="hero-search-label" htmlFor={endId}>
            Leaving
          </label>
          <input
            id={endId}
            type="date"
            className="hero-search-field"
            value={endDate}
            // Bound to the arrival rather than to today, so the picker cannot produce a range that
            // ends before it starts. Falls back to today while arrival is still blank.
            min={startDate || todayISO()}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <CalendarGlyph />
        </div>

        {/* `aria-disabled`, never `disabled`. A `disabled` button leaves the tab order entirely,
            which is the wrong answer for the primary action on the page, and it also greyed out the
            one jade mark in the first viewport before the visitor had done anything. */}
        <button type="submit" className="hero-search-go" aria-disabled={!canSubmit}>
          Plan it
        </button>
      </div>
    </form>
  );
}

/** Drawn at the app's own lucide stroke weight, replacing the platform's calendar indicator — a UA
 *  glyph renders in whatever the platform decides and cannot take a stroke weight, which is the
 *  same reason `SectionOpener` draws its asterisk rather than typing one. */
function CalendarGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="hero-search-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
