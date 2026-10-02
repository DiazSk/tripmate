import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Colors, Curve, MaxContentWidth, Motion, PhotoScrim, Spacing } from '@/constants/theme';

import balconyMorningView from '@/assets/images/scenes/balcony-morning-view.webp';
import spiceMarketBarrels from '@/assets/images/scenes/spice-market-barrels.webp';
import stormOverForestRidge from '@/assets/images/scenes/storm-over-forest-ridge.webp';
import vernazzaBlueHour from '@/assets/images/scenes/vernazza-blue-hour.webp';

/**
 * The four beats, and the photography they carry — lifted whole from the web app's
 * `src/components/blue-hour/sceneBeats.ts`.
 *
 * **The pairings are not mine to remix, and that file says why**: each photograph was chosen to
 * state its own beat rather than to gesture at its topic, and its docstring records what each one
 * replaced and on what grounds. A storm cloud under "Real Prices" would undo that work. The copy is
 * carried verbatim for the same reason — it is already written and already fact-checked, and a
 * sign-in screen is the wrong place to invent a new claim about the product.
 *
 * All four are Pexels, whose licence permits commercial use without attribution, and the originals
 * are credited by id and photographer in that file so the next person can find them. The files are
 * copies of the web app's own `public/scenes/*.webp` — 1200x1309, 122-246KB each — rather than
 * re-encodes, so there is one crop and one encode of each in the repo.
 */
export const BEATS = [
  { photo: vernazzaBlueHour, label: 'The Blue Hour', stat: 'One 20-minute window, every evening' },
  { photo: spiceMarketBarrels, label: 'Real Prices', stat: 'Lodging, food, and transit — itemized' },
  { photo: stormOverForestRidge, label: 'Live Weather', stat: 'Real forecast, up to 16 days out' },
  { photo: balconyMorningView, label: 'Three Ways to Travel', stat: 'Budget · Mid-range · Luxury' },
] as const;
/**
 * How long a beat holds. Long on purpose: at three or four seconds this reads as a slideshow
 * demanding to be watched, which is the opposite of what somebody typing a password needs. Seven
 * seconds is slow enough to register as the screen breathing.
 */
export const DWELL_MS = 7000;
/**
 * The band's share of the screen, and why it is neither full-bleed nor native.
 *
 * The photographs are 1200x1309, so on a 3x phone the band is pixel-native up to a height of
 * 1309px — **436pt, or 49.9% of an 874pt window.** A full-screen hero wants ~2800px and would
 * upscale them about 2.1x, which is visibly soft on the one screen that has to look expensive.
 *
 * **It sits above that native ceiling anyway, and the arithmetic is why.** At 46% the lower half
 * had 472pt for a 342pt stack — 24pt of padding, the 96pt mark, 164pt of actions (`PrimaryButton`
 * is 52, two `PillButton`s are 44, two gaps are 12) and 58pt of bottom inset — leaving **130pt of
 * empty paper** with the mark floating in it. At 58% that slack drops to about 25 and the lower
 * half reads as a deliberate stack. The cost is 1521px against 1309, a **1.16x upscale**, which at
 * 3x is hard to see; 70% was asked for and does not exist, because it leaves 262pt for a stack
 * that needs 342 and would crop 28% off every photograph's width besides.
 *
 * On a shorter screen the floor rises relative to the window — a 667pt device needs 308 and gets
 * 280 here — so `signin/index.tsx` lets the mark shrink rather than push the actions off.
 */
export const BAND_RATIO = 0.58;
/**
 * What the band shrinks to when the keyboard is up, or when the type is scaled past the point where
 * `FieldRow` starts stacking its label above its value. A sliver rather than nothing: the photograph
 * leaving entirely makes the screen look like it navigated somewhere.
 */
export const BAND_COLLAPSED = 132;
/** Above this the form needs the room more than the photograph does. `form.tsx` stacks here too. */
export const STACK_ABOVE_SCALE = 1.2;

/**
 * The caption rising into place. One motion, used twice — on arrival, and on each beat change,
 * because the caption is part of the reel rather than a separate effect.
 *
 * `Easing.bezier(...Curve)` is DESIGN.md's house curve, ported to this platform with `Curve` and
 * `Motion` in `constants/theme.ts`. Deliberately not `Easing.elastic(0.7)`, which is the only easing
 * the app had: it overshoots, and an overshoot reads as playful.
 */
const rise = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 14 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.bezier(...Curve) },
});

/**
 * And the caption leaving, because **the photograph and its claim have to dissolve on one clock.**
 *
 * The first cut of this gave the image a 1200ms `transition` and the caption a 420ms rise, and the
 * result was visible on the second beat: for the best part of a second the screen showed "Real
 * forecast, up to 16 days out" over a photograph of spice barrels. `sceneBeats.ts` chose each
 * picture to state its own beat, so a caption that arrives before its photograph does is the one
 * thing this screen must not do — it remixes the pairings the source file is explicit about.
 *
 * So both run for `Motion.settle`, and the outgoing caption fades as the incoming one rises: the
 * overlap is symmetric, and in the middle of it neither claim is legible enough to be read against
 * the wrong picture. No `translateY` on the way out — a caption should leave by dimming, not by
 * moving somewhere.
 */
const fade = new Keyframe({
  0: { opacity: 1 },
  100: { opacity: 0, easing: Easing.bezier(...Curve) },
});

/**
 * The photographic band both auth screens stand under.
 *
 * **It is mounted by `signin/_layout.tsx`, above the group's `Stack`, and that placement is the
 * point.** A band rendered inside each screen would remount on every navigation: the reel would
 * restart and you would land on a different photograph than the one you left. One instance
 * outside the `Stack` means the picture holds still while the content below it pushes, which is
 * the only reason the form screen keeps a band at all.
 *
 * The height arrives as a plain number rather than being worked out here, because what collapses
 * it — the keyboard, and the Dynamic Type threshold — is known to the flow and not to a band.
 *
 * **Full-bleed to the top edge**, so the photograph runs under the status bar; the caption is
 * inset by the safe area instead. A band that starts below the notch reads as a picture pasted
 * onto a screen rather than as the screen itself.
 */
export function SceneBand({ beat, height }: { beat: number; height: number }) {
  const reduceMotion = useReducedMotion();
  const current = BEATS[beat];

  // Reading a plain JS number out of the closure, which is how `trip/[id].tsx` drives its only
  // other timed animation — the style re-evaluates when `height` changes and there is no shared
  // value to keep in step with React state.
  const bandStyle = useAnimatedStyle(
    () => ({ height: withTiming(height, { duration: Motion.settle, easing: Easing.bezier(...Curve) }) }),
    [height],
  );

  return (
    <Animated.View style={[styles.band, bandStyle]}>
      {/* One `Image` whose source changes, rather than a stack of them cross-faded by hand:
          `transition` is exactly this, and expo-image holds the outgoing frame itself. */}
      <Image
        source={current.photo}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        // The same duration the caption's rise and fade take — see `fade` above for why these
        // two must not drift apart.
        transition={reduceMotion ? 0 : Motion.settle}
        accessibilityIgnoresInvertColors
        alt=""
      />
      {/* `PhotoScrim` is measured, not picked — destination photography runs to 0.947 mean
          luminance, where white text needs this much to clear contrast. Only tracked caps and
          display type ride a picture (the Photograph-Is-Not-A-Surface rule), which is exactly
          what the caption is. */}
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />
      <Animated.View
        // Re-keyed per beat so the caption rises with each photograph instead of swapping under
        // it. Same keyframe as the arrival, so this is one authored motion rather than two.
        key={beat}
        entering={rise.duration(Motion.settle)}
        exiting={fade.duration(Motion.settle)}
        style={styles.caption}>
        <ThemedText type="label" themeColor="onDeep" style={styles.captionLabel}>
          {current.label}
        </ThemedText>
        {height > BAND_COLLAPSED ? (
          <ThemedText type="display" themeColor="onDeep" numberOfLines={2}>
            {current.stat}
          </ThemedText>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  band: {
    // Squared, not rounded: this is read, not touched, and it reaches three screen edges. The
    // bottom hairline is the whole separation between the picture and the form — the system draws
    // rules rather than putting a card around things.
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: Colors.surfaceDeep,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.cardBorder,
  },
  scrim: { backgroundColor: `rgba(0,0,0,${PhotoScrim})` },
  caption: {
    paddingHorizontal: Spacing.read,
    // Bottom-anchored inside the band, so the notch is not its problem — the photograph runs behind
    // the status bar on purpose and there is nothing at the band's top to protect.
    paddingBottom: Spacing.compact,
    gap: Spacing.tight,
    // Matches the page gutter below the rule, so the caption and the form share one left edge.
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  // Paper at 72%, the same step the trip masthead's overline takes. Opacity rather than `muted`,
  // which is tuned for the canvas and goes grey over a photograph.
  captionLabel: { opacity: 0.72 },
});
