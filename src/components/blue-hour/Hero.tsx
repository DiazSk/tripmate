import Image from "next/image";
import { ChevronDown } from "lucide-react";

/**
 * The opening moment of the Blue Hour scroll story: a curated photo, a mood-setting headline,
 * drifting light, and no CTA — "Plan a trip" is withheld until HeroPoster at the very end so its
 * arrival still reads as a reveal.
 *
 * **This component runs no JavaScript. No state, no effects, no per-frame work at all.** It used
 * to run five infinite GSAP tweens (an ambient photo drift, three fog layers, a cue bob) plus a
 * `pointermove` parallax driving six `quickTo` tweens across two nested transform planes. All
 * motion is now CSS keyframes on `transform`/`opacity` only — see `.hero-light`, `.hero-cue*` in
 * globals.css — which the compositor can run without waking the main thread.
 *
 * Why it mattered: a Chrome trace of a real session found every scrolling frame resolving on the
 * main thread (`scroll_state: SCROLL_MAIN_THREAD` on 1688 of 3426 frames) rather than the
 * compositor. Frames were not being dropped — only 2.1% were — they were arriving late, queued
 * behind main-thread work. Less main-thread work is therefore the whole fix, and the globe's
 * render loop (976ms of that trace, the largest single entry) is now paused while this beat
 * covers it; see HeroPoster.
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
  return (
    <section className="pointer-events-auto relative flex min-h-dvh flex-col items-center justify-center overflow-hidden p-5 text-center sm:p-6">
      {/* No scrim, matching DESIGN.md's landing-headline rule: nothing sits between the type and
          the photograph — hero-legible's own three-layer shadow carries legibility. */}
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

      <div>
        {/* Two phrases, not five words: DESIGN.md documents this block's stagger as 0 / 90 / 180ms
            and the third slot has never had an occupant. Splitting by phrase fills it exactly
            rather than inventing a longer per-word budget, and it stops "hour." being orphaned
            onto a line of its own. `inline-block` because a transform does nothing to an inline
            box. */}
        <h1 className="hero-legible font-scene-display text-[clamp(2.25rem,6.5vw,5rem)] italic leading-[1.05] text-on-deep">
          <span className="hero-rise inline-block">Somewhere,</span>{" "}
          <span className="hero-rise inline-block" style={{ animationDelay: "90ms" }}>
            it&rsquo;s the blue hour.
          </span>
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
          className="hero-rise hero-legible mx-auto mt-5 max-w-md text-balance text-base leading-relaxed text-on-deep sm:text-lg"
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
    </section>
  );
}
