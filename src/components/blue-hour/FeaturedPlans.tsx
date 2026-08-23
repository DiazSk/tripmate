"use client";

import Image from "next/image";
import { useRef } from "react";

import ButtonMark from "@/components/ButtonMark";
import { devLabel } from "@/lib/devInspector";
import { formatDateRange, formatMoney } from "@/lib/format";
import { useLineReveal } from "@/lib/lineReveal";
import {
  formatExampleParty,
  formatExampleSpan,
  planExamples,
  resolveExampleDates,
  toPrefill,
  type PlanPrefill,
} from "./planExamples";
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
/** Local rather than imported from `HomeView`, which does not export it — and identical to it on
 *  purpose: the roll below must agree with the form's own `min` attribute about what day it is, and
 *  `sv-SE` is what yields `YYYY-MM-DD` from a *local* date. UTC would be wrong here; "today" is the
 *  traveller's today, not Greenwich's. */
const todayISO = () => new Date().toLocaleDateString("sv-SE");

/** "Sep 12 – 20, 2026". `formatDateRange` gives the range but no year, and these are always future
 *  dates that may be next year, so the year has to be said. Appended only when both ends share it —
 *  across a year boundary `formatDateRange` already prints two full dates and one year would be a
 *  lie about the other. */
function formatExampleWhen(startDate: string, endDate: string): string {
  const range = formatDateRange(startDate, endDate);
  const startYear = startDate.slice(0, 4);
  return endDate.slice(0, 4) === startYear ? `${range}, ${startYear}` : range;
}

export default function FeaturedPlans({
  onPlan,
}: {
  /** Called with the card's own details so the wizard opens already filled in. `Hero` calls the
   *  same prop with nothing, which is why the argument is optional rather than a second callback. */
  onPlan: (prefill?: PlanPrefill) => void;
}) {
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

      {/* Zero gap, shared hairlines both ways. `xl:[&:nth-child(n+3)]:border-t` puts the horizontal
          rule only between the two rows, never above the first or below the last.
          `auto-rows-fr` is the load-bearing part: it makes every row the same height, which is what
          lets the photograph keep one shape across all four cards. The reference does this with a
          fixed 322px — measured — but a magic number breaks the moment a title wraps to three
          lines, where equal fractional rows just grow together.

          **Two-up at `xl`, not `md`, and the number is arithmetic rather than taste.** Each card
          splits internally at `sm`, so once the outer grid is also two-up there are four columns
          across the viewport and a text column measures `(vw - 192) / 4`. At `md` that is **144px**
          — enough for the definition list, which is why it looked survivable, but not for the rest:
          the title wrapped to three lines and the CTA label wrapped to two with its mark orphaned
          beside the second. `lg` would give 208px, which fits the 200px CTA by 8px and is not a
          margin worth shipping. `xl` gives 272px. Between `md` and `xl` the cards are one per row
          with the internal split intact, so the text column runs 348px to 603px — wider than it
          ever was, at the cost of a taller section. Every `md:` modifier here moved with the
          breakpoint, because each one exists only to describe the two-up arrangement: the shared
          borders, the internal gutters, and the equal row heights.

          **One border-top rule per range, never a rule plus an override.** The horizontal hairline
          used to be an unprefixed nth-child(n+2) border-top for the stacked case, with a
          nth-child(2) border-top-zero at the two-up breakpoint to lift it off card 2, which is in
          row 1. That override never applied: Tailwind orders by *utility*, not by variant, so the
          zero-width rule is emitted before the plain one — measured in this app's own stylesheet —
          and at equal specificity (`.class:nth-child(…)`, 0-2-0) the later rule wins whatever media
          query wraps the earlier one. Card 2 therefore carried a stray rule above it at two-up the
          whole time, one hairline over the top-right card and none over the top-left. `max-xl:` for
          the stacked range and `xl:` for the two-up range means neither rule has to beat the other.
          Same lesson as the display utilities on the navbar's Profile link: emit one declaration
          for a property per range, not two and a guess about order.

          Named in prose rather than written as class tokens on purpose. **Tailwind's scanner reads
          this comment.** Spelling the old classes out here put two real rules into the shipped
          stylesheet that no element carries — one of them still there at the time this was
          rewritten, top-level and unconditional. A comment explaining a class cannot be written
          *as* that class. */}
      <div className="mt-10 grid xl:auto-rows-fr xl:grid-cols-2">
        {planExamples.map((plan) => {
          // Resolved per render rather than hoisted: the value depends on today's date, and a module
          // constant would freeze it for the life of the server process.
          const dates = resolveExampleDates(plan.startMonthDay, plan.days, todayISO());
          return (
          <article
            key={plan.id}
            className="group grid h-full gap-5 border-white/10 py-8 sm:grid-cols-2 sm:gap-6 max-xl:[&:nth-child(n+2)]:border-t xl:px-6 xl:[&:nth-child(2n)]:border-l xl:[&:nth-child(n+3)]:border-t"
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
                  {formatMoney(plan.budgetUsd)}
                </span>
              </p>

              {/* A definition list, not four paragraphs: these are labelled facts and a screen
                  reader should hear the pairing. Term left, value right, on hairlines. */}
              <dl className="mt-6 space-y-0 text-xs">
                {[
                  ["Where", plan.destination],
                  ["When", formatExampleWhen(dates.startDate, dates.endDate)],
                  ["Length", formatExampleSpan(plan.days)],
                  ["Party", formatExampleParty(plan.adults, plan.children)],
                ].map(([term, value]) => (
                  <div
                    key={term}
                    className="flex items-baseline justify-between gap-4 border-t border-white/10 py-2"
                  >
                    <dt className="shrink-0 text-white/55">{term}</dt>
                    {/* `suppressHydrationWarning` on the date row only, and narrowly on purpose.
                        The resolved season depends on what day it is, and `todayISO()` reads a
                        *local* date — so a server in one timezone and a reader in another can
                        disagree about "today" and render different years on the one day a year the
                        season boundary falls between them. This is what the attribute is for: a
                        value that legitimately differs between server and client. The client's
                        answer wins after hydration, which is the correct one, because it is the
                        traveller's calendar the date inputs validate against.
                        The other three rows are deterministic and are not suppressed — a blanket
                        suppression here would hide real mismatches in `Where`, `Length` and
                        `Party`. */}
                    <dd
                      className="text-right text-muted"
                      suppressHydrationWarning={term === "When"}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Full width below `sm`, shrink-to-fit above it — the reference's own behaviour for
                  this button, measured rather than guessed: at 375px its card CTA is 335px in a
                  375px card (full width inside the gutters) with `justify-content: center`, and at
                  1154px it is 153px in a 1090px card. `sm` is the right breakpoint because it is
                  where this card's own layout changes: below it the text column is the whole card
                  and a full-width pill reads as the card's action, at `sm` and up the column is
                  half the card and a full-width pill would be a 300px bar under four short rows.
                  Centred, not `justify-between` — that is what the reference computes, and it is
                  also what the app's two other full-width pills already do (the Hero CTA at
                  portrait, the mobile menu's). */}
              <button
                type="button"
                onClick={() => onPlan(toPrefill(plan, todayISO()))}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-surface-deep px-5 py-2.5 text-sm font-semibold tracking-[-0.045em] text-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-[0.98] sm:w-fit sm:justify-start"
              >
                Plan a trip like this
                {/* Kept at this button's own `gap-2` rather than the reference's `1rem` — that is
                    tuned for a 20px-tall primary CTA and reads loose at this size. `ButtonMark`
                    fills `currentColor`, which is what makes it work on this button in particular:
                    unlike the hero's, this one *does* invert its text on hover (white on slate
                    becomes dark on amber) and the mark has to follow. */}
                <ButtonMark />
              </button>
            </div>

            {/* One shape, always. This used to be `sm:aspect-auto sm:min-h-[16rem]`, which let the
                photograph take whatever height its card's text happened to need — so a card with a
                longer title got a visibly taller, differently-cropped image than the one beside it.
                Filling the row's shared height instead means the frame is identical across all
                four and only the text reflows, which is the reference's own behaviour.
                Stacked below `sm` it falls back to the 11:12 the Blue Hour row uses.

                `order-first` below `sm`, and it is a correctness fix rather than a preference. The
                DOM order is text-then-photo because that is the reading order at `sm` and up, where
                they are side by side. Stacked, that same order put each photograph *between* its own
                CTA and the next card's title — so on a phone the Amber Fort elephant sat directly
                above "Sinaia when the weather decides", and with `alt=""` there was nothing to
                correct the impression. Reordering visually rather than in the DOM is the right tool
                here precisely because these images are decorative: a screen reader never reaches
                them, so the two orders cannot disagree for anyone. */}
            <div className="relative order-first aspect-[11/12] transform-gpu overflow-hidden sm:order-none sm:aspect-auto sm:h-full">
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
          );
        })}
      </div>
    </section>
  );
}
