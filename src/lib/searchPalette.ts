import type { PlaceCategory } from "./placeSearch";

/**
 * The colours search results are drawn in, and the proof that they cannot be mistaken for a day.
 *
 * Multi-select turned pin colour into information. With one category at a time the accent alone
 * said everything — every pin was the same kind of thing. With cafés, food and bars on screen at
 * once, the colour *is* the category, and it has to survive two collisions:
 *
 * 1. **Against the days.** The trip's own routes and stops cycle five `--route-neon-*` colours. A
 *    search pin that lands near one of those reads as "this is already in the plan", which is the
 *    single most misleading thing this layer could say.
 * 2. **Against each other.** Six categories plus free text is seven simultaneous colours, which is
 *    at the top of what anybody can hold — so the separation between them has to be real rather
 *    than nominal.
 *
 * Both are **asserted in `searchPalette.test.mjs`** against a perceptual distance in OKLab, not
 * eyeballed and not argued from hue numbers. Hue alone is a bad guide here: the day palette is
 * deliberately muted (see the "calm the day palette" work) and these are deliberately vivid, so
 * two colours can share a hue and still be unmistakable — and two can differ in hue and still
 * collide once lightness and chroma are accounted for. If you change a colour on either side, the
 * test is what tells you whether you got away with it.
 *
 * The vividness is itself a second channel doing the same job: the days are the quiet layer this
 * app looks at for minutes at a time, and a search is a loud, temporary question over the top of
 * it. Even for a viewer who cannot separate two hues, "saturated" versus "muted" still reads.
 *
 * **Blue is missing, and its absence is a result rather than an oversight.** A museum ought to be
 * blue and cannot be: `--route-neon-cyan-glow` sits at hue 205 and `--route-neon-violet` at 245,
 * and a search across every saturation and lightness in the band between them found nothing that
 * clears the threshold against both. Turquoise is what is left on that side of the wheel, and it
 * only clears by being far lighter and far more saturated than the muted teal the days use. If the
 * day palette is ever re-tuned away from cyan, blue opens up again.
 */

/** The trip's five day colours, copied from `--route-neon-*` in `globals.css`.
 *
 *  Duplicated rather than read from CSS on purpose: this has to be checkable from a `.test.mjs`,
 *  which has no DOM and no stylesheet. The test's job is precisely to catch the two drifting
 *  apart — if a day colour changes in CSS and not here, the separation it asserts is a fiction. */
export const DAY_COLOURS_HEX = [
  "#3d9ab8", // cyan
  "#5fa8d6", // cyan glow
  "#b563a6", // magenta
  "#8a6bc4", // magenta glow
  "#c97544", // amber
  "#be4f70", // amber glow
  "#3fa37a", // lime
  "#4fb8a0", // lime glow
  "#7c74c2", // violet
  "#c0a9d6", // violet glow
] as const;

/**
 * Category → pin colour.
 *
 * `place` is the free-text bucket — a result that matched by name rather than by category. It gets
 * the one near-neutral in the set, deliberately: "what you typed" is a different *kind* of answer
 * from "things of this type near here", and a seventh saturated hue would have said it was just
 * another category.
 */
export const SEARCH_COLOURS: Record<PlaceCategory, string> = {
  restaurant: "#ff3b30", // red
  cafe: "#ff9f1a", // amber
  shop: "#ffe14d", // yellow
  park: "#35e06a", // green
  museum: "#19f0d8", // turquoise
  bar: "#ff45d0", // magenta
  place: "#f1f5f9", // free text — the one near-neutral, see above
};

/** The colour a result is drawn in. Falls back to the free-text neutral for anything unrecognised,
 *  which a provider is entitled to hand back. */
export function searchColourFor(category: string | undefined): string {
  return SEARCH_COLOURS[category as PlaceCategory] ?? SEARCH_COLOURS.place;
}

// --- perceptual distance -------------------------------------------------------------------------

/** `#rrggbb` → linear-light RGB in 0..1. */
function srgbToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  const to = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [to((n >> 16) & 255), to((n >> 8) & 255), to(n & 255)];
}

/**
 * sRGB hex → OKLab.
 *
 * Björn Ottosson's matrices, unmodified. OKLab rather than plain RGB distance because RGB distance
 * is not perceptual in the least — pure blue and black are far apart in RGB and nearly
 * indistinguishable on a map at pin size, which is exactly the failure this guards against.
 */
export function oklab(hex: string): [number, number, number] {
  const [r, g, b] = srgbToLinear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.629978687 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Euclidean distance in OKLab — "ΔEok". Roughly, 0.02 is a just-noticeable difference on a large
 *  flat area, and small marks on a busy map need considerably more than that. */
export function colourDistance(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * The distance two colours must clear to count as separate here.
 *
 * Set from what the marks actually are: 6–10px dots on photography and vector tiles, read at a
 * glance and often only a few pixels apart. That is a much harder viewing condition than two
 * swatches side by side, so the threshold is far above a just-noticeable difference.
 */
export const MIN_COLOUR_DISTANCE = 0.12;
