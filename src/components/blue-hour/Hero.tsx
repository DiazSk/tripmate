"use client";

import Image from "next/image";
import HeroSearch from "./HeroSearch";
import { HERO_PHOTO } from "./heroScene";
import type { PlanPrefill } from "./planExamples";

/**
 * The landing's first viewport: one photograph, a stated proposition, and the trip entry itself.
 *
 * **What this replaced, and why.** The previous hero was a single enormous word ("Somewhere.")
 * over two interlocking alpha-cut photographs, with a "Plan a trip" button that opened a form on
 * the next screen. Every load-bearing measurement in it came from an external reference site and
 * was recorded as such in this file's own comments: the 1440/922 and 375/812 aspect ratios, the
 * layer-widening trick, the 858px-hero-with-the-button-26px-off-the-floor geometry, the button's
 * type and padding. It was a good composition. It was not this product's composition, and the
 * word at the centre of it said nothing a traveller could act on.
 *
 * Three structural changes:
 *
 * 1. **One photograph, not two.** The old scene interlocked a back layer torn along its lower edge
 *    with a front layer whose sky was removed, so the headline could be sandwiched between them
 *    and cut by the horizon. That effect cost four alpha-channel assets, `LAYER_WIDTH`, and four
 *    separately documented workarounds (Tailwind's sorted-utility race, inclusive media-query
 *    boundaries colliding at exactly 3/5, `max-w-none` against Preflight, and intrinsic width on
 *    absolutely positioned replaced elements) whose only job was to keep two images meeting. One
 *    `object-cover` image needs none of them, and it means new photography is a file swap rather
 *    than a masking job.
 *
 * 2. **`min-h-dvh`, which the old composition could not use.** It was tried there and opened a
 *    378px band of bare canvas at 768x1024, because both layers sat at natural size with no crop.
 *    The stated fix was `object-cover`, deliberately absent so the scene read uncropped. With a
 *    single image that tension is gone: the photograph crops, the section is exactly one screen,
 *    and the primary action is above the fold at every size — which the old hero admitted it was
 *    not, on phones, and accepted because the reference did the same.
 *
 * 3. **The parallax stays, and is now the photograph's own.** `.hero-parallax` drives the image
 *    slower than the scroll off the same named `--story` timeline `.hero-dusk` already uses. No
 *    JavaScript, no scroll listener, and it degrades to a static image where scroll-driven
 *    animation is unsupported or where the visitor asked for reduced motion.
 *
 * `useLineReveal` is gone with the one-word headline it existed for: it masks line *boxes*, which
 * presupposes a headline that is the composition. The ambient `.hero-light` pass and the
 * `.hero-dusk` exit wash both survive untouched.
 */
export default function Hero({ onPlan }: { onPlan: (prefill?: PlanPrefill) => void }) {
  return (
    <section className="hero-section pointer-events-auto relative flex min-h-[100dvh] flex-col justify-end overflow-hidden px-5 pb-14 sm:px-8 sm:pb-20">
      {/* The photograph. `fill` + `object-cover` rather than a fixed intrinsic box: the section is
          viewport-sized, so the image's job is to cover an unknown rectangle, and its own ratio is
          only a hint to the srcset. `priority` because this is the LCP element on the site's
          entry route — without it Next lazy-loads the largest thing on the page.

          The wrapper is what moves, not the `<img>`: `next/image` writes its own `position` and
          sizing onto the element, and a transform on it fights that. The wrapper is also 120% tall
          and offset upward, so there is real image to travel into — a parallax on an exactly
          viewport-sized element reveals the canvas behind it at the end of the run. */}
      <div aria-hidden className="hero-parallax absolute inset-x-0 top-[-10%] z-0 h-[120%]">
        {/* The crop is in CSS (`.hero-photo`), not an inline `objectPosition`, because it has to
            change with the viewport: the warm wall this photograph was chosen for sits on the left,
            and a single focus point that holds it on a 2560 landscape frame loses it entirely on a
            390 portrait one — measured, the phone crop put cold dusk sky behind both lines of the
            headline and reduced the warm wall to a left-edge sliver. */}
        <Image src={HERO_PHOTO.src} alt="" fill priority sizes="100vw" className="hero-photo object-cover" />
      </div>

      {/* Darken toward the ground, never lighten — the house rule for type over photography. One
          stop, not two: the deep bottom wash the headline and capsule stand in, landing on
          `--canvas` exactly so the hero dissolves into the next beat with no seam to find.
          There was a top wash as well, whose only job was giving a transparent navbar something to
          sit on. The bar is a real surface on every route now, so it was darkening the brightest
          part of the frame for nobody. See `.hero-scrim` in globals.css. */}
      <div aria-hidden className="hero-scrim absolute inset-0 z-[1]" />

      {/* The one ambient loop: a slow warm pass across the composition. Over the photograph and
          under the type — it is weather, not a scrim. */}
      <div aria-hidden className="hero-light z-[2]" />

      {/* `hero-block` carries the ultrawide anchor — see globals.css. `mx-auto` alone centred the
          whole composition into a small island at 2560; past 100rem it anchors left on a
          viewport-relative inset so the shape survives the frame getting wider. */}
      <div className="hero-block relative z-[4] mx-auto w-full max-w-[72rem]">
        {/* Two lines, not one word. The proposition is the product's actual claim and the one thing
            that separates it from every other planner: the plan costs what you said it would.

            `.hero-legible` carries the contrast, as it did before — a three-layer text-shadow that
            hugs the glyphs rather than a box behind them. It is doing less work now than it used
            to: this type sits in the deep end of `.hero-scrim` rather than mid-photograph. */}
        <h1
          className="hero-rise hero-legible font-scene-hero max-w-[18ch] text-on-deep"
        >
          Plan a trip that costs what you said it would.
        </h1>

        <p
          className="hero-rise hero-legible mt-5 max-w-[46ch] text-[1.0625rem] leading-[1.55] font-medium text-on-deep/85 sm:text-[1.125rem]"
          style={{ animationDelay: "150ms" }}
        >
          Day by day, priced against real lodging and real weather — not a top-ten list with the
          budget bolted on afterwards.
        </p>

        <HeroSearch onPlan={onPlan} />
      </div>

      {/* The exit wash — see `.hero-dusk`. Last child and `z-10` so it covers the type as well as
          the photograph: the composition has to dim as one image, or the headline survives its own
          ground and reads as text pasted onto a dark rectangle. No JavaScript. */}
      <div aria-hidden className="hero-dusk pointer-events-none absolute inset-0 z-10" />
    </section>
  );
}
