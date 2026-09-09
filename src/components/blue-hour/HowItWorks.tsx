"use client";

import { MapPin, CloudSun, ScanSearch, Compass } from "lucide-react";
import type { ComponentType } from "react";
import { useRef } from "react";

import { TYPICAL_WAIT_PHRASE } from "@/lib/generationStages";
import { useLineReveal } from "@/lib/lineReveal";
import SectionOpener from "./SectionOpener";

/**
 * What actually happens when a plan is generated.
 *
 * The copy here is derived from the pipeline rather than written as marketing. `generationStages.ts`
 * names five measured stages — `geocode`, `context`, `generate`, `critique`, `placing` — and two of
 * them are things this product does that nothing on the landing previously mentioned:
 *
 *  - **critique** is a second model call (150s of the ~311s run — nearly half of it) that reviews
 *    the finished plan, lists its issues, and can return revised days which replace the originals.
 *    That is what makes "most of it is the plan being checked rather than written" literally true
 *    rather than a turn of phrase.
 *  - **placing** corrects the model's coordinates against OSM, because it writes lat/lng from
 *    memory and gets them wrong — measured at 11km off for Fushimi Inari, 3km for Nishiki Market.
 *
 * Those are the interesting claims, and they are true. The previous three steps ("real prices",
 * "weather", "three tiers") described the inputs three times and the machinery not at all.
 *
 * The duration in the standfirst is `TYPICAL_WAIT_PHRASE`, not prose. It read "two and a half
 * minutes" here while the loader said "five" and the review step said "two" — three numbers for
 * one wait, two of them the stale pre-2026-08-21 estimate. A landing page that under-promises the
 * wait is worse than one that states it: the traveler finds out either way, and only one version
 * of them is still trusting the plan when they do.
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
      className="pointer-events-auto scroll-mt-[var(--nav-h)] px-5 py-16 sm:px-6 sm:py-24"
    >
      {/* This section used to skip the opener label entirely, on the recorded reasoning that "that
          is the reference's own arrangement" — its equivalent section drops the label and splits
          the header instead, heading left and a line of support copy right. The reasoning that
          followed ("using the label on every section would make it wallpaper") is sound on its own
          merits, but it was reached by copying rather than by deciding, and the folio line the
          openers now draw is a section boundary rather than a kicker — so there is no longer a
          wallpaper argument against having one here. Every section gets its line. */}
      {/* `headingRef` goes on the h2, **not** on SectionOpener — see its own prop doc. `useLineReveal`
          masks every line box inside the element it is handed, so pointing it at this wrapper caught
          the standfirst paragraph too and split it into spread-out fragments across the full width.
          FeaturedPlans records the same trap for the same reason. */}
      <SectionOpener label="Method">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <h2
            ref={headingRef}
            className="font-scene-display text-foreground"
          >
            How it actually works
          </h2>
          <p className="scene-prose max-w-sm text-sm text-muted">
            Four steps, about {TYPICAL_WAIT_PHRASE}. Most of it is the plan being checked rather
            than written.
          </p>
        </div>
      </SectionOpener>

      {/* **Four ruled rows, not four columns.** The column arrangement this replaced was the
          reference's: icon at the top of each cell, a deliberate 56px run of air, then the text
          pinned below it. It needed two separate workarounds to survive contact with this
          product's copy — the air had to be a fixed gap rather than `justify-between`, because the
          reference's four bodies all run to exactly two lines and ours run two to three; and the
          air had to be switched off below `lg`, because once the grid stacked, 56px inside a step
          against 40px between steps put every icon nearer the *previous* step's body than its own
          heading. Two fixes for a shape that never fitted the content.

          A numbered row does fit it. A process is a sequence, and a sequence reads down a page
          rather than across one; each step gets the full measure, so a three-line body is no
          longer a defect; and the arrangement is identical at every width, which removes the
          proximity bug rather than gating it behind a breakpoint. It also gives the page a change
          of density — the beats above are a four-up grid, and a dense passage earns a quieter one.

          The number leads, in the figure face, at the left. It is a genuine index and now looks
          like one: `01` in mono against a hairline is a spec sheet's numbering, and the tiny
          0.62rem index beside an icon that this replaces was small precisely because at display
          size it competed with the section heading. Given its own column it can be legible without
          competing with anything. */}
      <ol className="mt-14 border-t border-card-border">
        {STEPS.map(({ number, label, body, Icon }) => (
          <li
            key={number}
            className="grid grid-cols-[2.5rem_1fr] items-start gap-x-4 gap-y-2 border-b border-card-border py-6 sm:grid-cols-[3.5rem_1fr_auto] sm:gap-x-8 sm:py-8"
          >
            <span className="font-mono pt-0.5 text-sm font-semibold text-muted tabular-nums">
              {number}
            </span>
            <div>
              <p className="text-base font-medium text-foreground sm:text-lg">{label}</p>
              <p className="scene-prose mt-1.5 max-w-[58ch] text-sm text-muted">{body}</p>
            </div>
            {/* Right-aligned and hidden on phones: at this size the icon is an ornament on a row
                that already reads perfectly without it, and a third column on a 390px screen would
                cost the body copy more measure than the icon is worth. */}
            <Icon
              className="col-start-3 row-start-1 hidden self-center text-muted sm:block sm:h-7 sm:w-7"
              strokeWidth={1.25}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
