"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { GeoSuggestion, suggestDestinations, suggestionLabel } from "@/lib/weather";
import { devLabel } from "@/lib/devInspector";

const DEBOUNCE_MS = 300;

/**
 * Embedded city/country typeahead — used as the plan-step's own Destination field, and
 * (self-managed, uncontrolled) above ItineraryCard's day-tab row for exploratory search.
 * What a pick *does* (set a destination field, fly the camera, both, neither) is entirely
 * up to `onPick` at the call site, so this component stays usable in places that don't have
 * a destination form at all.
 */
export default function DestinationSearch({
  onPick,
  placeholder = "Search cities and countries",
  className,
  variant = "panel",
  value,
  onQueryChange,
  onBlur,
}: {
  onPick: (suggestion: GeoSuggestion) => void;
  placeholder?: string;
  className?: string;
  /** "panel" (default): its own bordered/backgrounded glass box, for floating standalone.
   *  "bare": no box of its own — just the icon, text and dropdown, for embedding inside an
   *  already-styled cell (the plan-step Field trough) that provides that look itself. */
  variant?: "panel" | "bare";
  /** Controlled mode: mirrors this as the input's text instead of managing it internally, and
   *  calls `onQueryChange` on every keystroke (not just on a completed pick) — for a caller
   *  (the plan-step Destination field) that needs the raw typed text as the source of truth,
   *  e.g. to still submit a typed-but-not-selected destination. Omit both for the simpler
   *  self-contained mode (ItineraryCard's exploratory search). */
  value?: string;
  onQueryChange?: (value: string) => void;
  onBlur?: () => void;
}) {
  const controlled = value !== undefined;
  const [internalQuery, setInternalQuery] = useState("");
  const query = controlled ? value : internalQuery;
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  function setQuery(next: string) {
    if (!controlled) setInternalQuery(next);
    onQueryChange?.(next);
  }

  function handleChange(next: string) {
    setQuery(next);
    setActiveIndex(-1);
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = next.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    timerRef.current = setTimeout(async () => {
      const results = await suggestDestinations(trimmed);
      if (requestId !== requestIdRef.current) return; // a newer keystroke superseded this request
      setSuggestions(results);
      setOpen(results.length > 0);
    }, DEBOUNCE_MS);
  }

  function pick(s: GeoSuggestion) {
    if (timerRef.current) clearTimeout(timerRef.current);
    requestIdRef.current++; // invalidate any in-flight fetch
    setQuery(suggestionLabel(s));
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
    onPick(s);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter's only job here is "confirm a suggestion" — never "submit an enclosing form",
    // since this search box isn't necessarily the form's own destination field (it may sit
    // alongside one, as it does on the plan step). Always swallowed, even with the dropdown
    // closed/empty, so it can't fall through to a parent <form>'s submit.
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && suggestions.length > 0) pick(suggestions[activeIndex >= 0 ? activeIndex : 0]);
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Click-outside to close, rather than input onBlur — onBlur would fire before a
  // suggestion's onClick and close the list before the click registers.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const inputClassName =
    variant === "bare"
      ? "w-full bg-transparent pl-6 text-base font-medium text-foreground outline-none placeholder:font-normal placeholder:text-white/65"
      : "w-full rounded-xl border border-white/10 bg-white/[0.06] py-3 pr-4 pl-11 text-[0.95rem] text-white outline-none transition-all duration-200 placeholder:text-white/45 focus:border-[#00F2FE] focus:shadow-[0_0_12px_rgba(0,242,254,0.25)]";
  const iconClassName =
    variant === "bare"
      ? "pointer-events-none absolute top-1/2 left-0 h-3.5 w-3.5 -translate-y-1/2 text-muted"
      : "pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-white/45";

  return (
    <div
      ref={rootRef}
      className={`relative w-full ${className ?? ""}`}
      {...devLabel("DestinationSearch")}
    >
      <Search className={iconClassName} strokeWidth={2} />
      <input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={placeholder}
        className={inputClassName}
      />

      {open && (
        <ul className="geo-suggest-dropdown absolute inset-x-0 top-full mt-1.5 max-h-60 overflow-y-auto py-1">
          {suggestions.map((s, i) => (
            <li key={`${s.name}-${s.lat}-${s.lon}-${i}`}>
              <button
                type="button"
                onClick={() => pick(s)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                  i === activeIndex ? "bg-white/10" : "hover:bg-white/10"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{s.name}</span>
                  {(s.admin1 || s.country) && (
                    <span className="block truncate text-xs text-[#94A3B8]">
                      {[s.admin1, s.country].filter(Boolean).join(", ")}
                    </span>
                  )}
                </span>
                {s.countryCode && (
                  <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/60 uppercase">
                    {s.countryCode}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
