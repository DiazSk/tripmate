import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Colors } from '@/constants/theme';

const INITIAL_SCALE_FACTOR = Dimensions.get('screen').height / 90;
const DURATION = 600;

export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: {
      transform: [{ scale: 1 }],
      opacity: 1,
    },
    20: {
      opacity: 1,
    },
    70: {
      opacity: 0,
      easing: Easing.elastic(0.7),
    },
    100: {
      opacity: 0,
      transform: [{ scale: 1 }],
      easing: Easing.elastic(0.7),
    },
  });

  const image = <Image style={styles.overlayImage} source={require('@/assets/images/splash-icon.png')} />;

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={styles.splashOverlay}>
      {image}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={styles.splashOverlay}>
      {image}
    </View>
  );
}

const keyframe = new Keyframe({
  0: {
    transform: [{ scale: INITIAL_SCALE_FACTOR }],
  },
  100: {
    transform: [{ scale: 1 }],
    easing: Easing.elastic(0.7),
  },
});

const logoKeyframe = new Keyframe({
  0: {
    transform: [{ scale: 1.3 }],
    opacity: 0,
  },
  40: {
    transform: [{ scale: 1.3 }],
    opacity: 0,
    easing: Easing.elastic(0.7),
  },
  100: {
    opacity: 1,
    transform: [{ scale: 1 }],
    easing: Easing.elastic(0.7),
  },
});

const glowKeyframe = new Keyframe({
  0: {
    transform: [{ rotateZ: '0deg' }],
  },
  100: {
    transform: [{ rotateZ: '7200deg' }],
  },
});

export function AnimatedIcon() {
  return (
    <View style={styles.iconContainer}>
      <Animated.View entering={glowKeyframe.duration(60 * 1000 * 4)} style={styles.glow}>
        <Image style={styles.glow} source={require('@/assets/images/logo-glow.png')} />
      </Animated.View>

      <Animated.View entering={keyframe.duration(DURATION)} style={styles.background} />
      <Animated.View style={styles.imageContainer} entering={logoKeyframe.duration(DURATION)}>
        <Image style={styles.image} source={require('@/assets/images/splash-icon.png')} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  imageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  glow: {
    width: 201,
    height: 201,
    position: 'absolute',
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 128,
    height: 128,
    zIndex: 100,
  },
  image: {
    width: 96,
    height: 96,
  },
  // Same box as the native splash's `imageWidth` in app.json, so the hand-off from the native
  // splash to this overlay does not visibly resize the mark.
  overlayImage: {
    width: 200,
    height: 200,
  },
  background: {
    borderRadius: 40,
    experimental_backgroundImage: `linear-gradient(180deg, #1d1a18, #0b0a09)`,
    width: 128,
    height: 128,
    position: 'absolute',
  },
  /**
   * **The half of the splash that can follow the appearance.**
   *
   * This shipped as the literal `#121110`, which is `Dark.canvas` — so under the light
   * appearance the app opened on a near-black screen and faded to paper. `Colors.canvas` is
   * byte-identical in dark and paper in light.
   *
   * **The other half cannot follow, and that is a configuration choice rather than a platform
   * limit.** The native splash is drawn by the OS before a line of JS runs, so it cannot read
   * `APPEARANCE`, which `constants/appearance.ts` reads from a file. `expo-splash-screen`'s
   * plugin does take a `dark` variant — an iOS colour-asset appearance entry, Android's
   * `drawable-night` — and it would resolve natively and for free, except that `app.json` pins
   * `userInterfaceStyle: "dark"` at the root and again under `android`, which forces the whole
   * app including the launch screen, so the dark entry always wins. `theme.ts` and DESIGN.md
   * both record that pin as deliberate and name the splash as one of its named gaps.
   *
   * So in light there is a dark moment before JS, and then this. The overlay was written to
   * make the hand-off from the native splash invisible, and under paper it no longer can be —
   * which is the cost of narrowing the gap without closing it.
   */
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
