"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { gsap, prefersReducedMotion } from "@/lib/gsap";
import { useScrollContainer } from "@/lib/scrollContainer";

// How far each plane travels per pixel of cursor offset from centre, and how much it
// yaws. Two planes at different speeds is what reads as depth — the photo barely
// drifts, the type rides noticeably further and turns more.
const PHOTO_SPEED = 0.035;
const PHOTO_YAW = 1.2;
const TEXT_SPEED = 0.085;
const TEXT_YAW = 2.6;

/**
 * The opening moment of the Blue Hour scroll story: a curated photo, a mood-setting
 * headline, drifting fog, and no CTA — "Plan a trip" is withheld until HeroPoster at
 * the very end so its arrival still reads as a reveal.
 *
 * A true multi-layer parallax (the kind built from separately painted mountain and fog
 * PNGs) needs art that ships pre-separated; depth cannot be recovered from one flat
 * photograph. What this does instead: the photo and the type are two real planes moving
 * at different speeds, and the fog is drawn rather than photographed, so it can have as
 * many independently drifting layers as it likes.
 */
export default function Hero() {
  const container = useScrollContainer();
  const sectionRef = useRef<HTMLElement>(null);
  const driftRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const fogRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);

  // Scroll cue.
  useEffect(() => {
    if (!sectionRef.current || !cueRef.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.to(cueRef.current, {
        y: 8,
        duration: 0.9,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      });
      // Scrubbed to scroll position rather than timed, so it can't drift out of sync
      // with where the reader actually is.
      gsap.to(cueRef.current, {
        opacity: 0,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          scroller: container?.current ?? undefined,
          start: "top top",
          end: "+=200",
          scrub: true,
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, [container]);

  // Fog banks. Each layer drifts on its own period so they slide past one another
  // instead of moving as one sheet — the cheapest convincing depth cue there is.
  useEffect(() => {
    if (!fogRef.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(".hero-fog-layer").forEach((layer, i) => {
        gsap.to(layer, {
          xPercent: i % 2 === 0 ? 7 : -7,
          yPercent: -2 - i,
          duration: 19 + i * 8,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        });
      });
    }, fogRef);
    return () => ctx.revert();
  }, []);

  // Ambient drift + cursor parallax.
  useEffect(() => {
    const drift = driftRef.current;
    const photo = photoRef.current;
    const text = textRef.current;
    if (!drift || !photo || !text || prefersReducedMotion()) return;

    // The ambient drift and the cursor parallax deliberately live on two *different*
    // nested elements. Both are transforms, and GSAP's CSSPlugin folds any transform it
    // finds on a node into its own matrix — so an element carrying a looping GSAP tween
    // will quietly erase anything else written to its transform on the next tick. That
    // is what killed the first version of this effect, which set the cursor offset as an
    // inline `translate` on the same node the drift was animating.
    const ctx = gsap.context(() => {
      // Scaled past the frame so neither the drift nor the parallax exposes an edge.
      gsap.set(drift, { scale: 1.14 });
      // Runs regardless of pointer type: on a touch screen mousemove never fires at all,
      // and the hero still has to be alive.
      gsap.to(drift, {
        xPercent: 1.8,
        yPercent: -1.4,
        duration: 16,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      });
    });

    // No cursor to track on a touch device, so don't install the listener at all.
    if (!window.matchMedia("(pointer: fine)").matches) return () => ctx.revert();

    // quickTo keeps the planes easing toward the cursor rather than snapping to it, and
    // routes the writes through GSAP so nothing is fighting over the same property.
    const photoX = gsap.quickTo(photo, "x", { duration: 0.9, ease: "power3" });
    const photoY = gsap.quickTo(photo, "y", { duration: 0.9, ease: "power3" });
    const photoRot = gsap.quickTo(photo, "rotationY", { duration: 0.9, ease: "power3" });
    const textX = gsap.quickTo(text, "x", { duration: 0.7, ease: "power3" });
    const textY = gsap.quickTo(text, "y", { duration: 0.7, ease: "power3" });
    const textRot = gsap.quickTo(text, "rotationY", { duration: 0.7, ease: "power3" });

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - window.innerWidth / 2;
      const dy = e.clientY - window.innerHeight / 2;
      photoX(-dx * PHOTO_SPEED);
      photoY(-dy * PHOTO_SPEED);
      photoRot((dx / window.innerWidth) * PHOTO_YAW);
      textX(-dx * TEXT_SPEED);
      textY(-dy * TEXT_SPEED);
      textRot((dx / window.innerWidth) * TEXT_YAW);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      ctx.revert();
      gsap.set([photo, text], { clearProps: "all" });
    };
  }, []);

  return (
    // perspective: without it the planes' rotationY is a flat skew rather than a turn.
    <section
      ref={sectionRef}
      className="pointer-events-auto relative flex min-h-dvh flex-col items-center justify-center overflow-hidden p-5 text-center [perspective:2300px] sm:p-6"
    >
      {/* No scrim, matching DESIGN.md's landing-headline rule: nothing sits between
          the type and the photo — hero-legible's own shadow carries legibility. */}
      <div ref={driftRef} className="absolute inset-0 -z-10 will-change-transform">
        <div ref={photoRef} className="absolute inset-0 will-change-transform">
          <Image src="/scenes/hero-dawn.jpg" alt="" fill priority className="object-cover" />
        </div>
      </div>

      {/* Fog banks over the lower edge. Always rendered, even under reduced motion —
          they are part of the composition, not just decoration. Kept shallow and fading
          out upward so the ridgeline behind them still reads. */}
      <div ref={fogRef} aria-hidden className="hero-fog -z-10">
        <div className="hero-fog-layer" />
        <div className="hero-fog-layer" />
        <div className="hero-fog-layer" />
      </div>

      <div ref={textRef} className="will-change-transform">
        <h1 className="hero-rise hero-legible font-scene-display text-[clamp(2rem,6vw,4.5rem)] italic leading-[1.05] text-on-deep">
          Somewhere, it&rsquo;s the blue hour.
        </h1>
        {/* mx-auto because this block is no longer a direct child of the section's
            items-center flex — the parallax wrapper sits between them. */}
        <p className="hero-rise hero-legible mx-auto mt-5 max-w-md text-balance text-base leading-relaxed text-on-deep [animation-delay:90ms] sm:text-lg">
          Every trip we plan is built around finding it.
        </p>
      </div>

      {/* The scroll cue: fades out over the first 200px of real scroll, so its
          absence itself confirms the page moved. Decorative only, not a control. */}
      <div
        ref={cueRef}
        aria-hidden
        className="hero-legible pointer-events-none absolute bottom-8 text-on-deep/70"
      >
        <ChevronDown size={28} strokeWidth={1.5} />
      </div>
    </section>
  );
}
