"use client";

import { getImageProps } from "next/image";
import { BACK, FRONT, LAYER_WIDTH } from "./heroScene";

/**
 * The landing hero's photograph, carried behind the trip form.
 *
 * Between the hero and the generation screen, the wizard had nothing behind it. The globe is
 * deliberately un-booted for those steps (`useGlobeOnScreen(generating || step === "result")` in
 * HomeView) and `.blue-hour-scene` is scoped to the landing alone, so the four most decision-heavy
 * screens in the product rendered as glass panels on flat `--canvas`. Glass with nothing behind it
 * is a grey box with a hairline.
 *
 * **It is the same photograph, not a matching one.** Pressing "Plan a trip" should feel like the
 * page dimming and a panel rising on it, not like a cut to somewhere else — the traveller is
 * standing in the same place they were a moment ago, deciding where to go. An unrelated image here
 * (this component shipped with one) reads as a scene change and quietly costs the flow its
 * continuity, which is the whole reason the hero is a photograph rather than a gradient.
 *
 * Rendered as a sibling *behind* the form rather than as a CSS background on it, for two reasons:
 * `backdrop-filter` on the panels needs a real painted layer beneath them to sample, and a
 * `<picture>` is the only way to art-direct the crop.
 */
export default function SceneBackdrop() {
  // `priority` deliberately absent, unlike Hero's. This mounts after a click, on a screen the
  // traveller is already reading — it must not compete with the form's own work for bandwidth, and
  // both files are in cache from the landing anyway.
  const common = { alt: "", sizes: "100vw" } as const;
  const {
    props: { srcSet: backLandscape },
  } = getImageProps({ ...common, ...BACK.landscape });
  const {
    props: { srcSet: backPortrait, ...backRest },
  } = getImageProps({ ...common, ...BACK.portrait });
  const {
    props: { srcSet: frontLandscape },
  } = getImageProps({ ...common, ...FRONT.landscape });
  const {
    props: { srcSet: frontPortrait, ...frontRest },
  } = getImageProps({ ...common, ...FRONT.portrait });

  return (
    <div
      aria-hidden
      // `fixed`, not `absolute`. The preferences step is taller than the viewport, and an absolute
      // backdrop scrolls away and strands the last fields on bare canvas — the exact bug this
      // component exists to fix, reintroduced halfway down the page.
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/*
        The composition's own geometry, which is what keeps the two layers interlocked.

        BACK hangs from the top and FRONT stands on the bottom, and they overlap by a fixed fraction
        of the *width* — so their container's height has to follow its width, exactly as the hero's
        section does. Sizing this box to the viewport instead would pull them apart and open a band
        of bare canvas between the mountains and the steppe (Hero.tsx measured 378px of it at
        768x1024).

        `w-[max(100vw,…)]` is cover semantics applied to the composition rather than to either
        image: the box is always at least as wide as the viewport and at least tall enough to fill
        it, whichever binds, so a tall window widens the scene and overflows it sideways instead of
        leaving a seam of empty canvas above the mountains. Centred horizontally so that overflow is
        symmetric. The aspect ratios are the hero's own, switched on the same 3/5 threshold.
      */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 aspect-[1440/922] w-[max(100vw,calc(100dvh*1440/922))] [@media(aspect-ratio<=3/5)]:aspect-[375/812] [@media(aspect-ratio<=3/5)]:w-[max(100vw,calc(100dvh*375/812))]"
      >
        <picture>
          <source media="(aspect-ratio > 3/5)" srcSet={backLandscape} sizes="100vw" />
          <source srcSet={backPortrait} sizes="100vw" />
          {/* eslint-disable-next-line jsx-a11y/alt-text -- alt="" arrives via {...backRest}. */}
          <img {...backRest} className={`absolute top-0 left-0 h-auto ${LAYER_WIDTH}`} />
        </picture>
        <picture>
          <source media="(aspect-ratio > 3/5)" srcSet={frontLandscape} sizes="100vw" />
          <source srcSet={frontPortrait} sizes="100vw" />
          {/* The same -0.4vw nudge Hero gives this layer: the landscape file's own bottom margin
              otherwise shows as a hairline of canvas under the steppe.
              eslint-disable-next-line jsx-a11y/alt-text -- alt="" arrives via {...frontRest}. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img
            {...frontRest}
            className={`absolute bottom-0 left-0 h-auto ${LAYER_WIDTH} [@media(aspect-ratio>3/5)]:-bottom-[0.4vw]`}
          />
        </picture>
      </div>

      {/*
        The dimming — the "opacity decreases" half of the effect. The hero wears this photograph at
        full strength behind one word set at 13rem; this screen carries 12-16px field labels, and
        those have to clear contrast against whatever pixel lands behind them. The panels supply
        their own translucent ground on top, so the photograph reads as weather behind frosted glass
        rather than as a picture someone put a form on.

        Heavier at top and bottom than through the middle: the navbar and the step's primary action
        live in those bands and both are small type, while the middle is where the mountains and the
        steppe actually are. Authored on `--surface-deep-rgb`, the same token every other photo
        scrim in this app uses, so this is one more instance of an existing material.
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
