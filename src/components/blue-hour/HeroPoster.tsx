"use client";

import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "@/lib/gsap";
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
        { clipPath: "inset(0 0 0% 0)", y: 0, duration: 0.7, ease: "power3.out", stagger: 0.09, scrollTrigger },
      );
      // delay: 0.45 continues the .poster-reveal stagger's own rhythm (4 headline
      // spans + the subline = 5 elements at 0.09s apart; this is next in that sequence)
      // rather than introducing an unrelated second cadence.
      gsap.fromTo(
        ".poster-fade",
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", delay: 0.45, scrollTrigger },
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
      <h1 className="hero-legible font-scene-hero text-[clamp(2.5rem,8vw,6rem)] leading-[0.88] text-on-deep">
        <span className="poster-reveal block">Every day</span>
        <span className="poster-reveal block">planned.</span>
        <span className="poster-reveal block">Every dollar</span>
        <span className="poster-reveal block">spent.</span>
      </h1>
      {/* Not text-sm: 96px to 14px is a jump, not a scale step, and this line carries the
          mechanism the rest of the page only implies. */}
      <p className="poster-reveal hero-legible mt-7 max-w-xl text-balance text-base leading-relaxed text-on-deep sm:text-lg">
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
