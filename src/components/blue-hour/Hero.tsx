"use client";

import { useRef } from "react";
import { getImageProps } from "next/image";
import ButtonMark from "@/components/ButtonMark";
import { useLineReveal } from "@/lib/lineReveal";
import { BACK, FRONT, LAYER_WIDTH } from "./heroScene";


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
 * The ambient motion is CSS keyframes on `transform`/`opacity` only (`.hero-light`), 
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
    <section className="pointer-events-auto relative flex aspect-[1440/922] flex-col items-center justify-center overflow-hidden px-5 text-center sm:px-6 [@media(aspect-ratio<=3/5)]:aspect-[375/812] [@media(aspect-ratio<=3/5)]:pb-[5.375rem]">
      {/* BACK — mountains, hanging from the top edge.
          Its own sky is intact, so this is the one layer that puts bright imagery behind the type;
          the veil below is what makes that safe. Switched on aspect ratio rather than a width
          breakpoint because orientation is what actually differs between the crops (2.67 against
          0.55), and 3/5 rather than 1/1 because at full width the portrait file stands 1.37x its own
          width tall — fine on a phone, impossible on a 4:3 tablet. */}
      <picture>
        <source media="(aspect-ratio > 3/5)" srcSet={backLandscape} sizes="100vw" />
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
          context, or the z values on its children could not straddle FRONT.
 */}
      <div>
        {/* `z-2` — the sandwich. This is the one element FRONT passes in front of, so the steppe's
            horizon cuts across the bottom of the word instead of stopping beneath it. Everything
            else in this block sits at `z-4`, above FRONT, so the support copy stays fully legible.
            One word, set as large as the viewport allows; 13rem is past the craft floor's 6rem
            display ceiling, deliberately, because this headline *is* the viewport. It rhymes with
            the closing "Elsewhere."

            `z-2` puts it behind the FRONT steppe layer, which is the depth this composition is
            built on — but only where the steppe's horizon actually sits below the type. On the
            portrait crop it does not: measured at 375x812 the front layer's box starts at y=299
            against a headline spanning 306-358, and its hillside rises on the right far enough to
            swallow the final "e." — the one word on the page reading "Somewher". So at that one
            breakpoint the headline joins its own subline at `z-4`, in front. The effect survives
            everywhere it reads; legibility of the only word on the screen outranks it where it
            does not. Not `z-4` unconditionally: the FRONT comment records crossing the type as
            deliberate, and on the landscape crop the horizon is genuinely below it. */}
        <h1
          ref={headingRef}
          className="hero-legible relative z-[2] font-scene-hero text-[clamp(3rem,11vw,13rem)] leading-[0.92] text-on-deep [@media(aspect-ratio<=3/5)]:z-[4]"
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
            photography with no panel behind it — the reference carries no shadow here, but its
            button is not over a full-bleed landscape.

            **White at rest, amber on hover** — the reference's own arrangement, read off its live
            CSS rather than its screenshots. Its `.btn-primary` has exactly one hover rule and it
            touches `background-color` only; the label stays dark in both states. That is worth
            stating because the obvious reading is "amber background, white text", and white on
            `#fb9826` measures **2.19:1** — under even the 3:1 large-text bar. `--accent-foreground`
            holds for both states at 16.5:1 on white and 7.55:1 on amber, which is exactly the job
            The Two Foregrounds Rule gives it.

            The focus indicator was broken here and the white fill is what exposed it. It read
            `focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none`, and under
            real keyboard focus `:focus-visible` matched while every ring slot in the composed
            `box-shadow` stayed `rgba(0,0,0,0)` — no indicator at all, in any colour.

            **The cause is unexplained and the note is deliberately narrow about that.** Three
            hypotheses were tested and all three are wrong: it is not the colour token (`ring-accent`,
            which renders correctly on `FeaturedPlans`' button, is equally invisible here), not
            `shadow-lg` occupying the shadow stack (adding it to that other button does not break its
            ring), and not `transition-all` catching the measurement mid-animation (still transparent
            after 1500ms). So this is *not* a general "ring loses to box-shadow" rule — rings work
            elsewhere in this project. Something element-specific defeats it on this button and it was
            not worth more time to find, because `outline` is a different property, measurably renders
            (`2px solid rgb(9,27,32)`), and is already the pattern three other call sites use.

            `outline-accent-foreground` with **no offset**, deliberately. Offset would put the ring
            on the photograph, where a dark line disappears; hugging the button keeps it against a
            known colour in both states — 17.66:1 on the white rest fill, 8.09:1 on the amber
            hover. An amber outline would have vanished on hover, and a white one on rest.

            Type and padding are the reference's too: `0.875rem / 600 / -0.5px` tracking at 90%
            line-height, in a `1.25rem 2rem` box — 4px taller than ours was. */}
        {/* **Docked to the floor in the portrait composition, full width between equal gutters.**
            This is the reference's own construction, measured off its live DOM at 402px rather than
            inferred: its `.intro__button.mobile-visible` is `position: absolute; inset: 0` with
            `align-items: flex-end`, and the anchor inside comes out 351px wide with 26px of gutter
            on the left, the right, and below. Equal inset on three sides — so ours takes `inset-x-5`
            / `bottom-5`, which is that same equal inset at this project's own 20px page gutter
            rather than importing their 25.728px into a page where nothing else uses it.

            `inset-x-5` and not `inset-x-0`: an absolutely positioned element's containing block is
            its ancestor's *padding box*, so `inset-x-0` would ignore the section's `px-5` and touch
            the screen edge.

            **The section's `pb-[4.5rem]` is what makes this safe, and it is the non-obvious half.**
            Taking the button out of the flow shortens the centred block by its own height plus its
            `mt-8`, so the block re-centres ~45px *lower* — the first attempt at this dropped
            "Somewhere." below the horizon instead of being cut by it, losing the one effect the
            two-layer sandwich exists to produce. The reference does not hit this because its text
            block is placed by `padding-top`, not centred, so its button leaving the flow moves
            nothing. Ours stays centred and reserves the space instead.

            86px, and it is measured rather than derived — worth saying, because the derived number is
            wrong. The button's own footprint is 73px (53px tall plus its 20px offset), which leaves
            the headline at 346px; the block's real height is 106px, not the 118px the type metrics
            suggest, so holding the headline at the 339px it sat at before this change needs
            `(870 - pb - 106) / 2 = 339`. Re-measure this if the subline's copy or the type step
            changes, rather than trusting the button's box. Padding-bottom cannot disturb the button
            itself — the padding box's bottom edge is the section's bottom edge either way.

            Both branches are media-scoped, with no bare `relative`/`mt-8` left to inherit — this
            file's own hard-won pattern, see `LAYER_WIDTH`, where an unprefixed `w-full` beat the
            arbitrary media variant meant to override it.

            Known, and the reference's too: at 402px this hero is 870px against a visible viewport of
            roughly 700px once Safari's chrome is showing, so the floor — and the button on it — sits
            below the fold. Vita ships exactly that (858px hero, button 26px off its floor). It falls
            out of the `aspect-ratio` decision above, which both projects made deliberately.

            **`z-11` in the docked branch, above `.hero-dusk`, and that is the consequence of the
            line above rather than a preference.** `.hero-dusk` is the scroll-driven wash that fades
            this whole hero into the next beat: `rgb(var(--surface-deep-rgb))` at `z-10`, resting at
            `opacity: 0`. Since the docked button is below the fold, *reaching* it means scrolling,
            and scrolling is exactly what raises that wash — measured, the CTA clears the fold around
            scrollTop 450 where the wash is at 0.353, which renders a white pill as
            `rgb(170,181,184)`. The primary action arrived on screen already greyed out. Above the
            wash it stays white while the scenery behind it fades, which is the right division: the
            photograph is leaving, the button is not.

            Landscape keeps `z-4`. There the button is centred and fully visible at rest with the
            wash at zero, so fading with the composition as the hero scrolls away is correct — it is
            leaving with everything else, not being scrolled toward. */}
        <div
          className="hero-rise flex justify-center [@media(aspect-ratio>3/5)]:z-[4] [@media(aspect-ratio<=3/5)]:z-[11] [@media(aspect-ratio>3/5)]:relative [@media(aspect-ratio>3/5)]:mt-8 [@media(aspect-ratio<=3/5)]:absolute [@media(aspect-ratio<=3/5)]:inset-x-5 [@media(aspect-ratio<=3/5)]:bottom-5"
          style={{ animationDelay: "300ms" }}
        >
          <button
            type="button"
            // `() => onPlan()` and not a bare `onClick={onPlan}`: React hands the click handler a
            // MouseEvent as its first argument, and `onPlan` now takes an optional prefill in that
            // position. A bare reference would post a MouseEvent into the wizard's form state, and
            // it typechecks, because `Hero` declares the prop as `() => void` and TypeScript
            // happily assigns a wider handler to a narrower one.
            onClick={() => onPlan()}
            className="pointer-events-auto inline-flex items-center gap-4 rounded-full border border-transparent bg-white px-8 py-5 text-sm leading-[0.9] font-semibold tracking-[-0.0357em] text-accent-foreground shadow-lg shadow-black/30 transition-all duration-200 hover:bg-accent focus-visible:outline-2 focus-visible:outline-accent-foreground active:scale-[0.98] [@media(aspect-ratio<=3/5)]:w-full [@media(aspect-ratio<=3/5)]:justify-center"
          >
            Plan a trip
            {/* `gap-4` is the reference's own `1rem`. The mark is `ButtonMark` — see there for why
                it is inline and why it fills `currentColor`. */}
            <ButtonMark />
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
        <source media="(aspect-ratio > 3/5)" srcSet={frontLandscape} sizes="100vw" />
        <source srcSet={frontPortrait} sizes="100vw" />
        <img
          {...frontRest}
          alt=""
          aria-hidden
          className={`absolute bottom-0 left-0 z-[3] h-auto ${LAYER_WIDTH} [@media(aspect-ratio>3/5)]:-bottom-[0.4vw]`}
        />
      </picture>

      {/* The exit wash — see `.hero-dusk`. Last child and `z-10` so it covers the type as well as
          the photograph: the composition has to dim as one image, or the headline survives its
          own ground and reads as text pasted onto a dark rectangle. No JavaScript. */}
      <div aria-hidden className="hero-dusk pointer-events-none absolute inset-0 z-10" />
    </section>
  );
}
