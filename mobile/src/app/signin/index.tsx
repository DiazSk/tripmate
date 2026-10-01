import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PillButton, PrimaryButton } from '@/components/form';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';

/**
 * The front door: what this is, and the three things you can do about it.
 *
 * **One kind of thing, at three weights.** The screen this replaced asked for a task, an
 * alternative *mode* and a way *out* in one stack, with the last two wearing the same slate
 * capsule — so it read as three competing calls to action with a ragged edge under them, at full
 * width, 218pt and 272pt. Here all three are the same kind of thing, a choice, and they differ by
 * weight: the jade fill, the slate block, and the quiet capsule.
 *
 * **Sign up takes the one jade fill** (DESIGN.md's Primary Action Surface allows one per screen).
 * `launchTarget` routes here only on a bare launch with no keychain entry, so nobody who sees this
 * screen has an account on this device — and sign-up is the action that moves their anonymous
 * planning onto one through `claimAnonymousOwner`.
 *
 * **The mark, not the lockup, and the mono cut rather than the glass one.** `brand/lockup.png` is
 * opaque RGB with a baked `#121110` ground — byte-identical to the dark canvas, so seamless
 * there and a near-black square on paper — and `brand/README.md` forbids the full-colour mark on
 * a light ground, prescribing `mono.svg` in `#121110`. This is that master's raster, tinted
 * `Colors.foreground`: near-black on paper, paper on near-black, one asset either way. The name
 * does not appear, which those same rules already accept ("No text in the app icon. The name
 * appears only in the lockup."). Putting it there is a new mono lockup master and render.
 */
export default function AuthChooserScreen() {
  const insets = useSafeAreaInsets();

  /**
   * Out, without a cost.
   *
   * The guard is the house idiom. With the root layout's `anchor: '(tabs)'` there is always
   * something behind this, so `back()` lands on Home — but the guard keeps the screen correct
   * independent of how it was reached, and is the difference between a working escape and a dead
   * link if the anchor ever goes away.
   */
  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/trips');
  }

  return (
    <View style={[styles.content, { paddingBottom: insets.bottom + Spacing.regular }]}>
      {/* The mark sits in its own block above the actions rather than in a row with them: it says
          whose app this is, which is not a choice and should not stand in the column of choices. */}
      <View style={styles.identity}>
        <Image
          // `require`, not an `import`: `expo/types` declares `*.webp` — which is why the band's
          // scenes import cleanly — and does not declare `*.png`, so every PNG in this app is a
          // require. `animated-icon.tsx` does the same for the splash mark.
          source={require('@/assets/images/android-icon-monochrome.png')}
          style={styles.logo}
          tintColor={Colors.foreground}
          contentFit="contain"
          accessibilityIgnoresInvertColors
          alt="TripMate"
        />
      </View>

      <View style={styles.actions}>
        <PrimaryButton title="Sign up" onPress={() => router.push('/signin/form?mode=signup')} />
        <PillButton block title="Log in" onPress={() => router.push('/signin/form?mode=login')} />
        {/* The quietest of the three, and still unmistakably a control — jade ink and a 44pt
            target. The version this descends from was muted `detail` body text, which is the same
            face and colour as a caption and was reported as not reading as a button at all; what
            fixed that is the ink and the target, not a fill. */}
        <PillButton block tone="quiet" title="Keep planning without an account" onPress={leave} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // `space-between` so the mark takes the slack above and the actions stay on the bottom edge: at
  // AX3 the band collapses to `BAND_COLLAPSED` and this box grows, and the actions must not drift
  // into the middle of it.
  content: {
    flex: 1,
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.regular,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    justifyContent: 'space-between',
  },
  identity: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // 96, not the 72 the plan guessed: the lower half leaves roughly 280pt of slack for the mark
  // once the three actions have taken theirs, and at 72 a thin outline glyph read as lost in it.
  logo: { width: 96, height: 96 },
  // `Spacing.rows` between them, not `read`: three controls at three weights are one group, and
  // 16pt lands on top of the slack two 44pt targets already carry.
  actions: { gap: Spacing.rows },
});
