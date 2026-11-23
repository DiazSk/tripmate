/**
 * The Kiln, as it reaches React Native.
 *
 * Transcribed from `DESIGN.md` (repo root) via the earlier SwiftUI client's design tokens, which
 * were the same system's proven port to a native mobile platform. When this file disagrees
 * with DESIGN.md, this file is the bug.
 *
 * **This file used to assert that there is no light theme and cite DESIGN.md for it.** DESIGN.md
 * did not contain that. "No light mode" existed in exactly one place — a line written into
 * a design board's review prompt for outside reviewers — so a code comment was the most
 * authoritative statement of a rule nobody had ratified, and it fenced three reviewers off a
 * live question. The same failure as last cycle's stop-disc comment.
 *
 * So there is a light appearance now, as a **token-level prototype behind a flag**, defaulting
 * to dark. It is total or it is nothing: `globals.css`'s `--postcard-paper` was an opaque cream
 * surface backing one route, and it was deleted because "a visitor crossed from dark translucent
 * slate to tilted cream stationery in a single click, and read it as a different application."
 * That is the strongest evidence in this repo on the subject and it argues against a *partial*
 * light appearance, not against a light one.
 *
 * `app.json` still pins `userInterfaceStyle: "dark"`, deliberately. Changing it would alter the
 * dark app's behaviour when the flag must ship inert, so under the light appearance the
 * keyboard, the native date picker, the tab bar's system materials and the **native** splash
 * stay dark. **A named gap in a prototype, not a bug** — closing it costs a prebuild and
 * belongs to a commitment rather than to a look.
 *
 * The splash is now only half a gap: the JS overlay that continues it follows `Colors.canvas`,
 * so the dark frame is the one the OS draws before any of this has loaded. `animated-icon.tsx`
 * carries the mechanism.
 */

import '@/global.css';

import { Platform } from 'react-native';

import { APPEARANCE } from '@/constants/appearance';
import { Dark, DiscInk, Light, OverPhotograph, type Palette } from '@/constants/palette';

/**
 * Alpha slates are precomputed 8-digit hex rather than a `withAlpha()` helper.
 *
 * RN parses `#RRGGBBAA` natively, and the whole system uses five alphas — a runtime call per
 * style to avoid five string constants is a worse trade. The One Slate Rule says every panel,
 * pill, badge and scrim is one colour at some alpha, and never becomes a second grey — one slate
 * per appearance under Polar: deep `#0E1118` on night, ink `#1F2A44` as a veil on light.
 *
 * **Selected once, at module load.** `Colors` stays a plain object, so none of the 184 call
 * sites and none of the 34 `StyleSheet.create` blocks know an appearance exists. See
 * `appearance.ts` for what that costs.
 */
export const Colors: Palette = APPEARANCE === 'light' ? Light : Dark;

export type ThemeColor = keyof Palette;

export { DiscInk, OverPhotograph };

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

/**
 * **The first shadow in this client, and it is a port rather than an invention.**
 *
 * DESIGN.md's Shadow Vocabulary names this exact case: *"**Control**
 * (`0 4px 16px 0 rgba(0,0,0,0.32)`): floating chrome over the globe."* The web separates floating
 * chrome with a material **and** a shadow; this port had dropped both, substituting an opaque fill
 * and a hairline, which is why the map's controls never read as floating. Measured against Apple
 * Maps on the same device: its buttons are translucent, blurred and shadowed, and the shadow is
 * what lifts them off the map.
 *
 * **The prohibition is on a *hard offset* shadow, not on shadow.** DESIGN.md states it three
 * times — "every one of them is soft and non-directional", "no lift, no glow, no shadow growth",
 * "don't use a hard offset shadow" — and all five vocabulary entries are large-radius blurs with
 * zero spread. This is one of those.
 *
 * `elevation` is Android's only shadow control and takes no colour, offset or radius, so the two
 * platforms agree on intent rather than on rendering.
 */
export const ControlShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.32,
  shadowRadius: 16,
  elevation: 6,
} as const;

/**
 * The Shadow Vocabulary's **Object on the map**: `0 2px 10px rgb(0 0 0 / 0.55)` plus a 1px inset
 * white highlight, specified for "the marker title card, sitting on real photography."
 *
 * Heavier and tighter than `ControlShadow`, and both halves are doing work. Over the vector
 * basemap a numbered disc reads on its fill alone; over satellite it is a small saturated circle
 * on a field of saturated circles, and the ring plus the shadow are what separate an object the
 * app drew from a rooftop that happens to be teal. The ring is the highlight the clause names —
 * opaque here rather than 1px, because 26pt of disc at 3x needs a mark somebody can see.
 */
export const MapObjectShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.55,
  shadowRadius: 10,
  elevation: 5,
} as const;

/**
 * **How far type follows Dynamic Type — the app's one policy, in three numbers.**
 *
 * Nothing is ever `allowFontScaling: false`; every string grows, and these say how far. iOS runs
 * from 1.0 at the default size to 3.1 at AX5, and uncapped RN text follows it all the way — which
 * is what "the whole UI goes bad at large text" was: ~60 files rendered a bare `<Text>` with no cap
 * at all, beside a `ThemedText` that already capped at 1.6.
 *
 * - `body` — anything read: sentences, rows, captions, inputs. 1.6 is a 16pt line at ~26pt, past
 *   AX1, which is where the large sizes stop being about reading and start being about not fitting.
 * - `display` — the serif mastheads and big figures (24pt and up). They are already large and reflow
 *   rather than shrink; uncapped, a two-word masthead becomes four lines.
 * - `chrome` — one-line controls with nowhere to wrap: chips, pills, segment labels, a button's
 *   verb. The system's own bars stop growing early for the same reason. Each still carries its full
 *   name for VoiceOver.
 *
 * `Text` and `TextInput` in `themed-text.tsx` apply `body` or `display` by font size when a call
 * site says nothing, so a new screen inherits the policy without knowing it exists. `chrome` is the
 * one a call site has to ask for, because only it knows a label has no room.
 */
export const FontScale = {
  body: 1.6,
  display: 1.3,
  chrome: 1.3,
  /** At or above this size a string is display type and takes `display`. */
  displayFrom: 24,
} as const;

export const BarHeight = 56;
export const MaxContentWidth = 800;

/**
 * The house motion curve, and the first motion tokens on this platform.
 *
 * DESIGN.md has defined one curve and four durations for the web app all along; none of it had been
 * ported, so every duration in `mobile/` is a literal at its call site — 160, 220, 300, 350, 420,
 * 600 — and the only easing in the app is `Easing.elastic(0.7)`, inherited from the Expo template's
 * splash animation. Elastic is wrong for anything but a splash: it overshoots, which reads as
 * playful on a surface meant to feel considered.
 *
 * `Curve` is the web's `cubic-bezier(0.16, 1, 0.3, 1)` — a steep exponential settle. Feed it to
 * Reanimated as `Easing.bezier(...Curve)`.
 *
 * Durations are named for what they carry rather than for their length, so a call site reads as an
 * intention: `Motion.settle` for something arriving, `Motion.respond` for something reacting to a
 * touch. The two match the durations already in evidence at `trip/[id].tsx` (220/160) and
 * `day-map.tsx` (420) rather than introducing new numbers.
 */
export const Curve = [0.16, 1, 0.3, 1] as const;

export const Motion = {
  /** Something arriving, or the screen recomposing around the keyboard. */
  settle: 420,
  /** Something answering a touch. */
  respond: 220,
  /** Something leaving. Always shorter than its arrival. */
  exit: 160,
} as const;

/**
 * The route's own colours, from `RouteGeometry.palette` — map-native, and deliberately outside
 * the interface palette. DESIGN.md: these must never appear in a panel, chip or button, because
 * the map gets its own colours on the grounds that it is photography rather than a surface.
 *
 * **The numbered stop disc is the one licensed crossing**, written down in DESIGN.md's tertiary
 * section beside the rule it bends. The disc in a day's list is the same mark as the disc on the
 * map; carrying the day's own hue across is what makes the two agree about which stop is which.
 * It is identity, not chrome — and it was an undocumented exception until an outside review asked
 * what the colours meant and the clause this comment claimed to cite turned out not to exist.
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
 * Transcribed from the earlier SwiftUI client's route geometry.
 */
export const RouteDayGlow = ['#7FB3BD', '#C596B6', '#DFA079', '#A6BF89', '#A6A2D0'] as const;

export const dayGlow = (dayIndex: number) =>
  RouteDayGlow[((dayIndex % RouteDayGlow.length) + RouteDayGlow.length) % RouteDayGlow.length];



/**
 * The scrim over a day masthead. Measured, not picked — see the Photograph-Is-Not-A-Surface
 * rule: destination photography ranges to 0.947 mean luminance, where white body text is 2.41:1
 * under a 60% scrim. Large type only above this.
 *
 * **It does not move with the appearance, and the rule generalises rather than forking.** A
 * scrim moves the photograph away from the ink — toward black under paper ink, toward white
 * under dark ink; which direction is a function of the ink, not of the appearance, which
 * subsumes Darken-Never-Lighten as the same rule stated for one ink. Here the photograph stays
 * dark in both, so the ink over it stays paper (`Colors.onDeep`) and this number stays 0.58.
 * `PhotoScrimLight` in `palette.ts` is the parked alternative.
 */
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
  // Polar Interior: Cormorant Garamond for display, Inter Tight for figures (tabular figures come
  // from `fontVariant: ['tabular-nums']` at the call site, as before). Body stays the system face —
  // see below. Registered by @expo-google-fonts under exactly these names, one family per cut.
  display: 'CormorantGaramond_400Regular',
  money: 'InterTight_500Medium',
  moneyBold: 'InterTight_600SemiBold',

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
