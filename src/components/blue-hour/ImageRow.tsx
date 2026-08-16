"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { gsap, ScrollTrigger, prefersReducedMotion } from "@/lib/gsap";
import { useScrollContainer } from "@/lib/scrollContainer";
import { sceneBeats } from "./sceneBeats";

// Rotates through the two net-new scene hues so a beat without a photo yet still
// reads as part of one graded sequence rather than four identical blocks.
const PLACEHOLDER_GRADIENTS = [
  "linear-gradient(160deg, var(--color-scene-cobalt), var(--color-scene-teal))",
  "linear-gradient(160deg, var(--color-scene-teal), var(--color-scene-cobalt))",
];

/**
 * The "images together" row — Vita Travels' own pattern for a set of related
 * photos: side by side, sharp/compact, a one-line caption above each, never a
 * paragraph on the image. Keeps TripMate's own rounded-2xl card language rather
 * than Vita's sharp 0px corners (see plan addendum for why). Replaces the earlier
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
      className="scene-band pointer-events-auto scroll-mt-[var(--nav-h)] overflow-hidden px-5 py-16 sm:px-6 sm:py-24"
    >
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
      {sceneBeats.map((beat, index) => (
        // `group` drives the whole hover treatment: the frost clears, the photo eases up
        // in scale, the description rises out of the bottom edge. Pure CSS transitions
        // rather than more GSAP — nothing here is scroll-linked, and a hover state should
        // not depend on a JS animation loop. Every property references the single
        // `--scene-hover` clock so they start and land on the same frame.
        <div key={beat.id} className="image-row-item group">
          {/* Label + stat together, so the area above the card is a complete "what /
              how much" pairing rather than a single word standing alone — the same
              two-line shape Vita Travels uses ("Introvert Retreats / 78+ Countries").
              min-h reserves room for a 2-line stat regardless of how many lines this
              particular one actually wraps to — without it, a card whose stat happened
              to fit on one line sat next to one whose stat wrapped to two, and the grid
              row's photos (each mt-3 below its own text block) started at different
              heights. line-clamp-2 is the matching upper bound, so a future longer stat
              can't blow past the reserved space and reintroduce the same drift. */}
          <div className="min-h-14 [transition:var(--scene-hover)] [transition-property:transform] group-hover:-translate-y-1">
            <p className="font-scene-body text-sm font-medium text-foreground">{beat.label}</p>
            <p className="font-scene-body mt-0.5 line-clamp-2 text-xs text-muted">{beat.stat}</p>
          </div>
          <div className="relative mt-3 aspect-[3/4] transform-gpu overflow-hidden rounded-2xl border border-card-border [transition:var(--scene-hover)] [transition-property:box-shadow] group-hover:shadow-2xl group-hover:shadow-black/40">
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
            {/* Resting frost sheet — clears on hover. */}
            <div className="scene-frost pointer-events-none absolute inset-0" />
            {/* …and reappears as frost gathered on the inside edges. */}
            <div className="scene-frost-edge pointer-events-none absolute inset-0 rounded-2xl" />
            <div className="scene-photo-sheen pointer-events-none absolute inset-0" />
            {/* The description lives in the card now, hidden until hover. Its scrim is
                part of the same element, so the photo is unobstructed at rest. */}
            <p className="scene-card-detail font-scene-body pointer-events-none absolute inset-x-0 bottom-0 p-4 pt-10 text-xs leading-relaxed text-on-deep">
              {beat.detail}
            </p>
          </div>
        </div>
      ))}
      </div>
    </section>
  );
}
