"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { gsap } from "@/lib/gsap";
import { useScrollContainer } from "@/lib/scrollContainer";
import { useLineReveal } from "@/lib/lineReveal";

/**
 * The opening moment of the Blue Hour scroll story: a curated photo, a mood-setting headline,
 * drifting light, and no CTA — "Plan a trip" is withheld until HeroPoster at the very end so its
 * arrival still reads as a reveal.
 *
 * **The ambient motion here runs no JavaScript**, and that is deliberate rather than incidental.
 * This component used to run five infinite GSAP tweens (a photo drift, three fog layers, a cue
 * bob) plus a `pointermove` parallax driving six `quickTo` tweens across two nested transform
 * planes. A Chrome trace of a real session found every scrolling frame resolving on the main
 * thread (`scroll_state: SCROLL_MAIN_THREAD` on 1688 of 3426 frames) rather than the compositor —
 * frames were not being dropped, only 2.1% were, they were arriving *late*, queued behind
 * main-thread work. So the resting-state motion is CSS keyframes on `transform`/`opacity` only
 * (`.hero-light`, `.hero-cue*` in globals.css), which the compositor owns outright, and the
 * globe's render loop — 976ms of that trace, its largest single entry — is paused while this
 * beat covers it; see HeroPoster.
 *
 * **Two scroll-driven exceptions, both requested and both gated.** The masked line reveal on the
 * headline and the pinned scrub that hands the beat off to ImageRow are ScrollTrigger, which is
 * per-frame main-thread work by definition. They are confined accordingly: the pin only exists
 * at `lg` and above and only with `prefers-reduced-motion: no-preference`, so the narrow
 * viewports and low-power devices the trace was worried about get the CSS-only version
 * (`.hero-dusk`'s scroll timeline) instead. Neither runs on a loop — a scrub does work only
 * while the wheel is actually moving, which is the difference between this and the four infinite
 * tweens that were removed.
 *
 * The cursor parallax is gone by request, and it is worth recording that it was *not* the
 * expensive part: `pointermove` dispatch totalled 53ms of a 34.4s trace. It went because a hero
 * that follows the mouse is a design choice the product no longer wants, and because removing it
 * is what let this file lose its effects entirely — with no JS writing transforms here, the
 * Transform-Ownership Rule that forced the old drift and parallax onto two separate nested nodes
 * no longer applies, and neither does the `[perspective:2300px]` those planes needed.
 *
 * The composition now moves the way the subject does: the photograph is held still and the
 * *light* travels across it, which is what a blue hour actually is. That is also one ambient loop
 * where there were four, satisfying the One Ambient Loop Rule literally rather than by
 * dispensation.
 */
export default function Hero() {
  const container = useScrollContainer();
  const sectionRef = useRef<HTMLElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const duskRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useLineReveal(headingRef);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    // matchMedia rather than an `if` on a media query: GSAP tears the whole timeline down and
    // reverts every property it touched when the query stops matching, so a resize from desktop
    // to phone width does not leave a half-scrubbed photo scaled at 1.06 forever.
    const mm = gsap.matchMedia();
    mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      // The CSS scroll-timeline version of the same wash is the fallback for every context this
      // pin does not cover. Both driving `.hero-dusk`'s opacity at once is not a race that
      // resolves gracefully — a CSS animation outranks an inline style, so GSAP would write
      // opacity every frame and the keyframe would overwrite it every frame. The attribute
      // switches the CSS one off for exactly as long as this timeline owns the property.
      section.dataset.heroPinned = "true";

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          scroller: container?.current ?? undefined,
          start: "top top",
          // One viewport of scroll held in place. Longer reads as the page having jammed;
          // shorter and the hand-off is over before it registers as one.
          end: "+=100%",
          scrub: true,
          pin: true,
          // Refreshed before anything below it, so its pin spacer is measured first and the
          // sections after it are laid out against the height it actually claims.
          refreshPriority: -1,
        },
      });
      // A slow push into the photograph while it is held — the camera moving, not the subject.
      // On the photo *wrapper*, never the <Image> itself: next/image owns that element's own
      // sizing, and the Transform-Ownership Rule means one node, one writer.
      tl.fromTo(photoRef.current, { scale: 1 }, { scale: 1.12, ease: "none" }, 0)
        // The type leaves faster than the ground it sits on, which is what reads as depth
        // rather than as the whole frame sliding.
        .fromTo(textRef.current, { yPercent: 0, opacity: 1 }, { yPercent: -22, opacity: 0, ease: "none" }, 0)
        // The blue hour ending — the same wash `.hero-dusk` does in CSS, on this timeline so it
        // stays locked to the pin's progress rather than to raw scrollTop, which during a pin
        // no longer corresponds to where the section visually is.
        .fromTo(duskRef.current, { opacity: 0 }, { opacity: 1, ease: "none" }, 0);

      return () => {
        delete section.dataset.heroPinned;
      };
    });
    return () => mm.revert();
  }, [container]);

  return (
    <section
      ref={sectionRef}
      className="pointer-events-auto relative flex min-h-dvh flex-col items-center justify-center overflow-hidden p-5 text-center sm:p-6"
    >
      {/* No scrim, matching DESIGN.md's landing-headline rule: nothing sits between the type and
          the photograph — hero-legible's own three-layer shadow carries legibility. */}
      <div ref={photoRef} className="absolute inset-0 -z-10">
        <Image src="/scenes/hero-dawn.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
      </div>

      {/* The one ambient loop: a slow warm pass over the photograph. Over the image and under
          nothing — it is weather, not a scrim, so it never sits between the type and the photo. */}
      <div aria-hidden className="hero-light -z-10" />

      {/* Fog banks over the lower edge. Drawn rather than photographed so they can hide the source
          photo's flaws without desaturating it — the densest bank is bottom-left, covering a
          blown-out yellow bokeh blob. Still, now: their old per-layer drift was three of the five
          infinite tweens this component used to run, and once the light is the thing that moves, a
          second drifting element is a competing loop. Held static they cost one rasterisation and
          nothing thereafter, so all three banks stay — the density here was tuned against this
          exact photograph and is worth keeping. */}
      <div aria-hidden className="hero-fog -z-10">
        <div className="hero-fog-layer" />
        <div className="hero-fog-layer" />
        <div className="hero-fog-layer" />
      </div>

      <div ref={textRef}>
        {/* The headline is one string now, not two hand-split phrase spans on `.hero-rise`.
            SplitText measures the real line boxes at the real font size and masks each one, so
            the reveal follows however the type actually wraps at this viewport instead of a
            two-phrase guess that was right at one width. See `useLineReveal`. */}
        <h1
          ref={headingRef}
          className="hero-legible font-scene-display text-[clamp(2.25rem,6.5vw,5rem)] italic leading-[1.05] text-on-deep"
        >
          Somewhere, it&rsquo;s the blue hour.
        </h1>
        {/* mx-auto because this block is no longer a direct child of the section's items-center
            flex — the type wrapper sits between them.
            The delay is an inline style, not `[animation-delay:...]`. That Tailwind arbitrary
            property generates no rule in this project — verified by scanning every stylesheet for
            an `animation-delay` declaration and finding none, and by probing an element carrying
            both classes, which computes `0s` where an inline value computes `0.09s`. The previous
            Hero used the class form, so the stagger DESIGN.md documents here had never actually
            run; both lines arrived together. Inline is what the app's other three staggers already
            use (TierPicker, HomeView, TripFormConsole). */}
        <p
          className="hero-rise hero-legible mx-auto mt-5 max-w-md text-balance scene-prose text-base text-on-deep sm:text-lg"
          style={{ animationDelay: "180ms" }}
        >
          Every trip we plan is built around finding it.
        </p>
      </div>

      {/* The scroll cue: fades out over the first 200px of real scroll, so its absence itself
          confirms the page moved. That fade is now `animation-timeline: scroll()` rather than a
          ScrollTrigger — the bob is time-driven and lives on the inner element, the scroll-driven
          fade on the outer, so neither needs an `animation-timeline` list. Decorative only, not a
          control. */}
      <div
        aria-hidden
        className="hero-cue hero-legible pointer-events-none absolute bottom-8 text-on-deep/70"
      >
        <div className="hero-cue-bob">
          <ChevronDown size={28} strokeWidth={1.5} />
        </div>
      </div>

      {/* The exit wash — see `.hero-dusk`. Last child and `z-10` so it covers the type as well as
          the photograph: the composition has to dim as one image, or the headline survives its
          own ground and reads as text pasted onto a dark rectangle. Still no JavaScript here. */}
      <div ref={duskRef} aria-hidden className="hero-dusk pointer-events-none absolute inset-0 z-10" />
    </section>
  );
}
