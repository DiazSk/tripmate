"use client";

import { MapPin, CloudSun, ScanSearch, Compass } from "lucide-react";
import type { ComponentType } from "react";
import { useRef } from "react";

import { useLineReveal } from "@/lib/lineReveal";

/**
 * What actually happens when a plan is generated.
 *
 * The copy here is derived from the pipeline rather than written as marketing. `generationStages.ts`
 * names five measured stages — `geocode`, `context`, `generate`, `critique`, `placing` — and two of
 * them are things this product does that nothing on the landing previously mentioned:
 *
 *  - **critique** is a second model call (~50s of the ~150s run) that reviews the finished plan,
 *    lists its issues, and can return revised days which replace the originals.
 *  - **placing** corrects the model's coordinates against OSM, because it writes lat/lng from
 *    memory and gets them wrong — measured at 11km off for Fushimi Inari, 3km for Nishiki Market.
 *
 * Those are the interesting claims, and they are true. The previous three steps ("real prices",
 * "weather", "three tiers") described the inputs three times and the machinery not at all.
 */
const STEPS: { number: string; label: string; body: string; Icon: ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  {
    number: "01",
    label: "You set the constraints",
    body: "Where, when, how much, and who is going. The budget is a target to hit, not a ceiling to stay under.",
    Icon: MapPin,
  },
  {
    number: "02",
    label: "Real data goes in first",
    body: "Forecast for your actual dates, public holidays, opening hours and travel times — fetched before a single word is written.",
    Icon: CloudSun,
  },
  {
    number: "03",
    label: "Written, then critiqued",
    body: "A second pass reviews the finished plan against your budget and pace, and rewrites the days it finds fault with.",
    Icon: ScanSearch,
  },
  {
    number: "04",
    label: "Every place is checked",
    body: "Coordinates are corrected against OpenStreetMap, so the pins land where the place actually is rather than where the model guessed.",
    Icon: Compass,
  },
];

export default function HowItWorks() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Lines, masked, on the sequence's one shared text entrance — see `useLineReveal` for why a
  // line is the right unit and a word is not.
  useLineReveal(headingRef);

  return (
    <section
      id="how-it-works"
      // scroll-mt: see the matching comment in ImageRow.tsx.
      className="pointer-events-auto scroll-mt-[var(--nav-h)] border-t border-white/10 px-5 py-16 sm:px-6 sm:py-24"
    >
      {/* No section-opener label here, unlike the beats either side of it.
          That is the reference's own arrangement, not an oversight: its "How Vita Works" section
          drops the label and instead splits the header — heading left, one line of support copy
          right. Using the label on every section would make it wallpaper; skipping it here is what
          keeps it meaning "a new movement began". */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
        <h2
          ref={headingRef}
          className="font-scene-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.05] text-foreground"
        >
          How it actually works
        </h2>
        <p className="scene-prose max-w-sm text-sm text-muted lg:pt-2">
          Four steps, about two and a half minutes. Most of it is the plan being checked rather
          than written.
        </p>
      </div>

      {/* Four columns: icon at the top, a deliberate run of air, then the text.
          The air is a fixed gap rather than `justify-between` on a min-height. Pinning the text to
          the bottom of an equal-height cell is what the reference does, and it works there because
          all four of its bodies run to exactly two lines — ours run two to three, so the same rule
          left one column's text sitting a line lower than its neighbours. A fixed gap aligns every
          text block's top edge and keeps the proportion. */}
      <div className="mt-16 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
        {STEPS.map(({ number, label, body, Icon }) => (
          <div key={number} className="flex flex-col gap-14">
            <div className="flex items-start gap-2">
              {/* Drawn line icons at the app's own lucide stroke, matching the reference's thin
                  outline set. */}
              <Icon className="h-8 w-8 text-foreground" strokeWidth={1.25} />
              {/* 0.62rem, not the 2.81rem this used to be. The reference sets its step numbers
                  tiny and beside the icon — the number is an index, not a headline, and at display
                  size it was competing with the section heading for the same job. */}
              <span className="text-[0.62rem] font-semibold leading-none text-white/50">
                {number}
              </span>
            </div>
            <div>
              <p className="text-base font-medium text-foreground">{label}</p>
              <p className="scene-prose mt-2 text-sm text-muted">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
