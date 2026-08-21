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
 * The "images together" row — Vita Travels' own pattern for a set of related
 * photos: side by side, sharp/compact, a one-line caption above each, never a
 * paragraph on the image. These four are square-cornered, unlike every other card
 * in the app: the 16px radius belongs to glass floating over the globe, and these
 * are content sitting on a solid band. Rounding them made four photographs read as
 * four UI cards. Replaces the earlier
 * per-beat full-viewport "Framed Card" sections — four full-screen stops was the
 * reason the landing didn't hit hard; this is one compact moment instead.
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
      className="pointer-events-auto scroll-mt-[var(--nav-h)] overflow-hidden px-5 py-16 sm:px-6 sm:py-24"
    >
      <SectionOpener label="Journey">
        <h2 className="font-scene-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.05] text-foreground">
          What a plan actually knows
        </h2>
      </SectionOpener>

      {/* One ruled grid, not four tiles.
          This was `gap-4 md:gap-6` with `border border-card-border` on each photo frame, which
          gave four separately-boxed cards floating on the band. The reference runs zero gap and
          lets adjacent cells share one hairline, which is most of why theirs reads as an editorial
          grid and ours read as stickers. Same token, same 1px, different reading.
          The dividers are on the cells rather than the container so they land *between* items and
          never on the outer edge: `-mr-px` would be the alternative and it fights `overflow-hidden`. */}
      <div className="mt-10 grid grid-cols-2 md:grid-cols-4">
      {sceneBeats.map((beat, index) => (
        // `group` drives the whole hover treatment: the frost clears, the photo eases up
        // in scale, the description rises out of the bottom edge. Pure CSS transitions
        // rather than more GSAP — nothing here is scroll-linked, and a hover state should
        // not depend on a JS animation loop. Every property references the single
        // `--scene-hover` clock so they start and land on the same frame.
        <div
          key={beat.id}
          className="image-row-item group border-white/10 px-4 py-4 [&:not(:nth-child(2n+1))]:border-l md:px-5 md:[&:not(:nth-child(4n+1))]:border-l md:[&:nth-child(3)]:border-l"
        >
          {/* Label + stat on a hairline — Vita Travels' own card head ("Introvert Retreats"
              left, "/ 78+ Countries" right, rule beneath). The rule is what makes the pair
              read as a caption belonging to the photograph below it rather than as two loose
              lines of text floating above it.
              The split to one line is `lg` and up only, because this copy is not Vita's: their
              stats are three words, ours run to "Lodging, food, and transit — itemized", which
              needs roughly 200px beside an 80px label. That fits in a card at 1024px and wider
              and wraps into a mess below it, so narrow viewports keep the stacked shape.
              min-h-14 reserves room for a 2-line stat, at every width including `lg`. It used to be
              dropped at `lg` on the reasoning that the row is one line by definition up there —
              which stopped being true once the cards gained their own padding: "One 20-minute
              window, every evening" wraps beside "The Blue Hour", and that one card's rule and
              photo then sat lower than the other three. In a grid whose whole premise is shared
              rules, a row that does not align is the failure. The cost is a little air under the
              single-line heads; alignment is worth more. line-clamp-2 is the matching upper bound. */}
          <div className="min-h-14 border-b border-white/10 pb-2 [transition:var(--scene-hover)] [transition-property:transform] group-hover:-translate-y-1 lg:flex lg:items-baseline lg:justify-between lg:gap-4">
            <p className="text-sm font-medium text-foreground">{beat.label}</p>
            {/* The leading slash is the reference's, and it does more than it looks like: it
                marks the right-hand run as metadata about the left rather than a second label. */}
            <p className="mt-0.5 line-clamp-2 text-xs text-muted lg:mt-0 lg:text-right">
              <span aria-hidden>/ </span>
              {beat.stat}
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
                sizes="(min-width: 768px) 25vw, 50vw"
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
          <p className="mt-3 text-xs leading-relaxed text-muted">{beat.detail}</p>
        </div>
      ))}
      </div>
    </section>
  );
}
