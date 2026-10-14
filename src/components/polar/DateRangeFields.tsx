"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MAX_TRIP_DAYS } from "@/lib/tiers";

/**
 * Arriving / Leaving for the landing's footer, with a range calendar of its own rather than the
 * system picker. (The phone app keeps the native picker: it is the better control there.)
 *
 * Dates are `YYYY-MM-DD` strings and every bit of arithmetic is UTC, so no timezone ever rolls a day
 * back (see CLAUDE.md). The rules are the planner's: nothing before today, and at most
 * MAX_TRIP_DAYS inclusive, so the last day you can leave is arrival + MAX_TRIP_DAYS - 1.
 */
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
/** Today in the visitor's own zone, as `YYYY-MM-DD`. */
export const todayISO = () => {
  const n = new Date();
  return iso(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};
const nightsBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(ms(d)).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
/** "Wed 14 Apr 2027". Built from parts: engines disagree on the comma after the weekday. */
export const shortDate = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .formatToParts(new Date(ms(d)))
    .filter((p) => p.type !== "literal")
    .map((p) => p.value)
    .join(" ");
const monthKey = (d: string) => d.slice(0, 7);
const addMonths = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number);
  return iso(Date.UTC(y, m - 1 + n, 1)).slice(0, 7);
};
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

type Range = { start: string; end: string };
type Edge = "start" | "end";

function monthCells(key: string) {
  const first = `${key}-01`;
  const lead = (new Date(ms(first)).getUTCDay() + 6) % 7; // Monday first
  const [y, m] = key.split("-").map(Number);
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array(lead).fill(null), ...Array.from({ length: len }, (_, i) => addDays(first, i))] as (string | null)[];
}

export function DateRangeFields({
  value,
  onChange,
  errors,
}: {
  value: Range;
  onChange: (r: Range) => void;
  errors: Partial<Record<Edge, string>>;
}) {
  const [open, setOpen] = useState<Edge | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const field = (edge: Edge, label: string) => (
    <div className={`tm-fb-field${errors[edge] ? " has-err" : ""}`}>
      <span id={`tm-fb-${edge}-label`}>{label}</span>
      <button
        ref={edge === "start" ? startRef : endRef}
        type="button"
        className={`tm-fb-input tm-fb-date${open === edge ? " is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        aria-labelledby={`tm-fb-${edge}-label tm-fb-${edge}-value`}
        aria-describedby={errors[edge] ? `tm-fb-${edge}-error` : undefined}
        onClick={() => setOpen(open === edge ? null : edge)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1.5 6h13M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span id={`tm-fb-${edge}-value`} className={value[edge] ? "" : "tm-fb-placeholder"}>
          {value[edge] ? shortDate(value[edge]) : "Add date"}
        </span>
      </button>
      {errors[edge] && <em id={`tm-fb-${edge}-error`}>{errors[edge]}</em>}
    </div>
  );
  return (
    <>
      {field("start", "Arriving")}
      {field("end", "Leaving")}
      {open && (
        <RangeCalendar
          anchor={startRef}
          edge={open}
          setEdge={setOpen}
          value={value}
          onChange={onChange}
          onClose={() => {
            const back = open === "start" ? startRef.current : endRef.current;
            setOpen(null);
            back?.focus();
          }}
        />
      )}
    </>
  );
}

function RangeCalendar({
  anchor,
  edge,
  setEdge,
  value,
  onChange,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  edge: Edge;
  setEdge: (e: Edge) => void;
  value: Range;
  onChange: (r: Range) => void;
  onClose: () => void;
}) {
  const [today] = useState(todayISO);
  const panel = useRef<HTMLDivElement>(null);
  const [twoUp, setTwoUp] = useState(() => window.innerWidth >= 760);
  const [view, setView] = useState(() => monthKey((edge === "end" && value.end) || value.start || today));
  const [focus, setFocus] = useState(() => (edge === "end" && value.end) || value.start || today);
  const [hover, setHover] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  // The last day this pick may land on. Leaving is bounded by the trip-length rule.
  const maxEnd = value.start ? addDays(value.start, MAX_TRIP_DAYS - 1) : null;
  const disabledDay = (d: string) => d < today || (edge === "end" && !!maxEnd && d > maxEnd);

  // Fixed to the viewport beside the fields, above them when there is no room below: the footer
  // that holds them clips its overflow, so the calendar lives in a portalled layer.
  useLayoutEffect(() => {
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const wide = window.innerWidth >= 760;
      const width = Math.min(wide ? 664 : 340, window.innerWidth - 24);
      const h = panel.current?.offsetHeight ?? 420;
      // Below the fields if it fits, above them if that fits, otherwise as low as the screen
      // allows: covering the fields' lower edge rather than the page above them.
      const below = r.bottom + 10;
      const above = r.top - h - 10;
      const top = below + h <= window.innerHeight - 8 ? below : above >= 8 ? above : Math.max(8, window.innerHeight - h - 8);
      const left = Math.min(Math.max(12, r.left), window.innerWidth - width - 12);
      setTwoUp(wide);
      setPos({ left, top, width });
    };
    // Measuring the trigger is the reason this is a layout effect: the panel must not paint at a
    // stale position first.
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, twoUp, view]);

  // Close on a press outside (the fields themselves toggle it), and move focus into the grid.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || (t as Element).closest?.(".tm-fb-date")) return;
      onClose();
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [onClose]);
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, view]);

  function pick(d: string) {
    if (disabledDay(d)) return;
    if (edge === "start" || !value.start || d <= value.start) {
      // A new arrival keeps the departure only if it still makes a valid trip.
      const keep = value.end && value.end > d && nightsBetween(d, value.end) < MAX_TRIP_DAYS;
      onChange({ start: d, end: keep ? value.end : "" });
      setEdge("end");
      return;
    }
    onChange({ start: value.start, end: d });
  }

  function onKey(e: KeyboardEvent) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: string | null = null;
    if (e.key in step) next = addDays(focus, step[e.key]);
    else if (e.key === "PageUp" || e.key === "PageDown") {
      const n = e.key === "PageUp" ? -1 : 1;
      const [y, m, day] = focus.split("-").map(Number);
      const len = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
      next = iso(Date.UTC(y, m - 1 + n, Math.min(day, len)));
    } else if (e.key === "Home") next = addDays(focus, -((new Date(ms(focus)).getUTCDay() + 6) % 7));
    else if (e.key === "End") next = addDays(focus, 6 - ((new Date(ms(focus)).getUTCDay() + 6) % 7));
    else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (!next) return;
    e.preventDefault();
    setFocus(next);
    const shown = twoUp ? [view, addMonths(view, 1)] : [view];
    if (!shown.includes(monthKey(next))) setView(next < `${view}-01` ? monthKey(next) : addMonths(monthKey(next), twoUp ? -1 : 0));
  }

  // The range drawn: the chosen one, or while choosing Leaving, the one the pointer would make.
  const end = value.end || (edge === "end" && value.start && hover && hover > value.start && !disabledDay(hover) ? hover : "");
  const inRange = (d: string) => !!value.start && !!end && d > value.start && d < end;
  const nights = value.start && value.end ? nightsBetween(value.start, value.end) : null;
  const months = twoUp ? [view, addMonths(view, 1)] : [view];
  const canPrev = view > monthKey(today);

  // Into a `.tm-layer` (z-index 40) like the sheets: above the navbar, outside the footer's clip,
  // and still inside the landing's tokens.
  return createPortal(
    <div className="tm tm-layer" data-appearance="light">
      <div
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-label={edge === "start" ? "Choose your arrival date" : "Choose your departure date"}
        data-lenis-prevent
        onKeyDown={onKey}
        className="drp"
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, width: pos?.width }}
      >
        <div className="drp-head">
          {(["start", "end"] as Edge[]).map((k) => (
            <button key={k} type="button" className="drp-edge" aria-pressed={edge === k} onClick={() => setEdge(k)} disabled={k === "end" && !value.start}>
              <span className="drp-edge-k">{k === "start" ? "Arriving" : "Leaving"}</span>
              <span className="drp-edge-v">{value[k] ? shortDate(value[k]) : k === "end" && !value.start ? "Pick arrival first" : "Add date"}</span>
            </button>
          ))}
        </div>

        <div className="drp-months">
          <button type="button" className="drp-nav drp-prev" aria-label="Previous month" disabled={!canPrev} onClick={() => setView(addMonths(view, -1))}>
            ‹
          </button>
          <button type="button" className="drp-nav drp-next" aria-label="Next month" onClick={() => setView(addMonths(view, 1))}>
            ›
          </button>
          {months.map((key) => {
            const cells = monthCells(key);
            const title = fmt(`${key}-01`, { month: "long", year: "numeric" });
            return (
              <div key={key} className="drp-month">
                <p className="drp-title" aria-live="polite">
                  {title}
                </p>
                <div role="grid" aria-label={title} className="drp-grid">
                  <div role="row" className="drp-row">
                    {WEEKDAYS.map((w) => (
                      <span key={w} role="columnheader" className="drp-wd">
                        {w}
                      </span>
                    ))}
                  </div>
                  {Array.from({ length: Math.ceil(cells.length / 7) }, (_, r) => cells.slice(r * 7, r * 7 + 7)).map((week, r) => (
                    <div key={r} role="row" className="drp-row">
                      {week.map((d, i) => {
                        if (!d) return <span key={`x${i}`} role="gridcell" className="drp-cell" />;
                        const isStart = d === value.start;
                        const isEnd = d === end;
                        const off = disabledDay(d);
                        const cls = ["drp-cell", inRange(d) && "is-between", isStart && end && "is-start-edge", isEnd && value.start && "is-end-edge"].filter(Boolean).join(" ");
                        const role = isStart ? ", arrival" : isEnd && value.end ? ", departure" : "";
                        return (
                          <span key={d} role="gridcell" className={cls} aria-selected={isStart || (isEnd && !!value.end)}>
                            <button
                              type="button"
                              data-day={d}
                              tabIndex={d === focus ? 0 : -1}
                              disabled={off}
                              aria-label={`${fmt(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${role}${off ? ", unavailable" : ""}`}
                              className={`drp-day${isStart || isEnd ? " is-edge" : ""}${isEnd && !value.end ? " is-preview" : ""}${d === today ? " is-today" : ""}`}
                              onClick={() => {
                                setFocus(d);
                                pick(d);
                              }}
                              onPointerEnter={() => setHover(d)}
                              onFocus={() => setHover(d)}
                            >
                              {Number(d.slice(8))}
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="drp-foot">
          <p className="drp-note" aria-live="polite">
            {nights !== null
              ? `${nights} ${nights === 1 ? "night" : "nights"} · ${nights + 1} days`
              : edge === "end" && maxEnd
                ? `Up to ${MAX_TRIP_DAYS} days, so leave by ${shortDate(maxEnd)}`
                : "Pick the day you arrive"}
          </p>
          <button
            type="button"
            className="drp-clear"
            onClick={() => {
              onChange({ start: "", end: "" });
              setEdge("start");
              setFocus(today);
              setView(monthKey(today));
            }}
            disabled={!value.start}
          >
            Clear
          </button>
          <button type="button" className="drp-done" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
