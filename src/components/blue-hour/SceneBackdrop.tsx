"use client";

import { getImageProps } from "next/image";

/**
 * The photograph the trip form stands on.
 *
 * Between the landing hero and the generation screen, the wizard had nothing behind it. The globe
 * is deliberately un-booted for these steps (`useGlobeOnScreen(generating || step === "result")` in
 * HomeView) and `.blue-hour-scene` is scoped to the landing alone, so four consecutive screens —
 * the busiest, most decision-heavy part of the product — rendered as glass panels floating on flat
 * `--canvas`. Glass with nothing behind it is just a grey box with a hairline.
 *
 * This is the same image `GenerationScreen` falls back to, and that is the whole point: the
 * backdrop is established when the traveller opens the form and does not change again until their
 * plan appears. Every step swaps the panel in front of it and nothing else, so the handoff into
 * generation has no visual seam at all — the screen they wait on is the screen they were already
 * looking at.
 *
 * Rendered as a sibling *behind* the form rather than as a CSS background on it, for two reasons:
 * `backdrop-filter` on the panels needs a real painted layer beneath them to sample, and a
 * `<picture>` is the only way to art-direct the crop.
 */

/** Landscape and portrait crops, switched on the same 3/5 aspect ratio the hero uses — one
 *  threshold in the codebase rather than two. Intrinsics must be the files' true dimensions:
 *  `getImageProps` builds the srcset from this ratio, and a wrong pair stretches the horizon. */
const SCENE = {
  landscape: { src: "/scenes/scenic-cloudy-background.webp", width: 2880, height: 1726 },
  portrait: { src: "/scenes/mobile-scenic-cloudy-background.webp", width: 750, height: 1714 },
};

export default function SceneBackdrop() {
  // No `fill` here, and that is not an oversight. `fill` and `width`/`height` are mutually
  // exclusive — passing both is a *runtime* error next/image throws on render, which no amount of
  // typechecking catches because each is individually valid. The intrinsics have to be the ones
  // that survive, since `getImageProps` needs them to build the srcset; the element is stretched
  // to the viewport by `h-full w-full object-cover` below instead.
  const common = { alt: "", sizes: "100vw" } as const;
  const { props: landscapeProps } = getImageProps({ ...common, ...SCENE.landscape });
  const { props: portraitProps } = getImageProps({ ...common, ...SCENE.portrait });
  const { srcSet: landscapeSrcSet } = landscapeProps;
  const { srcSet: portraitSrcSet, ...rest } = portraitProps;

  return (
    <div
      aria-hidden
      // `fixed`, not `absolute`. The form column scrolls and is taller than the viewport on the
      // interests step; an absolutely-positioned backdrop would scroll away and strand the last
      // fields on bare canvas — which is the bug this component exists to fix, reintroduced
      // halfway down the page. Behind the content overlay, above AppShell's canvas.
      className="pointer-events-none fixed inset-0 -z-10"
    >
      <picture>
        <source media="(min-aspect-ratio: 3/5)" srcSet={landscapeSrcSet} sizes="100vw" />
        <source srcSet={portraitSrcSet} sizes="100vw" />
        {/* eslint-disable-next-line jsx-a11y/alt-text -- `alt=""` arrives through {...rest}; the
            wrapper is already aria-hidden and this image is decorative. */}
        <img {...rest} className="absolute inset-0 h-full w-full object-cover" />
      </picture>
      {/*
        The dimming, and it is heavier than the one GenerationScreen wears over the same file.
        That screen sets display-size type over the photograph and wants it seen; this one carries
        input labels, date fields and a budget figure at 12-16px, and those have to clear contrast
        against whatever pixel lands behind them. The panels supply their own translucent ground on
        top of this, so the photograph reads as weather behind frosted glass rather than as a
        picture someone put text on.

        Stronger at top and bottom than through the middle: the navbar and the step's primary
        action sit in those bands, and both are small type. Authored as a gradient on
        `--surface-deep-rgb` — the same token the itinerary header band and every other photo scrim
        in this app uses, so this is one more instance of an existing material, not a new one.
      */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgb(var(--surface-deep-rgb) / 0.86) 0%, rgb(var(--surface-deep-rgb) / 0.52) 24%, rgb(var(--surface-deep-rgb) / 0.34) 52%, rgb(var(--surface-deep-rgb) / 0.5) 80%, rgb(var(--surface-deep-rgb) / 0.82) 100%)",
        }}
      />
    </div>
  );
}
