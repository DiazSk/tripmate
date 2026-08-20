"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { useScrollContainer } from "@/lib/scrollContainer";
import { useMapCamera } from "@/lib/mapCamera";

/**
 * The final beat of the Blue Hour scroll story — the reveal. Everything above it
 * (Hero, ImageRow, HowItWorks) is curated photography on opaque bands; this one has
 * neither, sitting directly on the live globe with nothing behind it. Arriving at the
 * real, moving thing after a sequence of stills is the point of putting it last.
 */
export default function HeroPoster({ onPlan }: { onPlan: () => void }) {
  const container = useScrollContainer();
  const sectionRef = useRef<HTMLElement>(null);
  const { viewerRef, ready } = useMapCamera();

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

  // Stop the globe rendering while nothing can see it.
  //
  // This is the last of the four beats and the only one with no opaque band — Hero's photograph
  // and ImageRow/HowItWorks' `.scene-band` completely cover the canvas, so for most of the story
  // Cesium is rendering a scene behind a wall. It is not cheap: in a Chrome trace of a real
  // session the Cesium chunk was 976ms of main-thread JS over 34.4s, the single largest entry,
  // and because that trace also showed every scrolling frame resolving on the main thread rather
  // than the compositor, main-thread JS is exactly what makes this page's scrolling feel late.
  //
  // Written through `viewerRef` rather than a new context method, following the reasoning already
  // recorded on `viewerRef` itself: one consumer does not justify wrapping it. This mirrors what
  // the route-level effect in GlobeBackground already does for `/backend` and `/bench`, including
  // the `requestRender()` — under `requestRenderMode` restarting the loop does not by itself draw
  // anything, and arriving back is a demand nothing else signals.
  //
  // `rootMargin` is a half viewport so the loop restarts *before* the poster is on screen and the
  // tiles are warm on arrival, rather than the globe visibly assembling under the headline. The
  // cleanup restores the loop unconditionally: leaving the landing page must never strand a
  // paused globe on a route that expects a live one.
  useEffect(() => {
    const section = sectionRef.current;
    const root = container?.current;
    if (!section || !root) return;

    const setLoop = (on: boolean) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      viewer.useDefaultRenderLoop = on;
      if (on) viewer.scene.requestRender();
    };

    const io = new IntersectionObserver(([entry]) => setLoop(entry.isIntersecting), {
      root,
      rootMargin: "50% 0px",
    });
    io.observe(section);
    return () => {
      io.disconnect();
      setLoop(true);
    };
    // `ready` is in the deps because the observer's first callback can fire before the viewer
    // exists (the 3D tileset takes seconds); re-running once it does is what makes the pause
    // actually take effect on a cold load rather than silently no-op.
  }, [container, viewerRef, ready]);

  return (
    // pointer-events-auto: this is a section in the scroll story, and empty space
    // within it should keep scroll input rather than passing wheel events through to
    // the globe canvas underneath (AppShell's overlay is pointer-events-none by
    // default so the globe stays draggable elsewhere in the app).
    <section
      ref={sectionRef}
      className="pointer-events-auto flex min-h-dvh flex-col items-center justify-center p-5 text-center sm:p-6"
    >
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
      <h1 className="hero-legible font-scene-hero text-[clamp(2.5rem,10.5vw,12rem)] leading-[0.88] text-on-deep">
        <span className="poster-reveal block">Elsewhere.</span>
      </h1>
      {/* Not text-sm: the poster above is 134px at a laptop width and 202px at 1920, so 14px is a
          cliff rather than a scale step, and this line carries the
          mechanism the rest of the page only implies. */}
      <p className="poster-reveal hero-legible mt-7 max-w-xl text-balance scene-prose text-base text-on-deep sm:text-lg">
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
