"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useState, useSyncExternalStore } from "react";

import { prefersReducedData, subscribeReducedData } from "@/lib/reducedData";
import { prefersReducedMotion, subscribeReducedMotion } from "@/lib/reducedMotion";
import HeroSearch from "./HeroSearch";
import { HERO_SEQUENCE } from "./heroSequence";
import type { PlanPrefill } from "./planExamples";

/** Lazy and `ssr: false` so a visitor who asked for reduced motion never downloads the engine at
 *  all — the gate below decides before this is ever referenced. */
const HeroFrames = dynamic(() => import("./HeroFrames"), { ssr: false });

/**
 * The landing's first viewport: a scroll-scrubbed film of Petra, a stated proposition, and the
 * trip entry itself.
 *
 * **The one word is back, and the thing that made it wrong before is not.** This beat opened on a
 * single enormous word ("Somewhere.") over two interlocking alpha-cut photographs, with a "Plan a
 * trip" button that opened a form on the *next* screen. Every load-bearing measurement in it came
 * from an external reference site. Two separate objections were recorded against it, and only one
 * of them was ever about the word: the borrowed measurements (fixed — none of that geometry
 * survives), and that "the word at the centre of it said nothing a traveller could act on".
 *
 * That second objection was a property of the *layout*, not of the word. With the form a screen
 * away, the headline was the only thing on offer and had to carry the proposition. The entry
 * capsule now sits directly under it, so the actionable thing is present and the word is free to
 * be a mood again. The product's claim moved to where it is worth more — `HowItWorks` and the
 * plan examples, with figures attached.
 *
 * ## The structure, and why it is two elements rather than one
 *
 * `.hero-track` owns the height. `.hero-stage` is `position: sticky` and owns the
 * `overflow-hidden`. **They cannot be the same element**, and the failure mode if they are is
 * silent: `overflow: hidden` makes an element a scroll container, so a sticky box inside one
 * resolves against a scrollport that never scrolls and pins at its start offset forever, which
 * looks exactly like sticky never having been applied. This is the same trap `globals.css`
 * documents for `scroll(nearest block)` on the `--story` timeline, met from the other direction.
 *
 * `.hero-section` stays on the stage so every rule already written against it keeps applying
 * untouched. It is `justify-end`, and how far the group sits off that bottom edge is decided in
 * globals.css — a hard 56px anchor on a phone so the Treasury reads clear above the stacked
 * capsule, and `clamp(5rem, 26vh, 18rem)` from `sm` up, which is a shade below centre. The old
 * ultrawide `margin-left: 6vw` is gone: it anchored a left-aligned block of text, and this is one
 * centred word over one centred pill.
 *
 * ## The pin is back, and it is not the pin that was deleted
 *
 * A `ScrollTrigger({ pin: true, scrub: true })` hero shipped here for one commit and was removed
 * for five reasons. Three of them were properties of GSAP's pin rather than of pinning: it
 * resolved `pinType: "transform"` because the scroller is an element and held the section by
 * rewriting `translateY` every frame; its pin spacer changed the scroller's `scrollHeight`
 * mid-gesture; and `refreshPriority: -1` sorted it *last* (ScrollTrigger's key is
 * `refreshPriority * -1e6`), so every trigger below it measured against a layout with no spacer
 * and fired a full viewport early. CSS `position: sticky` has none of those: no spacer, no
 * scrollHeight mutation, no per-frame transform, and it never enters ScrollTrigger's refresh sort.
 * **Do not reintroduce `pin: true` here.**
 *
 * The fourth reason was the real one — "the first thing a visitor does to the page is discover it
 * does not move" — and it is answered by the premise rather than by a workaround: that pin held a
 * *still* photograph, so nothing moved. Here every pixel of scroll advances the film.
 *
 * The fifth was that the composition you were left looking at was a flat rectangle, because
 * `.hero-dusk`'s wash reached full opacity a third of the way through the pinned run. That one is
 * a live hazard, not history: `--story` offsets are absolute scroll lengths, so the wash has to be
 * re-ranged for the taller track or it completes early and the film plays behind it, unseen. See
 * `.hero-dusk` in globals.css.
 *
 * ## The 400vh is opt-in, and that is what makes every fallback correct
 *
 * The track is one viewport until `data-seq` is set, which happens only once the sequence is known
 * to be able to run. No JavaScript, reduced motion, **a request to move less data**, or a decode
 * failure all leave the hero exactly one screen tall — nobody is ever made to scroll three empty
 * viewports past a still image, and nobody on a metered plan pays 9.76MB for decoration. The
 * attribute lands before any scroll and growing the page's scroll height shifts no visible
 * element, so it costs no CLS.
 */
export default function Hero({ onPlan }: { onPlan: (prefill?: PlanPrefill) => void }) {
  // `useSyncExternalStore` rather than a read in an effect: the *rendered output* depends on these
  // answers, so they belong in render. Both server snapshots say "do not play", so the server emits
  // the same one-viewport hero that shipped before this feature — with the poster as its LCP
  // element — and the client upgrades on hydration. Both also track their setting changing
  // mid-session, which an effect that reads once cannot.
  //
  // Two stores rather than one combined predicate: motion and bandwidth are separate questions
  // that happen to gate the same element, and each subscribes to its own sources.
  const motionOk = useSyncExternalStore(
    subscribeReducedMotion,
    () => !prefersReducedMotion(),
    () => false,
  );
  // The film is 9.76MB and decorative. Somebody on a metered plan should not pay for it to look
  // nice, and declining costs nothing because the poster hero is already the fallback.
  const dataOk = useSyncExternalStore(
    subscribeReducedData,
    () => !prefersReducedData(),
    () => false,
  );
  const [live, setLive] = useState(false);

  /** `undefined` → one viewport, no canvas. `"on"` → track grown, canvas mounted but transparent.
   *  `"live"` → enough frames decoded to scrub, canvas opaque. */
  const seq = !(motionOk && dataOk) ? undefined : live ? "live" : "on";

  return (
    <div className="hero-track relative" data-seq={seq}>
      <section className="hero-section hero-stage pointer-events-auto sticky top-0 flex h-[100dvh] flex-col justify-end overflow-hidden px-5 pb-14 sm:px-8 sm:pb-20">
        {/* The film. Above the poster, below the scrim, so everything layered over the old
            photograph keeps working against this without changing. */}
        {seq && <HeroFrames onLive={() => setLive(true)} />}

        {/* The poster, and the reason it is frame 1 of the sequence rather than the terracotta
            street photograph this beat used to open on: cross-fading two *different* photographs
            is a visible dissolve on every load, which reads as a glitch. The canvas's first draw
            is this exact frame at this exact crop, so the hand-off is a visual no-op.

            `priority` because this is the LCP element on the site's entry route. Plain
            `object-cover` and deliberately no `object-position`: the poster has to register with
            the canvas's centred cover-fit to the pixel, or the hand-off shows a jump. `.hero-photo`
            used to carry an art-directed `54% 44%` for the street photograph this beat opened on,
            and that rule is now gone entirely — `SceneBackdrop` was its last caller and it renders
            this same poster, so both surfaces are centred and there is nothing left to diverge.

            No `.hero-parallax` wrapper any more. It was 120% tall and offset -10% so the image
            had somewhere to travel; the poster has to sit at exactly `inset-0` to register, and a
            camera dolly is a better parallax than translating a layer by 8%. */}
        {/* The wrapper is not decoration: `next/image` with `fill` requires a containing block
            whose `position` is `relative`, `absolute` or `fixed`, and the stage is `sticky`. A
            sticky box does establish a containing block, so this rendered correctly either way —
            but Next warns on it, and a standing console warning on the entry route is a warning
            nobody will read by the third time they see it. */}
        <div aria-hidden className="hero-poster absolute inset-0 z-0">
          <Image
            src={HERO_SEQUENCE.poster}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        </div>

        {/* Darken toward the ground, never lighten — the house rule for type over photography. One
            stop, not two: the deep bottom wash the headline and capsule stand in, landing on
            `--canvas` exactly so the hero dissolves into the next beat with no seam to find. */}
        <div aria-hidden className="hero-scrim absolute inset-0 z-[1]" />

        {/* The one ambient loop: a slow warm pass across the composition. Over the image and under
            the type — it is weather, not a scrim. Paused while the film is live, because a 24s
            infinite transform under the navbar's blur panel re-rasters that panel at refresh rate
            for as long as the hero is on screen, and the hero is now on screen four times longer. */}
        <div aria-hidden className="hero-light z-[2]" />

        {/* Centred, on the axis the whole composition now shares — see the `.hero-block` note in
            globals.css for why the ultrawide left anchor came off with it. */}
        <div className="hero-block relative z-[4] mx-auto w-full max-w-[72rem] text-center">
          {/* **One word, and the pill under it is what makes that affordable.**

              This was the product's full claim set as a two-line sentence ("Plan a trip that costs
              what you said it would") over a standfirst. Both are gone. The argument for the
              sentence was that a single evocative word "said nothing a traveller could act on" —
              true when it was written, because the hero then carried only a button and the actual
              form lived on the next screen. The entry capsule sits directly beneath now, so the
              thing to act on is *present*: the word sets the mood and the pill takes the input.
              A headline does not have to do both.

              The claim itself is not lost — `HowItWorks` and the plan examples below still make it,
              with numbers, which is where a budget promise is worth more than in a serif.

              `.hero-legible` carries the contrast: a three-layer text-shadow that hugs the glyphs
              rather than a box behind them. No `max-w` — a single word sets its own measure. */}
          <h1 className="hero-rise hero-legible font-scene-hero text-on-deep">Somewhere.</h1>

          <HeroSearch onPlan={onPlan} />
        </div>

        {/* The exit wash — see `.hero-dusk`. Last child and `z-10` so it covers the type as well as
            the image: the composition has to dim as one thing, or the headline survives its own
            ground and reads as text pasted onto a dark rectangle. No JavaScript. */}
        <div aria-hidden className="hero-dusk pointer-events-none absolute inset-0 z-10" />
      </section>
    </div>
  );
}
