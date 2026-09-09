"use client";

import Image from "next/image";
import { HERO_PHOTO } from "./heroScene";

/**
 * The landing hero's photograph, carried behind the trip form.
 *
 * Between the hero and the generation screen, the wizard had nothing behind it. The globe is
 * deliberately un-booted for those steps (`useGlobeOnScreen(generating || step === "result")` in
 * HomeView) and `.blue-hour-scene` is scoped to the landing alone, so the four most decision-heavy
 * screens in the product rendered as glass panels on flat `--canvas`. Glass with nothing behind it
 * is a grey box with a hairline.
 *
 * **It is the same photograph, not a matching one.** Pressing "Plan it" should feel like the page
 * dimming and a panel rising on it, not like a cut to somewhere else — the traveller is standing in
 * the same place they were a moment ago, deciding where to go. An unrelated image here (this
 * component shipped with one) reads as a scene change and quietly costs the flow its continuity,
 * which is the whole reason the hero is a photograph rather than a gradient.
 *
 * Rendered as a sibling *behind* the form rather than as a CSS background on it, because
 * `backdrop-filter` on the panels needs a real painted layer beneath them to sample.
 *
 * **The geometry collapsed with the hero's.** This used to reconstruct the hero's two-layer
 * interlock by hand: a container whose aspect ratio matched the hero's, sized
 * `w-[max(100vw,calc(100dvh*1440/922))]` so a tall window widened the scene rather than opening a
 * seam above the mountains, with both alpha-cut layers and the same -0.4vw nudge under the front
 * one. Every line of that existed to make two images meet. `object-cover` on one image is the same
 * intent — fill an unknown rectangle, crop rather than gap — expressed in the property built for
 * it, and it stays correct at ratios the hand-built version had to be measured at.
 */
export default function SceneBackdrop() {
  return (
    <div
      aria-hidden
      // `fixed`, not `absolute`. The preferences step is taller than the viewport, and an absolute
      // backdrop scrolls away and strands the last fields on bare canvas — the exact bug this
      // component exists to fix, reintroduced halfway down the page.
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* `priority` deliberately absent, unlike Hero's. This mounts after a click, on a screen the
          traveller is already reading — it must not compete with the form's own work for
          bandwidth, and the file is in cache from the landing anyway. */}
      <Image src={HERO_PHOTO.src} alt="" fill sizes="100vw" className="hero-photo object-cover" />

      {/*
        The dimming — the "opacity decreases" half of the effect. The hero wears this photograph at
        full strength behind display type; this screen carries 12-16px field labels, and those have
        to clear contrast against whatever pixel lands behind them. The panels supply their own
        translucent ground on top, so the photograph reads as weather behind frosted glass rather
        than as a picture someone put a form on.

        Heavier at top and bottom than through the middle: the navbar and the step's primary action
        live in those bands and both are small type, while the middle is where the photograph
        actually is. Authored on `--surface-deep-rgb`, the same token every other photo scrim in
        this app uses, so this is one more instance of an existing material.
      */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgb(var(--surface-deep-rgb) / 0.86) 0%, rgb(var(--surface-deep-rgb) / 0.6) 24%, rgb(var(--surface-deep-rgb) / 0.46) 52%, rgb(var(--surface-deep-rgb) / 0.6) 80%, rgb(var(--surface-deep-rgb) / 0.88) 100%)",
        }}
      />
    </div>
  );
}
