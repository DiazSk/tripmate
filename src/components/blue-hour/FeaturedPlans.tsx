"use client";

import Image from "next/image";
import { useRef } from "react";

import { devLabel } from "@/lib/devInspector";
import { formatMoney } from "@/lib/format";
import { useLineReveal } from "@/lib/lineReveal";
import { planExamples } from "./planExamples";
import SectionOpener from "./SectionOpener";

/**
 * Worked examples, stated as facts.
 *
 * The beat the landing was missing. Every other section says what the product *does*; this one
 * shows four plans it has actually produced, with the numbers visible — price, place, dates,
 * length, party. That density is the whole point, and it is the opposite of the Blue Hour row's
 * old behaviour of hiding its one interesting line behind a hover.
 *
 * Card shape is the reference's: text left, photograph right, no gap between cards, adjacent cells
 * sharing one hairline. The photography is reused scene imagery and is the one thing here worth
 * replacing — see `planExamples.ts`.
 */
export default function FeaturedPlans({ onPlan }: { onPlan: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useLineReveal(headingRef);

  return (
    <section
      id="featured"
      className="pointer-events-auto scroll-mt-[var(--nav-h)] px-5 py-16 sm:px-6 sm:py-24"
      {...devLabel("FeaturedPlans")}
    >
      {/* `headingRef` goes on the h2, not on SectionOpener's wrapper. The wrapper holds the
          support paragraph too, and `useLineReveal` splits and masks every line inside whatever it
          is given — pointing it at the block shredded the paragraph into spread-out fragments. */}
      <SectionOpener label="Plans">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <h2
            ref={headingRef}
            className="font-scene-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.05] text-foreground"
          >
            Four trips, already priced
          </h2>
          {/* The reference puts support copy in the header's right half rather than beneath the
              heading. It keeps the heading a single object and gives the paragraph somewhere to be
              that is not directly under it. */}
          <p className="scene-prose max-w-sm text-sm text-muted">
            Every figure below is what the planner returns for those dates and that budget —
            not a starting price with the real one further in.
          </p>
        </div>
      </SectionOpener>

      {/* Zero gap, shared hairlines both ways. `md:[&:nth-child(n+3)]:border-t` puts the horizontal
          rule only between the two rows, never above the first or below the last.
          `auto-rows-fr` is the load-bearing part: it makes every row the same height, which is what
          lets the photograph keep one shape across all four cards. The reference does this with a
          fixed 322px — measured — but a magic number breaks the moment a title wraps to three
          lines, where equal fractional rows just grow together. */}
      <div className="mt-10 grid md:auto-rows-fr md:grid-cols-2">
        {planExamples.map((plan) => (
          <article
            key={plan.id}
            className="group grid h-full gap-5 border-white/10 py-8 sm:grid-cols-2 sm:gap-6 md:px-6 md:[&:nth-child(2n)]:border-l md:[&:nth-child(n+3)]:border-t [&:nth-child(n+2)]:border-t md:[&:nth-child(2)]:border-t-0"
          >
            {/* `justify-between` against the row's shared height: the title sits at the top of every
                card and the CTA at the bottom of every card, so the spec list absorbs the slack
                instead of each card ending wherever its own copy happened to stop. */}
            <div className="flex h-full flex-col justify-between">
              <h3 className="text-[1.75rem] font-semibold leading-[1.2] tracking-[-0.09em] text-foreground">
                {plan.title}
              </h3>
              <p className="mt-2 text-sm text-muted">
                from{" "}
                <span className="text-base font-semibold text-foreground">
                  {formatMoney(plan.fromUsd)}
                </span>
              </p>

              {/* A definition list, not four paragraphs: these are labelled facts and a screen
                  reader should hear the pairing. Term left, value right, on hairlines. */}
              <dl className="mt-6 space-y-0 text-xs">
                {[
                  ["Where", plan.region],
                  ["When", plan.dates],
                  ["Length", plan.span],
                  ["Party", plan.party],
                ].map(([term, value]) => (
                  <div
                    key={term}
                    className="flex items-baseline justify-between gap-4 border-t border-white/10 py-2"
                  >
                    <dt className="shrink-0 text-white/55">{term}</dt>
                    <dd className="text-right text-muted">{value}</dd>
                  </div>
                ))}
              </dl>

              <button
                type="button"
                onClick={onPlan}
                className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-surface-deep px-5 py-2.5 text-sm font-semibold tracking-[-0.045em] text-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-[0.98]"
              >
                Plan a trip like this
              </button>
            </div>

            {/* One shape, always. This used to be `sm:aspect-auto sm:min-h-[16rem]`, which let the
                photograph take whatever height its card's text happened to need — so a card with a
                longer title got a visibly taller, differently-cropped image than the one beside it.
                Filling the row's shared height instead means the frame is identical across all
                four and only the text reflows, which is the reference's own behaviour.
                Stacked below `sm` it falls back to the 11:12 the Blue Hour row uses. */}
            <div className="relative aspect-[11/12] transform-gpu overflow-hidden sm:aspect-auto sm:h-full">
              <Image
                src={plan.photo.src}
                alt={plan.photo.alt}
                fill
                sizes="(min-width: 768px) 25vw, 100vw"
                className="object-cover [transition:var(--scene-hover)] [transition-property:transform] group-hover:scale-[1.04]"
              />
              <div className="scene-photo-sheen pointer-events-none absolute inset-0" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
