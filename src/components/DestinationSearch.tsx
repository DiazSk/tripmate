"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { GeoSuggestion, suggestDestinations, suggestionLabel } from "@/lib/weather";
import { devLabel } from "@/lib/devInspector";

const DEBOUNCE_MS = 300;

/**
 * Embedded city/country typeahead — currently the plan-step's own Destination field, its one
 * call site. An older exploratory search above ItineraryCard's day-tab row used to be a second
 * (self-managed, uncontrolled) one; that usage is gone from `ItineraryCard.tsx`, but the
 * uncontrolled mode below is left in rather than stripped, since what a pick *does* (set a
 * destination field, fly the camera, both, neither) is entirely up to `onPick` at the call site —
 * this stays usable in a future place that doesn't have a destination form at all.
 */
export default function DestinationSearch({
  onPick,
  placeholder = "Search cities and countries",
  ariaLabel = "Search cities and countries",
  className,
  variant = "panel",
  value,
  onQueryChange,
  onBlur,
}: {
  onPick: (suggestion: GeoSuggestion) => void;
  placeholder?: string;
  /** The field's accessible name, and separate from `placeholder` on purpose. This used to be
   *  `aria-label={placeholder}`, which meant the plan step's required Destination field announced
   *  itself as "Kyoto, Japan" — an example value read out as the name of the thing, with the
   *  visible "DESTINATION" label overridden and no way left to recover what the field was for. */
  ariaLabel?: string;
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
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const activeId =
    activeIndex >= 0 && suggestions[activeIndex] ? `${listId}-${activeIndex}` : undefined;

  // The geocoder returns up to 5 rows at ~52px in a 240px box, so the last one sits below the
  // fold. Without this, arrowing onto it moved a highlight the traveler could not see.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

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

  // Bound to the root rather than the input, so it still fires once focus has moved off the input
  // and onto the list. Chrome puts the dropdown in the tab order on its own — `max-h-60
  // overflow-y-auto` makes it a scrollable region, and scrollable regions are focusable so they
  // can be scrolled by keyboard — and with the handler on the input, Escape did nothing from
  // there. The only way out of an open list was a mouse click somewhere else, which is a keyboard
  // trap in a required field. Key events from the input still bubble here, so this fires exactly
  // once either way.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Enter's only job here is "confirm a suggestion" — never "submit an enclosing form".
    // Always swallowed, even with the dropdown closed/empty, so it can't fall through to a
    // parent <form>'s submit.
    //
    // The older note here reasoned that this box "isn't necessarily the form's own destination
    // field (it may sit alongside one, as it does on the plan step)". That stopped being true:
    // on the plan step this *is* the Destination cell's control. The swallow still stands on the
    // first reason alone — the exploratory search above ItineraryCard's day tabs has no form to
    // submit and must not gain one — but the justification needed correcting.
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

  // **The "bare" branch inherits its colour; it does not choose one.** It used to hardcode
  // `text-foreground` with a `placeholder:text-white/65` — correct for the one caller it had, a
  // dark glass trough on the plan step, and invisible the moment a second caller appeared with a
  // light ground. The hero's entry capsule is a near-white pill, and this field rendered as warm
  // off-white ink on it: a search box you could not see you were typing into.
  //
  // `text-current` and `placeholder:text-current` take whatever `color` the host cell computes, so
  // the plan step still gets `--foreground` by inheritance from `body` and the capsule gets its own
  // dark ink, with no branch here for either. `bare` means "the container styles me", and colour is
  // part of that bargain. The placeholder rides the same colour at half strength rather than at a
  // fixed white alpha, so its contrast tracks the ground instead of assuming one.
  const inputClassName =
    variant === "bare"
      ? "w-full bg-transparent pl-6 text-base font-medium text-current outline-none placeholder:font-normal placeholder:text-current placeholder:opacity-50"
      : // Focus is the accent ring, matching every other field in the app. This branch used to
        // focus to `#00F2FE` with a cyan glow — a leftover from the palette that predates "The
        // Lit Cockpit", and a direct contradiction of the One Accent Rule, which names focus
        // rings as amber. Nothing reaches this branch today (the one call site passes
        // `variant="bare"`), but "panel" is the default, so the next caller who omits the prop
        // would have inherited the old world.
        // `text-base`, not the 0.95rem this carried: that is 15.2px, and DESIGN.md's own rule is
        // that anything typed into stays at 16px or iOS Safari zooms the whole viewport on focus.
        // It is also the documented `field` type step, so the ramp and the bug agree here.
        "w-full rounded-xl border border-white/10 bg-white/[0.06] py-3 pr-4 pl-11 text-base text-white transition-colors duration-200 placeholder:text-white/55 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none";
  const iconClassName =
    variant === "bare"
      // Same bargain as the input above: `currentColor` at reduced opacity rather than `--muted`,
      // which is authored as warm-off-white-on-dark and disappears on a light ground.
      ? "pointer-events-none absolute top-1/2 left-0 h-3.5 w-3.5 -translate-y-1/2 text-current opacity-55"
      : "pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-white/45";

  return (
    <div
      ref={rootRef}
      onKeyDown={handleKeyDown}
      className={`relative w-full ${className ?? ""}`}
      {...devLabel("DestinationSearch")}
    >
      <Search className={iconClassName} strokeWidth={2} />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClassName}
      />

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="geo-suggest-dropdown absolute inset-x-0 top-full mt-1.5 max-h-60 overflow-y-auto py-1"
        >
          {/* `role="option"` on the row itself, not a <button> inside it. A button is a focusable
              tab stop, so five suggestions used to insert five stops between the field and the
              next one, and `listbox` may only contain `option` — the roles the browser reported
              did not match the widget the ARIA claimed. Selection moves through
              `aria-activedescendant` while real focus stays in the input, which is how a combobox
              is supposed to work. `onMouseDown` with `preventDefault`, not `onClick`: the input's
              blur lands first and would tear the list down before the click resolved. */}
          {suggestions.map((s, i) => (
            <li
              key={`${s.name}-${s.lat}-${s.lon}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                i === activeIndex ? "bg-white/10" : "hover:bg-white/10"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{s.name}</span>
                {/* `text-muted`, not the hardcoded `#94A3B8` this was — `.geo-suggest-dropdown`
                    now redefines `--foreground`/`--muted` for its own subtree the same way
                    `.glass-itinerary` does, so the semantic classes resolve correctly here
                    regardless of what this dropdown happens to be floating over. */}
                {(s.admin1 || s.country) && (
                  <span className="block truncate text-xs text-muted">
                    {[s.admin1, s.country].filter(Boolean).join(", ")}
                  </span>
                )}
              </span>
              {s.countryCode && (
                <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-white/60 uppercase">
                  {s.countryCode}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
