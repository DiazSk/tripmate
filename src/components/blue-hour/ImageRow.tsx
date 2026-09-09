"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { useScrollContainer } from "@/lib/scrollContainer";
import { sceneBeats } from "./sceneBeats";
import SectionOpener from "./SectionOpener";

// Rotates through the two net-new scene hues so a beat without a photo yet still
// reads as part of one graded sequence rather than four identical blocks.
const PLACEHOLDER_GRADIENTS = [
  "linear-gradient(160deg, rgb(var(--surface-deep-rgb)), var(--canvas))",
  "linear-gradient(160deg, var(--canvas), rgb(var(--surface-deep-rgb)))",
];

/**
 * Four things the planner knows, shown side by side.
 *
 * A compact row rather than four full-viewport beats — that earlier arrangement was the reason the
 * landing did not land: four full-screen stops for four facts made the page long without making it
 * dense, and a visitor scrolled past all of them looking for the point.
 *
 * Two rules hold this row together. Nothing is set over a photograph: every caption is above or
 * below its image, never on it, so no frame has to be darkened to stay legible and no copy is
 * hostage to what the picture happens to be doing in that corner. And the frames are
 * square-cornered while the rest of the app is not — this system rounds what you press and squares
 * what you read, so a photograph you are looking at gets a hard edge and a button you are about to
 * click gets a pill.
 *
 * The card head above each photograph used to be a borrowed "Label / Stat" pair on a hairline; see
 * the comment at the head element itself for what replaced it and why.
 */
export default function ImageRow() {
  const container = useScrollContainer();
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!sectionRef.current || prefersReducedMotion()) return;
    // fromTo, not from, and inside a gsap.context: React runs effects twice in dev, and
    // a bare `from()` records the element's *current* values as its destination. On the
    // second run those current values are the hidden start state the first (killed)
    // tween left behind, so the cards animated from invisible to invisible and never
    // appeared. fromTo states both ends explicitly; ctx.revert() clears the inline
    // styles so a re-run always starts from a clean slate.
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".image-row-item",
        { opacity: 0, x: -80 },
        {
          opacity: 1,
          x: 0,
          duration: 0.7,
          ease: "power3.out",
          stagger: 0.12,
          scrollTrigger: {
            trigger: sectionRef.current,
            scroller: container?.current ?? undefined,
            start: "top 85%",
          },
        },
      );
    }, sectionRef);
    return () => ctx.revert();
  }, [container]);

  return (
    // The band spans the full viewport width; only the content inside it is constrained.
    // overflow-hidden is load-bearing, not cosmetic: the cards animate in from negative X
    // and would otherwise widen the page.
    <section
      ref={sectionRef}
      id="journey"
      // scroll-mt: Navbar's anchor links call scrollIntoView({block:"start"}), which
      // would otherwise land this section's top edge flush under the fixed nav.
      className="scene-band is-dense pointer-events-auto overflow-hidden"
    >
      <SectionOpener label="Journey">
        <h2 className="font-scene-display text-foreground">
          What a plan actually knows
        </h2>
      </SectionOpener>

      {/* One ruled grid, not four tiles.
          This was `gap-4 md:gap-6` with `border border-card-border` on each photo frame, which
          gave four separately-boxed cards floating on the band. The reference runs zero gap and
          lets adjacent cells share one hairline, which is most of why theirs reads as an editorial
          grid and ours read as stickers. Same token, same 1px, different reading.
          The dividers are on the cells rather than the container so they land *between* items and
          never on the outer edge: `-mr-px` would be the alternative and it fights `overflow-hidden`.

          **One column below `sm`, and the shared hairline turns horizontal with it.** Two columns
          on a phone gave each cell ~171px, which is not a column, it is a gutter with words in it:
          every `detail` wrapped to five lines two or three words wide. The premise of the section
          survives the stack — adjacent cells still share exactly one rule — it is just that on a
          phone "adjacent" means above and below rather than left and right. */}
      <div className="mt-10 grid sm:grid-cols-2 md:grid-cols-4">
      {sceneBeats.map((beat, index) => (
        // `group` drives the whole hover treatment: the frost clears, the photo eases up
        // in scale, the description rises out of the bottom edge. Pure CSS transitions
        // rather than more GSAP — nothing here is scroll-linked, and a hover state should
        // not depend on a JS animation loop. Every property references the single
        // `--scene-hover` clock so they start and land on the same frame.
        <div
          key={beat.id}
          className="image-row-item group border-white/10 px-4 py-4 [&:nth-child(n+2)]:border-t sm:[&:nth-child(n+2)]:border-t-0 sm:[&:not(:nth-child(2n+1))]:border-l md:px-5 md:[&:not(:nth-child(4n+1))]:border-l"
        >
          {/* The card head. **This replaced a borrowed one**: a bold label at the left, a
              slash-prefixed stat pushed to the right, and a hairline ruled beneath the pair —
              lifted from an external reference, whose own cards read "Introvert Retreats /
              78+ Countries". Two things were wrong with keeping it beyond its provenance. The
              right-hand run only fitted at `lg` and above, because the reference's stats are
              three words and ours run to "Lodging, food, and transit — itemized"; below that the
              pair stacked and the slash became a bullet floating at the start of a line. And the
              stat is a *fact about the product*, not metadata about the label, so subordinating it
              to a slash undersold the only concrete number on the card.

              Now: the fact leads, in the figure face, at a size that reads as a readout — because
              it is one. The label sits beneath it as the quiet half, and the rule moved to the top
              of the card, so the four cards are separated by their own edges rather than each
              carrying an underline. No slash, no right-alignment, no breakpoint where the
              arrangement changes shape.

              `min-h-[4.5rem]` still reserves two lines. It is not decoration: the four heads must
              agree on a baseline or the photographs below them start at four different heights,
              and in a grid whose whole premise is a shared rhythm, a row that does not align is
              the failure. */}
          <div className="min-h-[4.5rem] border-t border-card-border pt-4 [transition:var(--scene-hover)] [transition-property:transform] group-hover:-translate-y-1">
            <p className="font-mono line-clamp-2 text-[0.8125rem] leading-snug font-medium text-money tabular-nums">
              {beat.stat}
            </p>
            <p className="mt-1.5 text-[0.6875rem] font-semibold tracking-[0.12em] text-muted uppercase">
              {beat.label}
            </p>
          </div>
          {/* 11:12 rather than 3:4 — near-square, matching the reference's own 0.92. At 3:4 four
              portraits side by side ran taller than the viewport once the row went full-bleed. */}
          <div className="relative mt-3 aspect-[11/12] transform-gpu overflow-hidden [transition:var(--scene-hover)] [transition-property:box-shadow] group-hover:shadow-2xl group-hover:shadow-black/40">
            {beat.photo ? (
              <Image
                src={beat.photo.src}
                alt={beat.photo.alt}
                fill
                sizes="(min-width: 768px) 25vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover [transition:var(--scene-hover)] [transition-property:transform] group-hover:scale-[1.08]"
              />
            ) : (
              <div
                className="h-full w-full"
                style={{ background: PLACEHOLDER_GRADIENTS[index % PLACEHOLDER_GRADIENTS.length] }}
              />
            )}
            {/* A flat tint, not a blur any more — see `.scene-frost`. Clears on hover; touch
                never shows it. */}
            <div className="scene-frost pointer-events-none absolute inset-0" />
            {/* …and reappears as frost gathered on the inside edges. */}
            <div className="scene-frost-edge pointer-events-none absolute inset-0" />
            <div className="scene-photo-sheen pointer-events-none absolute inset-0" />
          </div>

          {/* A caption under the photograph, not a layer over it.
              This was absolutely positioned inside the frame and revealed on hover, which meant
              its one line of substance did not exist on touch, in a screenshot, or for anyone who
              never hovered. Making it always-visible fixed that and broke something else: at 390px
              the frame is small and this copy runs to seven lines, so it covered the photograph
              entirely. Below the frame it is legible at every width and the image is never
              obstructed — which is also what the reference does, where no card sets type over its
              own photo. */}
          <p className="mt-3 text-[0.875rem] leading-[1.65] text-muted">{beat.detail}</p>
        </div>
      ))}
      </div>
    </section>
  );
}
