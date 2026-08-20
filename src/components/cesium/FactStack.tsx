"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Cards drawn either side of the front one. Five on stage total. */
const WINGS = 2;
/** How long a fact holds before the stack advances itself. */
const HOLD_MS = 7000;
/** After a manual move, wait a full hold before auto-advancing again. */
const RESUME_MS = HOLD_MS;

/** Depth treatment by distance from the front card. Index 0 is the front. */
const DEPTH = [
  { scale: 1, rotate: 0, opacity: 1, z: 30 },
  { scale: 0.9, rotate: 3, opacity: 0.5, z: 20 },
  { scale: 0.82, rotate: 5, opacity: 0.22, z: 10 },
];

/**
 * The wait's fact feed: a staggered stack where one card is square-on and readable and its
 * neighbours fan out behind it, dimmed and tilted. Auto-advances, and can be steered by the
 * arrows or by clicking a card to bring it forward.
 *
 * The important property, and the reason this replaced an orbiting carousel: **the front card
 * never moves while it is being read.** Motion happens only on a discrete advance — a state
 * change with a settle — rather than as a continuous loop. That is the whole difference
 * between a card you can read and one you chase, and it is why the previous version failed
 * WCAG 2.2.2 while this one does not: a reader can stop the rotation by taking control of it,
 * and nothing animates between advances.
 *
 * Position is derived from a cursor and a modulo rather than by shifting an array, which is
 * how the pattern is usually written. The pool genuinely grows mid-wait — the destination
 * context and the Wikipedia extract resolve after the Step 2a bundle — and a mutated array
 * would reorder under the reader when that happens.
 */
export default function FactStack({ facts }: { facts: string[] }) {
  const [cursor, setCursor] = useState(0);
  const [steering, setSteering] = useState(0);

  useEffect(() => {
    if (facts.length <= 1) return;
    const id = setTimeout(() => setCursor((c) => c + 1), steering ? RESUME_MS : HOLD_MS);
    return () => clearTimeout(id);
    // `cursor` restarts the timer on every advance, manual or automatic, so a card the user
    // just brought forward always gets its full reading time rather than the remainder of
    // whatever the last one had left.
  }, [cursor, steering, facts.length]);

  if (facts.length === 0) return null;

  const move = (steps: number) => {
    setCursor((c) => c + steps);
    setSteering((n) => n + 1);
  };

  // A large multiple keeps the modulo positive for negative cursors without a branch.
  const factAt = (offset: number) => facts[(cursor + offset + facts.length * 1024) % facts.length];

  // Narrow the fan when the pool is small. A full fan needs five distinct facts; with four or
  // fewer, wing slots start wrapping onto sentences already on stage and the same fact appears
  // twice at different depths, which reads as a rendering fault rather than a stack.
  const wings = Math.min(WINGS, Math.floor((facts.length - 1) / 2));
  const positions = Array.from({ length: wings * 2 + 1 }, (_, i) => i - wings);

  return (
    <div className="pointer-events-auto flex flex-col items-center">
      <div className="fact-stack">
        {positions.map((position) => {
          const depth = DEPTH[Math.min(Math.abs(position), DEPTH.length - 1)];
          const front = position === 0;
          return (
            <button
              key={position}
              type="button"
              aria-hidden={!front}
              tabIndex={front ? -1 : 0}
              aria-label={front ? undefined : `Show: ${factAt(position)}`}
              onClick={() => !front && move(position)}
              className={`fact-stack-card ${front ? "is-front" : ""}`}
              style={{
                zIndex: depth.z,
                opacity: depth.opacity,
                transform: `translate(-50%, -50%) translateX(${position * 52}%) rotate(${
                  position * depth.rotate
                }deg) scale(${depth.scale})`,
              }}
            >
              {factAt(position)}
            </button>
          );
        })}
      </div>

      {facts.length > 1 && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => move(-1)}
            aria-label="Previous fact"
            className="glass-itinerary flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            aria-label="Next fact"
            className="glass-itinerary flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      )}
    </div>
  );
}
