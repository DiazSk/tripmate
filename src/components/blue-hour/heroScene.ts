/**
 * The landing hero's photographic composition, shared with anything else that has to stand on it.
 *
 * Extracted when `SceneBackdrop` began carrying the same scene behind the trip form. These three
 * values are load-bearing in ways a second copy would not survive — the intrinsics feed
 * `getImageProps`' srcset maths, and `LAYER_WIDTH` encodes two separate hard-won layout fixes — so
 * they live once and are imported, rather than duplicated with a comment asking the next person to
 * keep them in sync.
 */

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
export const BACK = {
  landscape: { src: "/scenes/hero-background-1.webp", width: 2899, height: 1086 },
  portrait: { src: "/scenes/mobile-hero-background-1.webp", width: 750, height: 1363 },
};
export const FRONT = {
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
 *  **And they have to be genuinely exclusive, which `min-`/`max-` are not.** Both prefixes are
 *  *inclusive*, so a `min-aspect-ratio: 3/5` and a `max-aspect-ratio: 3/5` query both match at
 *  exactly 3:5 — and there the arrangement above degenerates into precisely the sorted-group race it
 *  was written to avoid, per property, silently. Measured at 375×625 before this was fixed: the CTA
 *  took its portrait `width` (335px, full-bleed) while keeping landscape `position` and `z-index`
 *  (`relative`, 4), so it floated 186px above the bottom of a hero it was supposed to be pinned to.
 *  375×624 and 375×626 were each individually correct, which is what made it invisible. Range syntax
 *  (`aspect-ratio<=3/5` / `aspect-ratio>3/5`) has no shared value, and it is the idiom `globals.css`
 *  already uses for width. Portrait owns the boundary, including the two `<picture>` sources, so the
 *  crop and the layout agree about which branch that one viewport is in.
 *
 *  `max-w-none` is load-bearing too. Tailwind's Preflight sets `img { max-width: 100% }`, which
 *  silently clamped the widened layer straight back to 100% and left the right edge 4px short at
 *  2560. Preflight is a set of opinions that outrank what you wrote, not a neutral reset — the same
 *  lesson as The Preflight-Beats-The-UA Rule. The reference hits this too and answers it the same
 *  way, with an explicit `max-width: calc(100% + 8px)`. */
export const LAYER_WIDTH =
  "max-w-none [@media(aspect-ratio<=3/5)]:w-full [@media(aspect-ratio>3/5)]:w-[100.65%] [@media(aspect-ratio>3/5)]:-left-[0.17%]";
