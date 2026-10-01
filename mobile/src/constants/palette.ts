/**
 * The two appearances, as data.
 *
 * **No `react-native` import, deliberately.** Everything here is pure — hex strings and three
 * small functions over them — which is what makes the contrast figures genuinely testable rather
 * than asserted by eye. `theme.ts` is where this becomes `Colors`.
 *
 * **The light appearance is the dark one's two anchors swapped, not a second design.** Paper is
 * dark's `foreground`; ink is dark's `canvas`. Every surface is still the one slate `#1C1A18`,
 * at an alpha ramp mirrored by *perceptual step* rather than by alpha — mirroring the alpha
 * would put a 62% slate over paper, which is a dark grey card rather than a surface one step in.
 * The three roles keep their meaning and their hue; only their lightness moves, because jade,
 * gold and coral as shipped measure 2.15, 1.62 and 3.17 against paper and none of them is
 * readable.
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
   * The ink drawn ON a jade fill.
   *
   * **The rule is the relationship, not the polarity.** In dark this is near-black on jade; in
   * light it has to go the other way, and it must not simply be paper — paper-coloured letters
   * on a jade fill standing on a paper canvas are letters the colour of the page behind them.
   * So it is a jade-tinted near-white: the fill's own hue, carried into its ink.
   */
  accentForeground: string;
  accentWash: string;
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
  canvas: '#121110',
  surfaceDeep: '#1C1A18',
  panel: '#1C1A189E',
  control: '#1C1A188C',
  bar: '#1C1A18B8',
  pressed: '#1C1A18D1',

  foreground: '#F7F5F2',
  muted: '#F7F5F29E',
  cardBorder: '#FFFFFF1F',

  onDeep: '#F7F5F2',
  onDeepMuted: '#F7F5F29E',
  photoBorder: '#FFFFFF24',

  accent: '#28B981',
  accentForeground: '#06241A',
  accentWash: '#28B98117',

  money: '#E9B44C',
  moneySoft: '#E9B44C2E',

  alert: '#E4553F',
  alertSoft: '#E4553F29',
};

export const Light: Palette = {
  canvas: '#F7F5F2',
  // Opaque, like dark's, and the furthest step from the ground — a capsule standing on a card
  // needs a fill that does not composite back into what it stands on.
  surfaceDeep: '#EBE9E6',
  // 3.5% / 2.7% / 3.9% / 4.7%. Effectively opaque over paper, which is the "warm opaque
  // surfaces" the fourth review asked for, arrived at without leaving One Slate.
  panel: '#1C1A1809',
  control: '#1C1A1807',
  bar: '#1C1A180A',
  pressed: '#1C1A180C',

  foreground: '#121110',
  // The ink at 62%, the same discipline Muted Paper uses: an alpha rather than a sampled grey,
  // so it stays correct on every surface step instead of being tuned for one.
  muted: '#1211109E',
  // Black at 12%, dark's white-at-12% mirrored.
  cardBorder: '#0000001F',

  onDeep: '#F7F5F2',
  onDeepMuted: '#F7F5F29E',
  photoBorder: '#FFFFFF24',

  // Darkened cuts, hues intact: 157.2° / 38.4° / 8.8° against dark's 156.8° / 39.7° / 8.0°.
  // Jade stays inside `ACCENT_HUE_BAND`, so nothing the map does is affected.
  accent: '#245E48',
  accentForeground: '#EAFAF4',
  money: '#886019',
  alert: '#AE3F2C',

  // **The tints keep the shipped hex and take a new alpha**, so "no new accent colours" holds
  // literally. Over paper the bright role reads as a wash exactly as the bright role over
  // near-black does; what changes is how much of it is needed.
  accentWash: '#28B9812D',
  moneySoft: '#E9B44C5A',
  alertSoft: '#E4553F2F',
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
 * the four day cores it stands beside — which do not move. Under the light appearance
 * `Colors.accent` darkens to `#245E48` and near-black ink on it measures **2.49:1**, against
 * 7.50 in dark: a number on a pin nobody can read.
 *
 * The ink half of "over a photograph" lives in the palette as `onDeep` / `onDeepMuted`, because
 * `ThemedText` takes a `ThemeColor` and a text colour has to be one.
 *
 * **`money` joined it the same way the disc did: by failing on the device.** The stop card draws
 * a cost on glass over imagery, and `Colors.money` under the light appearance is `#886019`, a
 * cut darkened until it reads on paper. On a dark card it is an olive smudge. Same shape of
 * mistake as the disc, same answer — the figure is standing on the map, so it takes the map's
 * value, which is the bright cut both appearances started from.
 */
export const OverPhotograph = {
  accentDisc: '#28B981',
  money: '#E9B44C',
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
