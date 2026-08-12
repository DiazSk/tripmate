"use client";

import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger, SplitText, prefersReducedMotion } from "@/lib/gsap";
import { useScrollContainer } from "@/lib/scrollContainer";

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
  const container = useScrollContainer();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!headingRef.current || prefersReducedMotion()) return;
    const split = new SplitText(headingRef.current, { type: "words" });
    // fromTo inside a context, for the same reason as ImageRow and HeroPoster: a bare
    // from() re-created by React's double-invoked dev effects would take the leftover
    // hidden state as its destination and never reveal the words.
    const ctx = gsap.context(() => {
      gsap.fromTo(
        split.words,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.5,
          ease: "power2.out",
          stagger: 0.06,
          scrollTrigger: {
            trigger: headingRef.current,
            scroller: container?.current ?? undefined,
            start: "top 85%",
          },
        },
      );
    }, headingRef);
    return () => {
      ctx.revert();
      split.revert();
    };
  }, [container]);

  return (
    // Same full-width band as ImageRow. Without it this copy sat directly on the live
    // globe and dropped below readable contrast over bright terrain.
    <section
      id="how-it-works"
      // scroll-mt: see the matching comment in ImageRow.tsx.
      className="scene-band pointer-events-auto scroll-mt-[var(--nav-h)] px-5 py-16 sm:px-6 sm:py-24"
    >
      <div className="mx-auto w-full max-w-6xl">
      <h2 ref={headingRef} className="font-scene-display text-3xl text-foreground sm:text-4xl">
        How it actually works.
      </h2>
      <div className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
        {STEPS.map((step) => (
          <div key={step.number}>
            <p className="font-scene-display text-3xl text-muted/60">{step.number}</p>
            <p className="font-scene-body mt-2 text-base font-medium text-foreground">
              {step.label}
            </p>
            <p className="font-scene-body mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}
