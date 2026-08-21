"use client";

import { useRef } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { useLineReveal } from "@/lib/lineReveal";

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

  return (
    <section className="pointer-events-auto relative flex min-h-dvh flex-col items-center justify-center overflow-hidden p-5 text-center sm:p-6">
      {/* No scrim, matching DESIGN.md's landing-headline rule: nothing sits between the type and
          the photograph — hero-legible's own three-layer shadow carries legibility.
          The wrapper stays now that nothing animates it: `next/image` with `fill` needs a
          positioned parent, and this is it. */}
      <div className="absolute inset-0 -z-10">
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

      {/* This wrapper also stays, and for a less obvious reason than the photo's: promoting the
          `<h1>` to a direct child of `items-center` would give it `align-self: center` and
          shrink-to-fit width, which changes where the headline wraps — and `useLineReveal` masks
          the line boxes it *measures*, so a wrap change is a change to the reveal. */}
      <div>
        {/* One word, set as large as the viewport allows.
            It was the full sentence at clamp(2.25rem, 6.5vw, 5rem), which is less than half this
            and wrapped to two or three lines — a headline that size reads as a caption on the
            photograph rather than as a poster on it. The sentence is not lost; it moved down to
            the support line, which is where its meaning was doing the work anyway.
            This also makes the two ends of the story rhyme: the page opens on "Somewhere." and
            closes on "Elsewhere.", both one word, both `.font-scene-hero`.
            13rem is past the craft floor's 6rem display ceiling. That ceiling is for a page whose
            headline shares the viewport; this one *is* the viewport, and the reference's own hero
            measures 11.87rem. Deliberate, and the reason is the brief. */}
        <h1
          ref={headingRef}
          className="hero-legible font-scene-hero text-[clamp(3rem,11vw,13rem)] leading-[0.92] text-on-deep"
        >
          Somewhere.
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
          className="hero-rise hero-legible mx-auto mt-6 max-w-lg text-balance scene-prose text-base text-on-deep sm:text-lg"
          style={{ animationDelay: "180ms" }}
        >
          It&rsquo;s the blue hour, and every trip we plan is built around finding it.
        </p>

        {/* Shares the subline's entrance one step later, so the ask arrives after the sentence
            that justifies it rather than alongside it. `shadow-lg` because this is the one button
            on the page sitting on bare photography with no panel behind it. */}
        <div
          className="hero-rise mt-8 flex justify-center"
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

      {/* The scroll cue: fades out over the first 200px of real scroll, so its absence itself
          confirms the page moved. That fade is `animation-timeline: scroll()` — the bob is
          time-driven and lives on the inner element, the scroll-driven fade on the outer, so
          neither needs an `animation-timeline` list. Decorative only, not a control. */}
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
          own ground and reads as text pasted onto a dark rectangle. No JavaScript. */}
      <div aria-hidden className="hero-dusk pointer-events-none absolute inset-0 z-10" />
    </section>
  );
}
