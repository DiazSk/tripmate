"use client";

import { useEffect, useId, useRef, useState } from "react";

import { devLabel } from "@/lib/devInspector";
import { formatClockLabel } from "@/lib/format";

export interface SuggestOption {
  /** What gets stored. For times this is "HH:MM"; for places it equals the label. */
  value: string;
  label: string;
  /** Muted trailing text — a distance, a code. Never the only place information appears. */
  hint?: string;
}

/**
 * A text input with a filtered dropdown under it, in two flavours.
 *
 * **`freeText`** (the arrive/depart places): every keystroke commits. Picking an option is a
 * shortcut, not a requirement — "my friend's flat" has to survive being typed, or the field stops
 * being optional in practice.
 *
 * **Pick-only** (the arrive/depart times): typing filters but does not commit, and the box snaps
 * back to the selected option when it closes. This is what lets the stored value stay a strict
 * "HH:MM" without writing a parser for whatever a person types into a time field — and without
 * `sanitizeClock` silently discarding "quarter past 8" on the server, where the traveler would
 * never learn it went missing.
 *
 * Written rather than adapted from `DestinationSearch` for one reason: that component has no
 * accessibility at all — no combobox role, no listbox, no active-descendant — and neither does
 * anything else in this repo. There was no in-house pattern to match, so this is it.
 *
 * Two behaviours here are bugs already paid for elsewhere and must not be simplified away:
 * closing on document `mousedown` rather than the input's `onBlur` (blur fires first and kills the
 * click that was selecting an option), and swallowing Enter unconditionally (all four call sites
 * sit inside the plan `<form>`, which an un-prevented Enter submits).
 */
export default function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  freeText = false,
  className = "",
  inputClassName = "",
}: {
  value: string;
  onChange: (next: string) => void;
  options: SuggestOption[];
  placeholder?: string;
  ariaLabel: string;
  freeText?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const selected = options.find((o) => o.value === value) ?? null;
  const displayValue = freeText ? value : (selected?.label ?? "");

  // `null` means "not typing" — the box shows whatever the committed value renders as. Holding a
  // second copy of the text in state and syncing it back from props needs an effect, and an effect
  // that calls setState is both a lint error and the thing that overwrites what someone is
  // mid-way through typing.
  const [typed, setTyped] = useState<string | null>(null);
  const query = typed ?? displayValue;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Only filter while actually typing. Filtering on a committed value would collapse the list to
  // the one row that already matches it — reopening a time field set to 8:15 PM would offer 8:15
  // PM and nothing else.
  const filtering = typed !== null && typed.trim().length > 0;
  const needle = query.trim().toLowerCase();
  const visible = filtering
    ? options.filter((o) => o.label.toLowerCase().includes(needle))
    : options;

  const activeId = activeIndex >= 0 && visible[activeIndex] ? `${listId}-${activeIndex}` : undefined;

  // Without this, opening a 96-row time list already set to 8:15 PM shows midnight.
  useEffect(() => {
    if (!open) return;
    const index = activeIndex >= 0 ? activeIndex : visible.findIndex((o) => o.value === value);
    listRef.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, visible, value]);

  function show() {
    setOpen(true);
    setActiveIndex(visible.findIndex((o) => o.value === value));
  }

  function pick(option: SuggestOption) {
    onChange(option.value);
    setTyped(null);
    setOpen(false);
    setActiveIndex(-1);
  }

  function close() {
    setOpen(false);
    setActiveIndex(-1);
    // Dropping the typed text is what stops a pick-only field sitting there displaying something
    // it never committed.
    setTyped(null);
  }

  // Bound to the root, not the input. `max-h-60 overflow-y-auto` over 96 time options makes the
  // list a scrollable region, and Chrome gives scrollable regions a tab stop so they can be
  // scrolled by keyboard — so Tab moves focus off the input and onto the list, where an
  // input-bound Escape never fired. Both time fields were keyboard traps: the only exit was a
  // mouse click elsewhere. Input key events bubble to the root, so this still fires once.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      // Always swallowed, open or closed: this sits inside the plan form.
      e.preventDefault();
      if (open && visible.length > 0) pick(visible[activeIndex >= 0 ? activeIndex : 0]);
      return;
    }
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        show();
        return;
      }
      if (visible.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + step + visible.length) % visible.length);
    }
  }

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className={`relative ${className}`}
      {...devLabel("SuggestInput")}
    >
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onFocus={show}
        onClick={show}
        onChange={(e) => {
          setTyped(e.target.value);
          setActiveIndex(-1);
          setOpen(true);
          if (freeText) onChange(e.target.value);
        }}
        // Guarded by relatedTarget, which is what makes an onBlur safe here: closing on a bare
        // blur kills the click that was selecting an option. Needed because tabbing away fires no
        // document mousedown, and a list left open after focus has gone is its own bug.
        onBlur={(e) => {
          if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close();
        }}
        className={inputClassName}
      />

      {open && visible.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="geo-suggest-dropdown absolute inset-x-0 top-full mt-1.5 max-h-60 overflow-y-auto py-1"
        >
          {visible.map((option, i) => (
            <li
              key={option.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={option.value === value}
              // Mouse and keyboard share one highlight rather than each having their own.
              onMouseEnter={() => setActiveIndex(i)}
              // mousedown, not click: the input's blur would otherwise land first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3.5 py-2 text-sm transition-colors duration-100 ${
                i === activeIndex ? "bg-white/10 text-foreground" : "text-muted"
              }`}
            >
              <span className={option.value === value ? "font-medium text-foreground" : ""}>
                {option.label}
              </span>
              {option.hint && <span className="shrink-0 text-xs tabular-nums text-muted">{option.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every quarter hour, once, at module scope. Fifteen minutes is the granularity an arrival time
 *  is actually known to — nobody lands at 20:17 and nobody plans around it if they do. */
export const TIME_OPTIONS: SuggestOption[] = Array.from({ length: 24 * 4 }, (_, i) => {
  const hh = String(Math.floor(i / 4)).padStart(2, "0");
  const mm = String((i % 4) * 15).padStart(2, "0");
  const value = `${hh}:${mm}`;
  return { value, label: formatClockLabel(value) };
});
