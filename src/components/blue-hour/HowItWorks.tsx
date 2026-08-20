"use client";

import { useRef } from "react";
import { useLineReveal } from "@/lib/lineReveal";

const STEPS = [
  {
    number: "01",
    label: "Real prices, not guesses",
    body: "Say what you want to spend. Get a plan that actually spends it — lodging, food, and transit priced in before you land.",
  },
  {
    number: "02",
    label: "Weather goes into the plan",
    body: "Indoor days when it rains, golden hour when it doesn't. The itinerary already knows.",
  },
  {
    number: "03",
    label: "Three ways to travel",
    body: "Budget, mid-range, or luxury — priced against your actual dates before you commit to any of them.",
  },
];

/**
 * The fuller mechanism copy that used to sit beside each scroll-beat photo now
 * lives here as its own text-only section — matching Vita Travels' own split
 * between terse image captions (ImageRow) and separate prose sections. No photos.
 */
export default function HowItWorks() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Was `type: "words"` with a 16px fade-and-rise. Lines, masked, on the sequence's one shared
  // text entrance — see `useLineReveal` for why a line is the right unit and a word is not.
  useLineReveal(headingRef);

  return (
    // Same full-width band as ImageRow. Without it this copy sat directly on the live
    // globe and dropped below readable contrast over bright terrain.
    <section
      id="how-it-works"
      // scroll-mt: see the matching comment in ImageRow.tsx.
      className="scene-band pointer-events-auto scroll-mt-[var(--nav-h)] border-t border-white/10 px-5 py-16 sm:px-6 sm:py-24"
    >
      {/* The section's opening chord: a hairline across the full width, then the heading
          holding its own column with the steps starting where it ends. ImageRow sits on the
          same gradient directly above, so without the rule the two beats ran together as one
          undifferentiated block. The offset is load-bearing rather than decorative indent —
          it is what says a new movement began, which is the job an eyebrow label would
          otherwise do, and this system bans those.
          Stacks below `lg`: at tablet width a heading column plus three step columns leaves
          the body copy at about 30 characters a line.
          The column width is a bare `14rem`, not a `minmax(12rem,20%)`: a comma inside an
          arbitrary Tailwind value breaks the class scanner, and `lg:grid-cols-[minmax(12rem,20%)_1fr]`
          generated no rule at all — a class that looks correct in the markup and silently does
          nothing, exactly like the `[animation-delay:90ms]` case in DESIGN.md. Being a rem, it
          scales with the fluid root anyway, which is what the percentage was for. */}
      <div className="grid gap-10 lg:grid-cols-[14rem_1fr] lg:gap-16">
        <h2 ref={headingRef} className="font-scene-display text-3xl text-foreground sm:text-4xl">
          How it actually works.
        </h2>
        <div className="grid gap-8 md:grid-cols-3 md:gap-10">
          {STEPS.map((step) => (
            <div key={step.number}>
              <p className="font-scene-display text-3xl text-muted/60">{step.number}</p>
              <p className="mt-2 text-base font-medium text-foreground">{step.label}</p>
              <p className="scene-prose mt-2 text-sm text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
