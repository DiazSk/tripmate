/**
 * The two appearances, as data.
 *
 * **No `react-native` import, deliberately.** Everything here is pure — hex strings and three
 * small functions over them — which is what makes the contrast figures genuinely testable rather
 * than asserted by eye. `theme.ts` is where this becomes `Colors`.
 *
 * **Polar Interior, in two appearances under one set of names** — the system on the MagicPath
 * canvas, mapped role by role on "Polar — Token Mapping", and the same values the web carries in
 * `src/app/globals.css`. `Dark` is Polar Night; `Light` is Polar Light. Kiln's light appearance was
 * dark's two anchors swapped; Polar's is not — ice, paper and ink are the reference's own values,
 * and each role is measured on its own ground rather than mirrored.
 *
 * Two meanings moved. Action is signal orange and is a *fill*, with ink on it in both appearances;
 * set as text on a light ground it measures 2.55:1, so text that means "action" takes
 * `accentText`. And money has no hue: a figure is ink or white, carried by the figure face.
 */

export interface Palette {
  canvas: string;
  surfaceDeep: string;
  panel: string;
  control: string;
  bar: string;
  pressed: string;
  foreground: string;
  muted: string;
  cardBorder: string;
  /**
   * **Text over any dark surface — a photo scrim, the map, a badge on an image.**
   *
   * The web has carried `--foreground` and `--on-deep` as two tokens all along and `theme.ts`
   * folded them into one, because today they are the same hex. Under a light appearance they
   * stop being: about eight references across five files would set near-black ink on a dark
   * badge. `onDeep` does not move between appearances, and that is the whole point of it.
   */
  onDeep: string;
  onDeepMuted: string;
  /** Also appearance-invariant: it is a border drawn on a photograph, not on a page. */
  photoBorder: string;
  accent: string;
  /**
   * The ink drawn ON the action fill: Polar ink on signal, 5.6:1, in both appearances.
   *
   * **The rule is the relationship, not the polarity.** Under Kiln the light appearance darkened
   * the fill and had to flip this ink to a near-white; Polar keeps one fill and one ink, because
   * signal is light enough to carry dark type on paper and on night alike.
   */
  accentForeground: string;
  accentWash: string;
  /**
   * **Action set as text** — a selected label, a link, a glyph that means "do this".
   *
   * Night can use the fill itself (7.73:1). Light cannot: signal on ice is 2.55:1, so the light
   * appearance deepens it to ember, the reference's #B4530A taken one step darker to clear AA on
   * paper as well as ice.
   */
  accentText: string;
  money: string;
  /**
   * **`moneySoft` is a fill, not a state tint**, which is why it ships heavier than the others
   * in both appearances and why the two-signal ceiling never governed it.
   */
  moneySoft: string;
  alert: string;
  alertSoft: string;
}

export const Dark: Palette = {
  canvas: '#090B10',
  surfaceDeep: '#0E1118',
  // Polar's deep at Kiln's alphas: one slate per appearance, so the glass reads as one material.
  panel: '#0E11189E',
  control: '#0E11188C',
  bar: '#0E1118B8',
  pressed: '#0E1118D1',

  foreground: '#FFFFFF',
  // night-text-2: a solid grey, as the reference sets every secondary line on night.
  muted: '#A8ACB3',
  // frost-20.
  cardBorder: '#FFFFFF33',

  onDeep: '#FFFFFF',
  onDeepMuted: '#FFFFFF9E',
  photoBorder: '#FFFFFF24',

  accent: '#FF7E15',
  accentForeground: '#1F2A44',
  accentWash: '#FF7E151F',
  accentText: '#FF7E15',
  money: '#FFFFFF',
  moneySoft: '#FFFFFF24',
  alert: '#FF6B6B',
  alertSoft: '#FF6B6B1F',
};

export const Light: Palette = {
  canvas: '#FFFFFF',
  // Paper: opaque, the reference's one step in from ice.
  surfaceDeep: '#F3F1EC',
  // Ink veils, the reference's glass on light, at Kiln's light steps: 3.5% / 2.7% / 3.9% / 4.7%.
  panel: '#1F2A4409',
  control: '#1F2A4407',
  bar: '#1F2A440A',
  pressed: '#1F2A440C',

  foreground: '#1F2A44',
  // Charcoal, not ink at an alpha: ink at 62% is 4.24:1 on ice and fails.
  muted: '#535353',
  // The rule: ink at 12%.
  cardBorder: '#1F2A441F',

  onDeep: '#FFFFFF',
  onDeepMuted: '#FFFFFF9E',
  photoBorder: '#FFFFFF24',

  // The same fill as night, with the same ink on it (5.6:1).
  accent: '#FF7E15',
  accentForeground: '#1F2A44',
  accentWash: '#FF7E1521',
  accentText: '#A64C09',
  money: '#1F2A44',
  moneySoft: '#1F2A441A',
  alert: '#D10F0F',
  alertSoft: '#D10F0F14',
};

/**
 * The one mark whose colour is fixed against the map rather than against the page.
 *
 * **The group started larger and most of it turned out to be wrong.** It also held an opaque
 * surface and a bar, on the reasoning that the map does not change appearance — which was a
 * confusion of two different things DESIGN.md says. The *route palette* is outside the interface
 * palette, because those hues were chosen against terrain; the *basemap* is not, and a dark map
 * inside a paper app is the `--postcard-paper` failure with the polarity swapped. `day-map.tsx`
 * follows the appearance now, so its two overlays are ordinary surfaces again and those two
 * tokens are deleted.
 *
 * What survives is the thing that is genuinely map-native: the emphasised stop disc. It is the
 * one mark that borrows the action colour, and `DiscInk` is measured against the lightness of
 * the four day cores it stands beside — which do not move. It was split out when Kiln's light
 * appearance darkened the accent until near-black ink on it measured 2.49:1; under Polar both
 * appearances share the signal fill, so today the two values agree.
 *
 * The ink half of "over a photograph" lives in the palette as `onDeep` / `onDeepMuted`, because
 * `ThemedText` takes a `ThemeColor` and a text colour has to be one.
 *
 * **`money` joined it the same way the disc did: by failing on the device.** The stop card draws
 * a cost on glass over imagery, and `Colors.money` under the light appearance is ink — correct on
 * paper, invisible on dark glass over a city. Same shape of mistake as the disc, same answer: the
 * figure is standing on the map, so it takes the map's value, white.
 */
export const OverPhotograph = {
  // Polar's action fill is the same in both appearances, so the disc no longer needs a cut of its
  // own. It stays a separate token because the disc is a map mark, and the map does not follow
  // the page.
  accentDisc: '#FF7E15',
  money: '#FFFFFF',
} as const;

/**
 * Ink drawn on a day disc. Near-black at 92%, from the Swift app's `discInk`.
 *
 * Map-native and appearance-invariant, like the five day cores it is measured against — it
 * lives here rather than in `theme.ts` so the assertion that keeps it honest can reach it
 * without pulling in `react-native`.
 */
export const DiscInk = '#12110FEB';

/**
 * Parked, unused, and one line from being live.
 *
 * The photograph stays dark in both appearances — that is the fourth review's own thesis ("dark
 * for atmosphere") rendered literally, and it costs nothing. If the deliberately-dark mastheads
 * read as a second visual language inside a light app, this is the number that fixes it: 0.34
 * measures 7.01:1 for dark ink against the worst pixel destination photography produces, where
 * 0.58 reaches only 2.05:1 for paper ink.
 */
export const PhotoScrimLight = 0.34;

const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);

/** sRGB relative luminance, WCAG 2.x. */
export function luminance(hex: string): number {
  const part = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * part(channel(hex, 1)) + 0.7152 * part(channel(hex, 3)) + 0.0722 * part(channel(hex, 5))
  );
}

/** WCAG contrast ratio, 1–21. Order does not matter. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * CIE L\*, 0–100.
 *
 * The tint ceiling is stated in this rather than in alpha or in a contrast ratio, because it is
 * a *perceptual step* and neither of the others survives a change of ground: the same alpha over
 * paper is a far bigger step than over near-black, and a ratio says nothing about how far apart
 * two adjacent surfaces look.
 */
export function lightness(hex: string): number {
  const y = luminance(hex);
  return y > 216 / 24389 ? 116 * y ** (1 / 3) - 16 : (y * 24389) / 27;
}

/** What the compositor actually shows: `fg` at `alpha` over `bg`, as an opaque hex. */
export function composite(fg: string, alpha: number, bg: string): string {
  const mix = (at: number) =>
    Math.round(channel(fg, at) * alpha + channel(bg, at) * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(1)}${mix(3)}${mix(5)}`.toUpperCase();
}
