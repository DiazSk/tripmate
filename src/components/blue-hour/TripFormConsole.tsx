"use client";

import { ComponentType, ReactNode } from "react";
import { ArrowRight, CalendarCheck, CalendarDays, MapPin, Wallet } from "lucide-react";
import TierPicker from "@/components/TierPicker";
import ErrorNote from "@/components/ErrorNote";
import { TierId } from "@/lib/tiers";
import { GeocodeOutcome } from "@/lib/useTripCamera";
import { formatMoney } from "@/lib/format";

// `text-base`, not the 14px body step: 16px is what stops iOS Safari zooming the viewport on
// focus, and it's already a step the system uses (the hero subline).
// Placeholder at /65, up from the /55 the old bordered field used: "Kyoto, Japan" is the only
// thing teaching the `City, Country` shape the geocoder wants, so it has to be readable rather
// than a hint of a hint — and /55 measures 4.23:1 against worst-case bright terrain, under the
// 4.5 floor. /65 puts it at 5.2:1.
const fieldInputClass =
  "w-full bg-transparent text-base outline-none placeholder:font-normal placeholder:text-white/65";
// `::placeholder` never applies to input[type=date] — an empty date cell paints the UA's own
// "mm/dd/yyyy" at the input's own colour and weight, so two of the four cells would read as
// filled while empty. The date inputs take their tone from their own value instead, landing
// on the same treatment the destination placeholder gets.
const fieldFilledTone = "font-medium text-foreground";
const fieldEmptyTone = "font-normal text-white/65";

const ghostButtonClass =
  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-foreground/70 transition-colors hover:bg-tag-neutral-bg focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none";
// Shared glass-over-globe card treatment — same class the itinerary/detail
// panels use, reused here for consistency across every step of this page.
// `pointer-events-auto` opts back in from AppShell's `pointer-events-none` overlay, which
// exists so the Cesium canvas underneath stays draggable. Every interactive box needs it.
const cardClass = "glass-itinerary pointer-events-auto rounded-2xl p-5 sm:p-6";

// Local calendar date in ISO shape. `toISOString()` would be UTC and roll the date over a
// day early for anyone west of Greenwich in the evening; "sv-SE" formats local time as
// YYYY-MM-DD, which is exactly what <input type="date"> wants.
const todayISO = () => new Date().toLocaleDateString("sv-SE");

/**
 * One cell of the trip form's console.
 *
 * The four fields share a single recessed trough instead of each carrying its own box, so what
 * separates one from the next is the hairline *between* them, not a border *around* them. That
 * is both the more modern instrument-like read and the more on-system one: four `bg-white/5`
 * boxes lightened the surface, which the Darken-Never-Lighten Rule forbids, while one darker
 * slate trough inside the 0.62 panel is the One Slate Rule doing exactly what it says.
 *
 * Focus is the cell's whole visual job: the ground steps up, the label turns amber, and a
 * hairline wipes across the bottom edge from the left. That wipe is the only amber that ever
 * appears while typing, and it is the form's one recurring motion.
 */
function Field({
  icon: Icon,
  label,
  delay,
  onActivate,
  grow = "flex-1",
  badge,
  children,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  delay: number;
  /** Supplied by the date cells, which open the native picker from a click anywhere in the
   *  cell rather than only on the UA's own (removed) calendar glyph. */
  onActivate?: (cell: HTMLLabelElement, target: EventTarget | null) => void;
  /** Destination takes more of the row than the three fixed-width figures beside it. */
  grow?: string;
  /** The End cell's live day-count readout — a real-time answer to the question this cell
   *  is asking, the moment there's an answer, rather than only further down in the tier
   *  copy. Keyed by its own text so completing the range replays `.pop-in` instead of
   *  React reusing a stale node with no acknowledgement. */
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label
      onClick={onActivate ? (e) => onActivate(e.currentTarget, e.target) : undefined}
      style={{ animationDelay: `${delay}ms` }}
      className={`settle-in group relative px-4 py-3 transition-colors duration-300 focus-within:bg-white/[0.05] ${grow} ${
        onActivate ? "cursor-pointer" : "cursor-text"
      }`}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.025em] text-muted uppercase transition-colors duration-300 group-focus-within:text-accent">
        <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
        {label}
        {badge}
      </span>
      <div className="mt-1.5">{children}</div>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-accent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-focus-within:scale-x-100"
      />
    </label>
  );
}

/**
 * Opens the native date picker from a click on the cell's chrome — its label, icon or padding.
 * A click on the input itself is left alone: that is how you select a single date segment to
 * type over, and hijacking it would trade a working control for a popup.
 *
 * `showPicker` throws when the call isn't user-activated or the picker is already open. Either
 * way the fallback is the input's own default behaviour, exactly what happened before the cell
 * became clickable.
 */
function openNativePicker(cell: HTMLLabelElement, target: EventTarget | null) {
  const input = cell.querySelector("input");
  if (!input || target === input) return;
  try {
    input.showPicker();
  } catch {
    /* the input's own click handling covers it */
  }
}

export default function TripFormConsole({
  destination,
  onDestinationChange,
  onDestinationBlur,
  geocode,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  maxEndDate,
  budget,
  onBudgetChange,
  days,
  tier,
  onPickTier,
  onBack,
  onSubmit,
  error,
}: {
  destination: string;
  onDestinationChange: (value: string) => void;
  onDestinationBlur: () => void;
  geocode: GeocodeOutcome;
  startDate: string;
  onStartDateChange: (value: string) => void;
  endDate: string;
  onEndDateChange: (value: string) => void;
  maxEndDate: string | undefined;
  budget: number;
  onBudgetChange: (value: number) => void;
  days: number | null;
  tier: TierId;
  onPickTier: (tier: TierId) => void;
  onBack: () => void;
  onSubmit: () => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-5xl space-y-4">
        {/* Same hero-rise as the landing block, so the step reads as one move in both
            directions rather than an instant swap forward and an animated one back. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className={`hero-rise console-sheen relative overflow-hidden ${cardClass}`}
        >
          {/* The step had no heading of any kind — it opened straight onto four
              fields, so neither the page nor a screen reader named what you were
              doing. Same display step as "Choose your style" below it. */}
          <h1 className="mb-4 font-scene-display text-xl font-semibold text-foreground">
            Plan your trip
          </h1>

          {/* One instrument, not four widgets. The trough is `--surface-deep` at a lower
              alpha than the panel around it, so it reads as recessed into the glass rather
              than stacked on top of it, and the cells are separated by the divider between
              them. Stacks vertically below `md`, where four cells in a row would each be
              narrower than the date they have to hold. */}
          <div className="field-console flex flex-col divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-surface-deep/50 md:flex-row md:divide-x md:divide-y-0">
            <Field icon={MapPin} label="Destination" delay={80} grow="md:flex-[1.5] flex-1">
              <input
                required
                value={destination}
                onChange={(e) => onDestinationChange(e.target.value)}
                onBlur={onDestinationBlur}
                placeholder="Kyoto, Japan"
                className={`${fieldInputClass} ${fieldFilledTone}`}
              />
            </Field>
            <Field icon={CalendarDays} label="Start" delay={140} onActivate={openNativePicker}>
              <input
                required
                type="date"
                min={todayISO()}
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                className={`${fieldInputClass} tabular-nums ${startDate ? fieldFilledTone : fieldEmptyTone}`}
              />
            </Field>
            <Field
              icon={CalendarCheck}
              label="End"
              delay={200}
              onActivate={openNativePicker}
              badge={
                days !== null && (
                  <span key={days} className="pop-in rounded-full bg-tag-highlight-bg px-2 py-0.5 text-xs font-bold normal-case tracking-normal text-tag-highlight-fg tabular-nums">
                    {days} {days === 1 ? "day" : "days"}
                  </span>
                )
              }
            >
              <input
                required
                type="date"
                min={startDate || todayISO()}
                max={maxEndDate}
                value={endDate}
                onChange={(e) => onEndDateChange(e.target.value)}
                className={`${fieldInputClass} tabular-nums ${endDate ? fieldFilledTone : fieldEmptyTone}`}
              />
            </Field>
            <Field icon={Wallet} label="Total budget" delay={260}>
              {/* The `$` belongs in the field, not parenthesised in the label — budget is
                  the product's whole mechanism, so it should read as a figure being
                  entered rather than as a number with a unit noted elsewhere. */}
              <div className="flex items-baseline gap-1">
                {/* aria-hidden, or the field's accessible name comes out as
                    "Total budget$" — the glyph is inside the label element. */}
                <span aria-hidden="true" className="text-base font-medium text-muted">
                  $
                </span>
                {/* Clearing the field used to snap the value back to a literal "0" under
                    the cursor, because Number("") is 0. 0 renders as empty instead, and
                    min={1} keeps it from ever submitting. */}
                <input
                  required
                  type="number"
                  min={1}
                  value={budget === 0 ? "" : budget}
                  onChange={(e) => onBudgetChange(Number(e.target.value))}
                  className={`${fieldInputClass} tabular-nums ${budget === 0 ? fieldEmptyTone : fieldFilledTone}`}
                />
              </div>
              {/* Live answer to what the figure above actually buys, the moment there's
                  a real trip length to divide it by — otherwise the budget stays an
                  abstract total until the tier cards reprice further down. */}
              {days !== null && budget > 0 && (
                <div key={`${budget}-${days}`} className="value-in mt-0.5 text-xs tabular-nums text-muted">
                  {formatMoney(Math.round(budget / days))}/day for {days} {days === 1 ? "day" : "days"}
                </div>
              )}
            </Field>
          </div>

          {/* Deliberately not the red error block: an Open-Meteo miss only costs the map
              flight and the weather lookup. The itinerary still generates, so blocking on
              a third-party geocoder would turn their outage into "the app is broken". */}
          {/* aria-live rather than role="alert": this resolves asynchronously after a
              geocode the user didn't ask for and doesn't block anything, so it should
              wait its turn rather than interrupt. */}
          {/* The live region is always mounted and collapses to nothing when empty —
              a region that appears at the same moment as its message is announced
              unreliably, because the assistive tech never saw it go from empty to full. */}
          <div aria-live="polite">
            {geocode !== "found" && (
              <p className="value-in mt-2.5 text-xs text-muted">
                {geocode === "missed"
                  ? "Couldn't find that on the map. We'll still plan it."
                  : "Couldn't reach the map service. We'll still plan it."}
              </p>
            )}
          </div>

          <div className="value-in mt-6" style={{ animationDelay: "320ms" }}>
            <h2 id="style-heading" className="font-scene-display text-xl font-semibold text-foreground">
              Choose your style
            </h2>
            <p className="mt-1 text-sm text-muted">
              {days === null
                ? "These are per-day rates. Add your dates and they become trip totals."
                : `Rough estimates for ${days} ${days === 1 ? "day" : "days"}${
                    destination ? ` in ${destination}` : ""
                  }. Pick the one closest to the trip you want.`}
            </p>
            <div className="mt-4">
              <TierPicker days={days} budget={budget} selected={tier} onSelect={onPickTier} />
            </div>
          </div>

          <div
            className="value-in mt-6 flex items-center justify-between border-t border-card-border pt-5"
            style={{ animationDelay: "440ms" }}
          >
            <button type="button" onClick={onBack} className={ghostButtonClass}>
              Back
            </button>
            <button
              type="submit"
              className="group inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none active:scale-[0.98]"
            >
              Generate itinerary
              <ArrowRight
                className="h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5"
                strokeWidth={2.25}
              />
            </button>
          </div>
        </form>

        {/* role="alert" — this one *is* an interruption: the user pressed Generate and
            nothing happened, and focus stays on the button they just pressed. */}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </div>
  );
}
