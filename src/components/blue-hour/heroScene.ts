/**
 * The landing hero's photograph, shared with anything else that has to stand on it.
 *
 * One image, and the collapse from four to one is the point. This file used to export `BACK`,
 * `FRONT` and `LAYER_WIDTH`: two interlocking alpha-cut photographs per orientation — a back layer
 * whose lower edge was torn away and a front layer with the sky removed entirely — plus a widening
 * hack to hide the transparent margins those files carried. The interlock produced a real effect
 * (the horizon cutting across the headline) at a real cost:
 *
 * - Four assets that could not be swapped without redoing the masking, so "use a different
 *   photograph" was an image-editing job rather than a one-line change.
 * - The alpha channel was load-bearing rather than an optimisation: a replacement shipped as JPEG
 *   arrived as white slabs where the removed regions should have been.
 * - `LAYER_WIDTH` carried four separately documented workarounds whose only job was keeping the
 *   two layers meeting: Tailwind's sorted-utility race between a base `w-full` and a variant
 *   width, `min-`/`max-` media queries both matching at exactly 3/5, Preflight's `img { max-width:
 *   100% }` clamping the widened layer, and an absolutely positioned replaced element taking its
 *   intrinsic width when given `width: auto`.
 * - And the composition could not use `min-h-dvh` at all, because two layers at natural size do
 *   not fill an arbitrary viewport — measured, it opened a 378px band of bare canvas at 768x1024.
 *
 * A single `object-cover` image has none of those properties. It crops to any viewport, needs no
 * alpha, and swapping the photograph is editing the line below.
 */
export const HERO_PHOTO = {
  /* Sourced deliberately away from the subject class the previous system's hero occupied. That was
     a cold blue-grey misty ridgeline — a mountain landscape, which is exactly the awwwards move the
     THESIS refuses and the same class of image the external reference used. This is a terracotta
     street in low sun with people walking in it: warm mid-tones that agree with the ground rather
     than fighting it, a human figure setting scale, sky reduced to a corner sliver, and a place
     somebody could be standing in rather than a view somebody photographed.
     Unsplash, licensed for commercial use with no attribution required. 2560x1920 source. */
  src: "/scenes/hero-street-goldenhour.webp",
  /* The crop itself lives in `.hero-photo` in globals.css rather than here, because it has to be
     viewport-dependent and this module is imported at module scope for `next/image`. See that rule
     for why one focus point cannot serve both a 2560 landscape frame and a 390 portrait one. */
} as const;
