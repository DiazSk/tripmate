import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { Easing, Keyframe, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signIn, signUp } from '@/api/auth';
import { FieldTrough, PillButton, PrimaryButton, TextField } from '@/components/form';
import { Notice } from '@/components/states';
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
const BEATS = [
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
const DWELL_MS = 7000;

/**
 * The band's share of the screen, and why it is not full-bleed.
 *
 * The photographs are 1200x1309. A full-screen hero on a 3x phone wants ~2800px of height and would
 * upscale them about 2.1x, which is visibly soft on the one screen that has to look expensive. At
 * 46% of a 932pt window the band asks for ~1290px and lands near-native.
 */
const BAND_RATIO = 0.46;

/**
 * What the band shrinks to when the keyboard is up, or when the type is scaled past the point where
 * `FieldRow` starts stacking its label above its value. A sliver rather than nothing: the photograph
 * leaving entirely makes the screen look like it navigated somewhere.
 */
const BAND_COLLAPSED = 132;

/** Above this the form needs the room more than the photograph does. `form.tsx` stacks here too. */
const STACK_ABOVE_SCALE = 1.2;

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
 * Sign in, or make an account — and the screen the app opens on.
 *
 * **Nothing is gated by it, and that distinction is the whole design.** This used to say "nothing in
 * this app is behind it", which was true when it could only be reached from Trips or Profile and
 * is now false in the literal sense: `+native-intent.tsx` opens a signed-out launch here, and the
 * root layout anchors `(tabs)` so Home sits directly behind the sheet. What remains true is that it
 * demands nothing. Planning, generating and saving all work signed out under the anonymous owner,
 * the server claims that work on session creation, and "Keep planning without an account" — plus the
 * sheet's own swipe-down — leaves without a cost.
 *
 * One screen with a mode toggle rather than two routes: the forms differ by a single field, and
 * somebody who has typed their email into the wrong one should not have to type it again.
 */
export default function SignInScreen() {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const [beat, setBeat] = useState(0);
  const [keyboardUp, setKeyboardUp] = useState(false);

  // The reel. Stopped outright under Reduce Motion rather than slowed: the beats are decoration
  // here, and `withTiming` below already honours the setting on its own.
  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setBeat((b) => (b + 1) % BEATS.length), DWELL_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  // `will`-prefixed on iOS so the band starts moving on the same frame as the keyboard rather than
  // after it has arrived; Android only emits the `did` pair.
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const bandHeight =
    keyboardUp || fontScale > STACK_ABOVE_SCALE ? BAND_COLLAPSED : Math.round(height * BAND_RATIO);

  // Reading a plain JS number out of the closure, which is how `trip/[id].tsx` drives its only
  // other timed animation — the style re-evaluates when `bandHeight` changes and there is no shared
  // value to keep in step with React state.
  const bandStyle = useAnimatedStyle(
    () => ({ height: withTiming(bandHeight, { duration: Motion.settle, easing: Easing.bezier(...Curve) }) }),
    [bandHeight],
  );

  async function submit() {
    setBusy(true);
    setError(null);

    const result = creating
      ? await signUp(email.trim(), password, name.trim() || email.trim().split('@')[0])
      : await signIn(email.trim(), password);

    if (result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }

    leave();
  }

  /**
   * Out of here, whether by succeeding or by declining.
   *
   * The guard is the house idiom (`plan/_layout.tsx`, and this screen's own submit path before it).
   * With the root layout's `anchor: '(tabs)'` there is always something behind this now, so `back()`
   * lands on Home — but the guard is what keeps the screen correct independent of how it was reached
   * and is the difference between a working escape and a dead link if the anchor ever goes away.
   */
  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/trips');
  }

  const ready = email.trim().length > 0 && password.length >= 8;
  const current = BEATS[beat];

  return (
    <View style={styles.root}>
      {/* Full-bleed to the top edge, so the photograph runs under the status bar. The caption is
          inset by the safe area instead — a band that starts below the notch reads as a picture
          pasted onto a screen rather than as the screen itself. */}
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
          {bandHeight > BAND_COLLAPSED ? (
            <ThemedText type="display" themeColor="onDeep" numberOfLines={2}>
              {current.stat}
            </ThemedText>
          ) : null}
        </Animated.View>
      </Animated.View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* The bottom inset is applied here rather than by wrapping in a `SafeAreaView`, because
            the band above has to reach the top edge and a `SafeAreaView` would inset that too.
            Without it the last row — the escape out of this screen — sits under the home indicator,
            where a tap does not reliably reach it. */}
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.regular }]}
          keyboardShouldPersistTaps="handled">
          <ThemedText type="title">{creating ? 'Make an account' : 'Welcome back'}</ThemedText>
          <ThemedText type="detail" themeColor="muted" style={styles.blurb}>
            {creating
              ? 'Your trips and travel profile stay with you — on this phone and on the web.'
              : 'Sign in to find your trips wherever you are.'}
          </ThemedText>

          <View style={styles.form}>
            <FieldTrough>
              {creating ? (
                <TextField
                  label="Name"
                  value={name}
                  onChangeText={setName}
                  placeholder="Optional"
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                />
              ) : null}
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
              />
              {/* `textContentType` is what lets iOS offer the keychain entry, and it has to say
                  which of the two this is — otherwise it proposes a new password on a sign-in. */}
              <TextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={creating ? 'new-password' : 'current-password'}
                textContentType={creating ? 'newPassword' : 'password'}
              />
            </FieldTrough>

            {creating ? (
              <ThemedText type="micro" themeColor="muted" style={styles.hint}>
                At least 8 characters.
              </ThemedText>
            ) : null}

            {error ? <Notice>{error}</Notice> : null}

            <PrimaryButton
              title={creating ? 'Create account' : 'Sign in'}
              onPress={submit}
              disabled={!ready}
              busy={busy}
            />

            {/* The two share one box so the form's `gap` falls outside the pair rather than
                between them — otherwise 16pt lands on top of the 26pt of slack two 44pt targets
                already carry, and 42pt reads as two unrelated rows instead of two secondary
                actions under the button. `gap: Spacing.hair` keeps them a pair now that both are
                capsules and their edges, not their text, set the rhythm. */}
            <View style={styles.secondary}>
              {/* **A capsule, because it is an action sitting in content.** It was the second
                  half of a sentence — "New here? Create an account" — and half a sentence cannot
                  be a capsule, so the sentence goes. DESIGN.md's nav-bar exemption does not reach
                  here: this is not a bar item or a row accessory, it is a control in prose.
     
                  **"instead", because the bare label collided with the button above it.** The
                  deleted prefix ("Already have an account? ") was the only thing marking this as a
                  mode switch. Without it, create mode showed `Create account` over `Sign in` —
                  somebody who had filled in all three fields and pressed the lower one would
                  silently flip the form rather than submit it. Both directions collide, so both
                  carry the word. */}
              <PillButton
                title={creating ? 'Sign in instead' : 'Create an account instead'}
                onPress={() => {
                  setCreating((v) => !v);
                  setError(null);
                }}
              />

              {/* **A capsule, because this is the way out and it was reading as a caption.**
                  Muted `detail` is the same face and colour as the blurb under the title, so the
                  one control that leaves this screen was typographically identical to a sentence
                  describing it — reported as not knowing it was a button at all. It matters more
                  now than it did: this screen is a full-screen modal, so the swipe-down that used
                  to share the job is gone and this is the only way out. */}
              <PillButton title="Keep planning without an account" onPress={leave} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.canvas },
  flex: { flex: 1 },
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
  content: {
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.regular,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  blurb: { paddingTop: Spacing.tight },
  form: { paddingTop: Spacing.regular, gap: Spacing.read },
  hint: { paddingHorizontal: Spacing.hair },
  // Both children are capsules that size to their own words — `PillButton` sets its own
  // `alignSelf`, so this box only has to keep them a pair.
  secondary: { gap: Spacing.hair },
});
