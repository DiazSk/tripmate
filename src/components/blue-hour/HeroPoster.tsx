"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { useScrollContainer } from "@/lib/scrollContainer";

/**
 * The final beat of the Blue Hour scroll story — the reveal. Everything above it (Hero, ImageRow,
 * HowItWorks) is curated photography on opaque bands; this one has neither, and sits on `.scene-void`
 * — a lit emptiness rather than a surface. Arriving somewhere open after a sequence of walls is the
 * point of putting it last.
 *
 * It used to sit on the live Cesium globe, with an IntersectionObserver here pausing the render
 * loop for the three covered beats above. That is gone, and with it Cesium's entire presence on
 * this route: the globe now boots when generation starts (see `globeWanted` in mapCamera.tsx),
 * because a cold landing was paying a 2287KB chunk, 33 `/cesium/` asset requests, a WebGL2 context
 * and 1525ms of long tasks to show a globe on exactly one of four beats. The reveal that mattered
 * was never the globe — it is "Plan a trip" being withheld until here.
 */
export default function HeroPoster({ onPlan }: { onPlan: () => void }) {
  const container = useScrollContainer();
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!sectionRef.current || prefersReducedMotion()) return;
    // A mask wipe, not a fade: each line is uncovered bottom-to-top. This used to be the
    // `hero-rise` CSS class, which plays once on mount — and since this section starts
    // several viewports below the fold, that animation was always over before anyone
    // scrolled to it. Driving it from ScrollTrigger is what makes the reveal land.
    // fromTo + gsap.context rather than a bare from(): see the note in ImageRow — a
    // from() tween re-created by React's double-invoked dev effects captures the
    // leftover hidden state as its destination and never reveals anything.
    const ctx = gsap.context(() => {
      const scrollTrigger = {
        trigger: sectionRef.current,
        scroller: container?.current ?? undefined,
        start: "top 75%",
      };
      // The mask wipe stays for the headline + subline — text is exactly what
      // clip-path is good for. It does NOT extend to the CTA row: clip-path hard-clips
      // anything that visually bleeds past the clipped box's edges, and that includes
      // box-shadow blur, not just content. A round pill's shadow-lg normally blooms as
      // a soft round glow past its own edge; sliced by a rectangular clip-path with zero
      // margin, that blur gets cut flat at the div's straight sides — permanently, even
      // once the reveal finishes at "fully open", because zero margin still clips
      // anything beyond zero. That was the hard rectangular corners around the button.
      gsap.fromTo(
        ".poster-reveal",
        { clipPath: "inset(0 0 100% 0)", y: 20 },
        { clipPath: "inset(0 0 0% 0)", y: 0, duration: 0.9, ease: "expo.out", stagger: 0.09, scrollTrigger },
      );
      // The delay continues the .poster-reveal stagger's own rhythm rather than introducing an
      // unrelated second cadence: it is the next slot in that sequence, so it equals
      // (number of .poster-reveal elements) x 0.09. That was 0.45 when the headline was four
      // spans plus the subline; the headline is one word now, so two elements, so 0.18. Leaving
      // it at 0.45 would have parked the CTA a third of a second after everything above it had
      // finished — a gap, not a beat.
      gsap.fromTo(
        ".poster-fade",
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.9, ease: "expo.out", delay: 0.18, scrollTrigger },
      );
    }, sectionRef);
    return () => ctx.revert();
  }, [container]);


  return (
    // pointer-events-auto: this is a section in the scroll story, and empty space
    // within it should keep scroll input rather than passing wheel events through to
    // the globe canvas underneath (AppShell's overlay is pointer-events-none by
    // default so the globe stays draggable elsewhere in the app).
    <section
      ref={sectionRef}
      className="pointer-events-auto relative flex min-h-dvh flex-col items-center justify-center p-5 text-center sm:p-6"
    >
      {/* The ground where the globe used to be — see `.scene-void`. No `overflow-hidden`: unlike
          the Hero's fog banks, nothing here bleeds past its own box. */}
      <div aria-hidden className="scene-void absolute inset-0 -z-10" />
      {/* One word, and it is the whole reveal.
          This was "Every day planned. Every dollar spent." across four centred ragged lines,
          which is a sentence set large rather than a poster: four lines of a claim compete with
          each other, none of them gets to be big, and the mechanism they describe is already
          spelled out in the subline directly beneath and in HowItWorks above. The reference's
          own hero is the single word "Travel". Reducing to one word is what buys the scale —
          capped at 6rem across four lines, it runs to 12rem on one.
          "Elsewhere." rather than a stock imperative: it answers the word the sequence opened
          on. Hero says "Somewhere, it's the blue hour"; this closes the loop.

          The 10.5vw is measured, not guessed. Archivo at 900/125% with this tracking renders
          "Elsewhere." at about 6.87x its font-size, so the vw term is what decides whether it
          fits and the rem cap only bites past ~2280px. A single word cannot wrap, so the failure
          mode is overflow rather than an ugly line break: 15vw filled 93% of a 1920 viewport with
          74px of total slack, which one differently-metricked fallback face would have blown
          through. 10.5vw holds it at 66-82% of the available width from 375px to 2560px — the
          proportion the reference's own one-word hero sits at — with room to spare. */}
      <h1 className="font-scene-hero text-[clamp(2.5rem,10.5vw,12rem)] leading-[0.88] text-on-deep">
        <span className="poster-reveal block">Elsewhere.</span>
      </h1>
      {/* Not text-sm: the poster above is 134px at a laptop width and 202px at 1920, so 14px is a
          cliff rather than a scale step, and this line carries the
          mechanism the rest of the page only implies. */}
      <p className="poster-reveal mt-7 max-w-xl text-balance scene-prose text-base text-on-deep sm:text-lg">
        Tell us where, when, and how much. Get a day-by-day plan that actually costs what
        you said — with the weather already factored in.
      </p>
      {/* "My memories" used to sit here too, beside this button — moved into the
          global nav (Navbar.tsx), which now carries it on every step of this route
          instead of only appearing at this final reveal. */}
      <div className="poster-fade mt-9 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onPlan}
          // border-transparent, not no border: matches the transparent border this
          // button already carried when a bordered ghost CTA sat beside it, so the
          // shape and baseline don't shift now that it's alone.
          className="pointer-events-auto rounded-full border border-transparent bg-accent px-8 py-4 text-base font-medium text-accent-foreground shadow-lg shadow-black/30 transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none active:scale-[0.98]"
        >
          Plan a trip
        </button>
      </div>
    </section>
  );
}
