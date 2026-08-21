"use client";

import { useRef } from "react";
import { getImageProps } from "next/image";
import { ChevronDown } from "lucide-react";
import { useLineReveal } from "@/lib/lineReveal";

/** The hero is two photographs, not one: a back layer that hangs from the top and a front layer
 *  that stands on the bottom, with the headline sandwiched between them. Each has a landscape and a
 *  portrait crop.
 *
 *  Sizes are stated rather than imported because `getImageProps` needs them at module scope, and
 *  they must be the files' *true* intrinsics — `getImageProps` builds the srcset from this ratio, so
 *  a wrong pair here stretches the horizon.
 *
 *  All four carry a real alpha channel: BACK's sky is intact but its lower edge is torn away, FRONT's
 *  sky is absent entirely. That is what lets them interlock over the canvas. If a replacement ever
 *  ships as JPEG the missing regions arrive as white slabs — the format is load-bearing, not an
 *  optimisation. */
const BACK = {
  landscape: { src: "/scenes/hero-background-1.webp", width: 2899, height: 1086 },
  portrait: { src: "/scenes/mobile-hero-background-1.webp", width: 750, height: 1363 },
};
const FRONT = {
  landscape: { src: "/scenes/hero-background-2.webp", width: 2899, height: 1350 },
  portrait: { src: "/scenes/mobile-hero-background-2.webp", width: 750, height: 1026 },
};

/** Both landscape files carry 5px of fully transparent margin on the left and 14px on the right —
 *  0.17% and 0.48% of their 2899px width — which at full bleed shows as slivers of bare canvas down
 *  each edge. Pulling both edges outward by their own margin hides them; this is the same trick the
 *  reference uses (`max-width: calc(100% + 8px); right: -8px`). The portrait pair measures zero on
 *  every edge and keeps `left-0 right-0`.
 *
 *  **Both width branches are inside media queries, and neither may be unprefixed.** Pairing a base
 *  `w-full` with a variant `w-[100.65%]` does not work: Tailwind emits the two `w-*` utilities in one
 *  sorted group with the unprefixed one last, so `w-full` quietly won and the images still fell 1–2px
 *  short of the right edge. Dropping `w-full` entirely is worse — an absolutely positioned *replaced*
 *  element with `width: auto` takes its **intrinsic** width rather than the left/right gap, so every
 *  viewport rendered the images at a flat 750px. Two mutually exclusive media queries cannot collide
 *  with each other, which is the only arrangement that holds.
 *
 *  `max-w-none` is load-bearing too. Tailwind's Preflight sets `img { max-width: 100% }`, which
 *  silently clamped the widened layer straight back to 100% and left the right edge 4px short at
 *  2560. Preflight is a set of opinions that outrank what you wrote, not a neutral reset — the same
 *  lesson as The Preflight-Beats-The-UA Rule. The reference hits this too and answers it the same
 *  way, with an explicit `max-width: calc(100% + 8px)`. */
const LAYER_WIDTH =
  "max-w-none [@media(max-aspect-ratio:3/5)]:w-full [@media(min-aspect-ratio:3/5)]:w-[100.65%] [@media(min-aspect-ratio:3/5)]:-left-[0.17%]";

/**
 * The opening moment of the Blue Hour scroll story: a curated photo, a one-word headline,
 * drifting light, and the CTA.
 *
 * The CTA used to live at the very end, on a closing `HeroPoster` beat, and being withheld across
 * the whole sequence was the story's organising idea. That worked when the page was four beats and
 * the poster was the densest thing on it. It is seven beats now — the card row, the method strip,
 * four priced plans and a world map all arrived — and against those the poster was one word on an
 * empty ground, the least substantial screen on the page arriving last and asking for the click.
 * A reveal that lands softer than everything before it is not a reveal.
 *
 * So the ask sits where the reference puts it, in the hero, under the support line. That is also
 * the one place the sequence can afford it: everything after this beat is evidence, and a visitor
 * convinced by the evidence should not have to scroll back up to act on it.
 *
 * **Nothing here is scroll-driven from JavaScript, and the hero is not pinned.** Both of those
 * were true for exactly one commit and both were wrong, in ways worth writing down because the
 * reasoning that produced them was reasonable.
 *
 * The pin was `ScrollTrigger({ pin: true, scrub: true, start: "top top", end: "+=100%" })`
 * scrubbing three tweens: a push into the photograph, the type drifting up and out, and
 * `.hero-dusk`'s wash to full opacity. The design audit that asked for it asked for the hero to
 * *collapse into the band below instead of hard-cutting* — and a pin does not do that. It holds
 * the section still for a whole viewport of scroll, so the first thing a visitor does to the page
 * is discover it does not move, and the composition they are left looking at while it does not
 * move is a flat `#082130` rectangle, since the wash reached 1 and the type reached 0 together.
 * Three further costs came free with it: the scroller is an element, not the window, so GSAP
 * resolved `pinType: "transform"` and held the section by rewriting `translateY` every frame; the
 * pin spacer changed the scroller's `scrollHeight` mid-gesture; and `refreshPriority: -1` did the
 * *opposite* of its own comment — ScrollTrigger's sort key is `refreshPriority * -1e6`, so it
 * sorted the pin last, and every trigger below it measured against a layout with no pin spacer
 * and fired a full viewport early, finishing before it was on screen.
 *
 * So the hand-off is CSS now: `.hero-dusk` rides `animation-timeline: --story` on every viewport,
 * which is compositor-owned, needs no scroller plumbing, and was already the shipping path
 * everywhere below `lg`. It is capped below opaque — see that rule for why the cap only became
 * correct once the pin was gone.
 *
 * The ambient motion is CSS keyframes on `transform`/`opacity` only (`.hero-light`, `.hero-cue*`),
 * which the compositor owns outright. This component used to run five infinite GSAP tweens plus a
 * `pointermove` parallax driving six `quickTo`s across two nested transform planes; a Chrome trace
 * of a real session found scrolling frames resolving on the main thread (`SCROLL_MAIN_THREAD` on
 * 1688 of 3426) rather than the compositor — frames were not being dropped, only 2.1% were, they
 * were arriving *late*, queued behind main-thread work. The globe's render loop, 976ms of that
 * trace and its largest single entry, does not run on this route at all — see The
 * Mounted-Surface Gate.
 *
 * The one remaining scroll-driven exception is `useLineReveal` on the headline, which is
 * ScrollTrigger and therefore per-frame main-thread work by definition. It is a one-shot: it
 * plays once on entry and does nothing for the rest of the session, which is the difference
 * between it and a scrub.
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
export default function Hero({ onPlan }: { onPlan: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useLineReveal(headingRef);

  // Four `getImageProps` calls: a landscape and a portrait crop for each of the two layers. This is
  // Next's own art-direction pattern — `<Image>` cannot switch source on a media query, and two
  // `<Image>`s toggled with `hidden` would download both files, since `display: none` does not stop
  // a fetch. `priority` still yields `fetchpriority=high` and eager loading but *not* the
  // `<link rel=preload>` a rendered `<Image>` emits, which is the right trade: a preload fires
  // before the media query resolves and would fetch the crop this viewport is not going to use.
  const common = { alt: "", sizes: "100vw", priority: true } as const;
  const { props: { srcSet: backLandscape } } = getImageProps({ ...common, ...BACK.landscape });
  const { props: { srcSet: backPortrait, ...backRest } } = getImageProps({ ...common, ...BACK.portrait });
  const { props: { srcSet: frontLandscape } } = getImageProps({ ...common, ...FRONT.landscape });
  const { props: { srcSet: frontPortrait, ...frontRest } } = getImageProps({ ...common, ...FRONT.portrait });

  return (
    // **`aspect-ratio`, not `min-h-dvh`.** The section's height follows its *width*, which is the
    // whole mechanism: both layers sit at natural size (`h-auto`, no `object-cover` crop, which is
    // why the scene reads zoomed-out and uncropped) and therefore always overlap by a fixed
    // fraction of the width. Pinned to the viewport instead they would come apart — at 768x1024 the
    // two landscape layers total 646px against a 1024px section, opening a 378px band of bare
    // canvas between the mountains and the steppe.
    //
    // Ratios are the reference's own: 1440/922 landscape, 375/812 portrait. The reference also caps
    // portrait at `max-height: 50rem`; we cannot, and the reason is worth recording. A `max-height`
    // against an `aspect-ratio` does not clamp height alone — it shrinks the box on *both* axes to
    // preserve the ratio, so at 390px the section came out 369px wide and left a 21px strip of the
    // page showing down the right edge. Unclamped, 390px gives 845px, which is the viewport anyway.
    // The known cost is that the hero is no longer exactly one screen — shorter than the viewport on
    // a portrait tablet (768x1024 gives 492px, so the next beat peeks) and taller on wide displays.
    // That is the reference's behaviour and it is what keeps the layers interlocked at every size.
    //
    // The type is simply centred. The old `pb-[26vh]`/`pb-[18vh]` offsets existed only because a
    // bottom-anchored crop put the CTA on the yurts; with the layers at natural size the centre is
    // already right — the reference's own text block measures 241px in a 639px section, landing at
    // exactly `(639-241)/2`.
    <section className="pointer-events-auto relative flex aspect-[1440/922] flex-col items-center justify-center overflow-hidden px-5 text-center sm:px-6 [@media(max-aspect-ratio:3/5)]:aspect-[375/812]">
      {/* BACK — mountains, hanging from the top edge.
          Its own sky is intact, so this is the one layer that puts bright imagery behind the type;
          the veil below is what makes that safe. Switched on aspect ratio rather than a width
          breakpoint because orientation is what actually differs between the crops (2.67 against
          0.55), and 3/5 rather than 1/1 because at full width the portrait file stands 1.37x its own
          width tall — fine on a phone, impossible on a 4:3 tablet. */}
      <picture>
        <source media="(min-aspect-ratio: 3/5)" srcSet={backLandscape} sizes="100vw" />
        <source srcSet={backPortrait} sizes="100vw" />
        <img
          {...backRest}
          alt=""
          aria-hidden
          className={`absolute top-0 left-0 z-0 h-auto ${LAYER_WIDTH}`}
        />
      </picture>

      {/* The one ambient loop: a slow warm pass across the composition. Over the mountains and
          under the type — it is weather, not a scrim. */}
      <div aria-hidden className="hero-light z-[1]" />

      {/* The wrapper stays: promoting the `<h1>` to a direct child of `items-center` would give it
          `align-self: center` and shrink-to-fit width, changing where the headline wraps — and
          `useLineReveal` masks the line boxes it *measures*, so a wrap change is a change to the
          reveal. It is `static` with no `z-index`, which matters: it must not open a stacking
          context, or the z values on its children could not straddle FRONT. */}
      <div>
        {/* `z-2` — the sandwich. This is the one element FRONT passes in front of, so the steppe's
            horizon cuts across the bottom of the word instead of stopping beneath it. Everything
            else in this block sits at `z-4`, above FRONT, so the support copy stays fully legible.
            One word, set as large as the viewport allows; 13rem is past the craft floor's 6rem
            display ceiling, deliberately, because this headline *is* the viewport. It rhymes with
            the closing "Elsewhere." */}
        <h1
          ref={headingRef}
          className="hero-legible relative z-[2] font-scene-hero text-[clamp(3rem,11vw,13rem)] leading-[0.92] text-on-deep"
        >
          Somewhere.
        </h1>
        {/* The support line, on the reference's own paragraph step rather than the app's body step:
            1.75rem / 600 / 1.3 / -0.0714em on desktop, dropping to 1.1875rem / 1.0 / -0.028em on a
            phone. Every axis moved, and one of them was silently broken — this element computed
            `letter-spacing: normal`, so the body tracking DESIGN.md documents had never reached it.

            **`scene-prose` had to come off, not be overridden.** It is an unlayered
            `line-height: 1.8` in globals.css, and an unlayered rule beats a layered one regardless
            of specificity — Tailwind emits `leading-*` inside `@layer utilities`, so the class would
            have silently won and held the old 1.8. That is The Unlayered-Shadow Rule, met on
            line-height instead of box-shadow. The class stays in globals.css for the four other
            components that use it.

            19px on mobile, not the reference's 18px. At 600 weight that crosses WCAG's 18.66px
            large-text threshold, which drops the bar from 4.5:1 to 3:1 and is what lets this line
            pass on a phone at all — 1px of deviation for a measurable legibility gain.

            The delay is an inline style, not `[animation-delay:...]` — that Tailwind arbitrary
            property generates no rule in this project, so the documented stagger had never actually
            run and both lines arrived together. Inline is what the app's other three staggers use. */}
        <p
          className="hero-rise hero-legible relative z-[4] mx-auto mt-6 max-w-[22rem] text-balance text-[1.1875rem] leading-none font-semibold tracking-[-0.028em] text-on-deep sm:max-w-[34rem] sm:text-[1.75rem] sm:leading-[1.3] sm:tracking-[-0.0714em]"
          style={{ animationDelay: "180ms" }}
        >
          It&rsquo;s the blue hour, and every trip we plan is built around finding it.
        </p>

        {/* Shares the subline's entrance one step later, so the ask arrives after the sentence that
            justifies it. `shadow-lg` because this is the one button on the page sitting on bare
            photography with no panel behind it. */}
        <div
          className="hero-rise relative z-[4] mt-8 flex justify-center"
          style={{ animationDelay: "300ms" }}
        >
          <button
            type="button"
            onClick={onPlan}
            className="pointer-events-auto rounded-full border border-transparent bg-accent px-8 py-4 text-base font-medium text-accent-foreground shadow-lg shadow-black/30 transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none active:scale-[0.98]"
          >
            Plan a trip
          </button>
        </div>
      </div>

      {/* FRONT — the steppe, standing on the bottom edge at `z-3`, in front of the headline and
          behind everything else. Its sky is absent, so the mountains and the canvas show through
          above the horizon.
          `-bottom-[0.4vw]` on the landscape crop only: that file carries an 11px fully transparent
          margin under the grass, which bottom-anchored left a strip of bare canvas along the screen
          edge (measured at 1440x900 as five rows dropping to mean RGB 23 under grass at 58). 11px of
          a 2899px frame is 0.38vw at any width. The portrait file has no such margin. */}
      <picture>
        <source media="(min-aspect-ratio: 3/5)" srcSet={frontLandscape} sizes="100vw" />
        <source srcSet={frontPortrait} sizes="100vw" />
        <img
          {...frontRest}
          alt=""
          aria-hidden
          className={`absolute bottom-0 left-0 z-[3] h-auto ${LAYER_WIDTH} [@media(min-aspect-ratio:3/5)]:-bottom-[0.4vw]`}
        />
      </picture>

      {/* The scroll cue: fades out over the first 200px of real scroll, so its absence itself
          confirms the page moved. Decorative only, not a control.
          The offset is not a flat `bottom-8` any more. With an aspect-driven section the hero can be
          taller than the window (1229px at 1920x1080), which would park the cue below the fold —
          the one place a scroll hint is useless. `max()` keeps it 2rem from the section's bottom
          when the hero fits and 2rem from the *viewport's* bottom when it does not. */}
      <div
        aria-hidden
        className="hero-cue hero-legible pointer-events-none absolute bottom-[max(2rem,calc(100%-100dvh+2rem))] z-[4] text-on-deep/70"
      >
        <div className="hero-cue-bob">
          <ChevronDown size={28} strokeWidth={1.5} />
        </div>
      </div>

      {/* The exit wash — see `.hero-dusk`. Last child and `z-10` so it covers the type as well as
          the photograph: the composition has to dim as one image, or the headline survives its
          own ground and reads as text pasted onto a dark rectangle. No JavaScript. */}
      <div aria-hidden className="hero-dusk pointer-events-none absolute inset-0 z-10" />
    </section>
  );
}
