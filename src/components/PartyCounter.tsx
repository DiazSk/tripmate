"use client";

import { Minus, Plus } from "lucide-react";

import { devLabel } from "@/lib/devInspector";
import { PARTY_MAX_PER_BAND } from "@/lib/userAnswers";
import type { PartyCounts } from "@/lib/types";

/** Bands, not exact ages — see the note on `PartyCounts`. The sublabels are the bands themselves
 *  because "Children" alone means whatever the traveler decides it means, and a family that reads
 *  a 12-year-old as a child would otherwise get a plan built around nap windows. */
const BANDS: {
  key: keyof PartyCounts;
  label: string;
  /** Spelled out rather than derived: stripping a trailing "s" off "Children" doesn't. */
  one: string;
  sub?: string;
  min: number;
}[] = [
  { key: "adults", label: "Adults", one: "adult", min: 1 },
  { key: "children", label: "Children", one: "child", sub: "Aged 2-11", min: 0 },
  { key: "infants", label: "Infants", one: "infant", sub: "Under 2", min: 0 },
];

export const DEFAULT_PARTY: PartyCounts = { adults: 1, children: 0, infants: 0 };

/**
 * The party, as a row of steppers per age band.
 *
 * A stepper rather than `<input type="number">` — which is what every other numeric field in this
 * app uses — for one reason: these are all single digits chosen from a tiny range, where two taps
 * beat a keyboard, and it's the control travelers have already met in every flight booking flow.
 *
 * Accessibility is the whole cost of building it by hand. Each row is a `group` labelled by its
 * own text, so a screen reader reads "Children, aged 2-11" rather than an unattached number
 * between two buttons, and the value is `aria-live` so a press is announced.
 *
 * At the bounds the buttons go `aria-disabled`, NOT `disabled`. A real `disabled` was the first
 * version and it ejected keyboard users: decrementing Adults from 2 to 1 disables the very button
 * under focus, browsers drop focus to `<body>`, and the traveler is returned to the top of the
 * document mid-edit. `aria-disabled` keeps the button focusable and still announces it as
 * unavailable — the handler is what refuses, which is why `atBound` guards it too.
 */
export default function PartyCounter({
  value,
  onChange,
}: {
  value: PartyCounts;
  onChange: (next: PartyCounts) => void;
}) {
  return (
    <div className="space-y-1" {...devLabel("PartyCounter")}>
      {BANDS.map(({ key, label, one, sub, min }) => {
        const count = value[key];
        const set = (next: number) => onChange({ ...value, [key]: next });
        return (
          <div
            key={key}
            role="group"
            aria-label={sub ? `${label}, ${sub.toLowerCase()}` : label}
            className="flex items-center justify-between gap-4 py-1"
          >
            <span className="text-sm text-foreground">
              {label}
              {sub && <span className="ml-2 text-xs text-muted">{sub}</span>}
            </span>
            <div className="flex items-center gap-1">
              <Step
                icon={Minus}
                label={`Remove one ${one}`}
                atBound={count <= min}
                onClick={() => set(count - 1)}
              />
              {/* `tabular-nums` so the row doesn't shift width between 1 and 9. */}
              <span
                aria-live="polite"
                className="w-6 text-center text-sm font-medium tabular-nums text-foreground"
              >
                {count}
              </span>
              <Step
                icon={Plus}
                label={`Add one ${one}`}
                atBound={count >= PARTY_MAX_PER_BAND}
                onClick={() => set(count + 1)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Step({
  icon: Icon,
  label,
  atBound,
  onClick,
}: {
  icon: typeof Minus;
  label: string;
  atBound: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={atBound ? undefined : onClick}
      aria-disabled={atBound}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-foreground transition-colors duration-150 hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:bg-white/5 aria-disabled:text-white/30 aria-disabled:hover:bg-white/5"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
  );
}
