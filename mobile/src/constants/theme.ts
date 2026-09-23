/**
 * The Kiln, as it reaches React Native.
 *
 * Transcribed from `DESIGN.md` (repo root) via `ios/TripMate/TripMate/Shell/DesignTokens.swift`,
 * which is the same system's proven port to a native mobile platform. When this file disagrees
 * with DESIGN.md, this file is the bug.
 *
 * **There is no light theme, and that is the design rather than an omission.** Kiln is a single
 * warm near-black ground; DESIGN.md describes no light variant, and the Darken-Never-Lighten rule
 * assumes there is only one. `app.json` pins `userInterfaceStyle: "dark"` so the platform chrome
 * agrees with it.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Alpha slates are precomputed 8-digit hex rather than a `withAlpha()` helper.
 *
 * RN parses `#RRGGBBAA` natively, and the whole system uses five alphas — a runtime call per
 * style to avoid five string constants is a worse trade. The One Slate Rule says every panel,
 * pill, badge and scrim is this one colour at some alpha; it never becomes a second grey.
 */
export const Colors = {
  canvas: '#121110',
  /** The one slate, opaque. rgb(28,26,24). */
  surfaceDeep: '#1C1A18',
  /** 0.62 — panels, cards, sheets. The Swift app's `panelOpacity`. */
  panel: '#1C1A189E',
  /** 0.55 — control pills floating over photography. */
  control: '#1C1A188C',
  /** 0.72 — nav and tab bars. */
  bar: '#1C1A18B8',
  /** 0.82 — the darken-on-press step. Never lighten; see the Darken-Never-Lighten rule. */
  pressed: '#1C1A18D1',

  /** Warm paper. Body text everywhere, and text over any dark surface. */
  foreground: '#F7F5F2',
  /** Paper at 62%, built as an alpha rather than a sampled grey so it stays correct on every
   *  surface alpha instead of being tuned for one. */
  muted: '#F7F5F29E',
  /** White at 12%. Every divider, panel edge and drawn rule. */
  cardBorder: '#FFFFFF1F',
  /** White at 14%, for a border inset over photography, where 12% disappears. */
  photoBorder: '#FFFFFF24',

  /** Kiln Jade — action, and only action. Never a label, never a figure. */
  accent: '#28B981',
  /** Dark ink drawn ON jade. Not interchangeable with `foreground`; conflating the two
   *  foregrounds is the specific bug this palette was rebuilt to fix. */
  accentForeground: '#06241A',
  /** Jade at 9%, the emphasised-row wash. */
  accentWash: '#28B98117',

  /** Kiln Gold — money, and only money. A figure is information, not an invitation. */
  money: '#E9B44C',
  moneySoft: '#E9B44C2E',

  /** Ember Coral — over-plan and failure. */
  alert: '#E4553F',
  alertSoft: '#E4553F29',
} as const;

export type ThemeColor = keyof typeof Colors;

/**
 * Round what you touch, square what you read.
 *
 * No 16 here on purpose: DESIGN.md records the 16px panels as a "Radius Drift" — incumbents the
 * web retokenization deliberately left alone. A greenfield app has no incumbents, so new surfaces
 * take 5–8px or tighter.
 */
export const Radius = {
  /** Anything pressed or dragged. */
  pill: 9999,
  /** Panels and cards. */
  surface: 8,
  /** Anything read — rows, photos inside a card. */
  read: 6,
  tight: 4,
} as const;

export const Spacing = {
  hair: 4,
  tight: 8,
  /** `gapRows` — between rows in a list. */
  rows: 12,
  read: 16,
  /** `padCompact` — a panel's own inset. */
  compact: 20,
  /** `padRegular` / `gapPanels`. */
  regular: 24,
} as const;

export const BarHeight = 56;
export const MaxContentWidth = 800;

/**
 * The route's own colours, from `RouteGeometry.palette` — map-native, and deliberately outside
 * the interface palette. DESIGN.md: these must never appear in a panel, chip or button, because
 * the map gets its own colours on the grounds that it is photography rather than a surface.
 *
 * **The numbered stop disc is the one documented crossing, and it is not a violation.** The disc
 * in a day's list is the same mark as the disc on the map; carrying the day's own hue across is
 * what makes the two agree about which stop is which. It is identity, not chrome.
 *
 * `core` only — `glow` is too pale to carry ink.
 */
export const RouteDayCore = ['#4E8C99', '#A46E93', '#C4784B', '#7E9C5E', '#7B77AE'] as const;

export const dayCore = (dayIndex: number) =>
  RouteDayCore[((dayIndex % RouteDayCore.length) + RouteDayCore.length) % RouteDayCore.length];

/**
 * The pale half of each day's pair, for the halo under a route line.
 *
 * `RouteDayCore` above says "core only — glow is too pale to carry ink", and that is a rule about
 * *ink*: a numeral on one of these would not meet contrast. A stroke is not ink. The map draws a
 * day's route as a thin core inside a soft spill, and using the core colour for both would make
 * the spill darker than the line it spills from, which inverts the whole effect.
 *
 * Transcribed from `ios/TripMateKit/Sources/TripMateKit/RouteGeometry.swift:76-82`.
 */
export const RouteDayGlow = ['#7FB3BD', '#C596B6', '#DFA079', '#A6BF89', '#A6A2D0'] as const;

export const dayGlow = (dayIndex: number) =>
  RouteDayGlow[((dayIndex % RouteDayGlow.length) + RouteDayGlow.length) % RouteDayGlow.length];

/** Ink drawn on a day disc. Near-black at 92%, from the Swift app's `discInk`. */
export const DiscInk = '#12110FEB';

/** The scrim over a day masthead. Measured, not picked — see the Photograph-Is-Not-A-Surface
 *  rule: destination photography ranges to 0.947 mean luminance, where white body text is
 *  2.41:1 under a 60% scrim. Large type only above this. */
export const PhotoScrim = 0.58;

export const Fonts = {
  /**
   * Each bundled weight is registered as its OWN family, and that is load-bearing on Android.
   *
   * `expo-font`'s runtime loader calls `ReactFontManager.setTypeface(family, NORMAL, tf)`, which
   * lands in the `fontCache` branch — and that branch resolves weight through `nearestStyle`,
   * collapsing every request into NORMAL (<700) or BOLD (>=700). So two weights of one family
   * render identically and a 700 request falls through to Roboto, both silently. Giving each cut
   * its own family name means no weight selection ever happens. Never pair these with
   * `fontWeight`.
   */
  display: 'Melodrama-Regular',
  money: 'Tabular-Medium',
  moneyBold: 'Tabular-SemiBold',

  /** The system sans carries all body and UI text. That is what buys Dynamic Type on iOS and
   *  font scaling on Android — see DESIGN.md's third boundary. */
  ...(Platform.select({
    ios: { sans: 'system-ui', mono: 'ui-monospace' },
    default: { sans: 'normal', mono: 'monospace' },
    // `--font-display` is this scaffold's *sans* stack (Spline Sans, Inter, …), despite the
    // name — see src/global.css. There is no `--font-sans`, and asking for one silently falls
    // back to the browser default serif, which makes every body string on web the wrong face.
    web: { sans: 'var(--font-display)', mono: 'var(--font-mono)' },
  }) as { sans: string; mono: string }),
} as const;
