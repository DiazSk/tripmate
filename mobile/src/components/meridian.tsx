import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  type SharedValue,
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { Curve, Motion } from '@/constants/theme';
import { meridianMotion, type MeridianState } from '@/lib/meri';

/**
 * Meri, the Frosted Meridian — a small frosted glass globe with two pill eyes (spec
 * `2026-10-11-meri-frosted-meridian-design.md`, reference column 02).
 *
 * **Drawn, not shipped.** The body is one static SVG — a frosted radial gradient, a shading
 * gradient that turns the sphere, one upper-left highlight and a hairline edge — so it is sharp at
 * any size and needs no assets. The eyes are plain views laid over it, so a blink is a transform
 * rather than an animated SVG prop. Everything that moves is a Reanimated transform; *what* moves
 * per state is `meridianMotion`, tested on its own.
 *
 * Each instance keeps its own `<Svg>`, and react-native-svg scopes `<Defs>` per root, so the
 * gradient ids below never bleed between two Meris on one screen.
 *
 * Decorative to accessibility: the host says the state in words.
 */
export function Meridian({
  state,
  size = 32,
  reducedMotion,
  pulse,
}: {
  state: MeridianState;
  size?: number;
  /** Defaults to the system setting. */
  reducedMotion?: boolean;
  /** A count of spoken words, as a shared value: each increase plays one pulse while speaking.
   *  Shared rather than React state, so a word costs no render of whoever hosts Meri. */
  pulse?: SharedValue<number>;
}) {
  const systemReduced = useReducedMotion();
  const still = reducedMotion ?? systemReduced;
  const motion = meridianMotion(state, still);

  const breathe = useSharedValue(1);
  const squash = useSharedValue(0);
  const drift = useSharedValue(0.5);
  const lift = useSharedValue(0);
  const blink = useSharedValue(1);
  const tap = useSharedValue(1);

  useEffect(() => {
    for (const value of [breathe, squash, drift, lift]) cancelAnimation(value);
    const ease = Easing.inOut(Easing.sin);
    // **Every loop starts from rest.** `cancelAnimation` leaves a value mid-swing, and a reversing
    // `withRepeat` swings between wherever it starts and its target — so a breath cut at its peak
    // became a "thinking" Meri swinging from 1.03 to 1.03: frozen.
    breathe.value = motion.breatheMs
      ? withSequence(
          withTiming(1, { duration: Motion.respond }),
          withRepeat(withTiming(1.06, { duration: motion.breatheMs / 2, easing: ease }), -1, true),
        )
      : withTiming(1, { duration: Motion.respond });
    squash.value = motion.squash
      ? withSequence(
          withTiming(0, { duration: Motion.respond }),
          withRepeat(withTiming(1, { duration: 280, easing: ease }), -1, true),
        )
      : withTiming(0, { duration: Motion.respond });
    drift.value = motion.driftMs
      ? withRepeat(withTiming(1, { duration: motion.driftMs / 2, easing: ease }), -1, true)
      : withTiming(0.5, { duration: Motion.respond });
    lift.value = motion.lift
      ? withSequence(
          withTiming(-5, { duration: Motion.settle / 2, easing: Easing.bezier(...Curve) }),
          withTiming(0, { duration: Motion.settle / 2, easing: Easing.bezier(...Curve) }),
        )
      : 0;
    // The motion object is derived from these two; depending on it would restart every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, still]);

  // A blink every 2.8–5s, randomised so two Meris never blink in step. Any slower and, measured on
  // a phone, Meri read as a still image between blinks.
  useEffect(() => {
    if (!motion.blink) {
      blink.value = withTiming(1, { duration: Motion.respond });
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        blink.value = withSequence(withTiming(0.1, { duration: 70 }), withTiming(1, { duration: 110 }));
        schedule();
      }, 2800 + Math.random() * 2200);
    };
    schedule();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion.blink]);

  // One word, one tap — only while speaking, and never under Reduce Motion. Read on the UI thread,
  // so the words never pass through React.
  const tapping = motion.squash;
  useAnimatedReaction(
    () => pulse?.value ?? 0,
    (now, before) => {
      if (before === null || now === before || !tapping) return;
      tap.value = withSequence(withTiming(1.08, { duration: 80 }), withTiming(1, { duration: 80 }));
    },
    [tapping],
  );

  const eyes = motion.eyes;
  const body = useAnimatedStyle(() => ({
    transform: [
      { translateY: lift.value },
      { scale: breathe.value * tap.value },
      // ±5%: at ±2% the speaking squash was invisible on a real phone at 40pt.
      { scaleX: 1 + 0.05 * squash.value },
      { scaleY: 1 - 0.05 * squash.value },
    ],
  }));
  const eyeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (drift.value * 2 - 1) * 0.03 * size }, { scaleY: blink.value * eyes }],
  }));

  const eye = { width: 0.075 * size, height: 0.2 * size, borderRadius: size, top: 0.4 * size };
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: size, height: size, borderRadius: size / 2 }, styles.shadow, body]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="meri-body" cx="42%" cy="38%" r="65%">
            <Stop offset="0" stopColor="#F4F3F0" />
            <Stop offset="1" stopColor="#CFCDC8" />
          </RadialGradient>
          <RadialGradient id="meri-shade" cx="72%" cy="78%" r="55%">
            <Stop offset="0" stopColor="#B9B6B0" stopOpacity={0.35} />
            <Stop offset="1" stopColor="#B9B6B0" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="meri-shine" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.9} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={50} cy={50} r={49} fill="url(#meri-body)" />
        <Circle cx={50} cy={50} r={49} fill="url(#meri-shade)" />
        <Ellipse cx={33} cy={27} rx={19} ry={12} fill="url(#meri-shine)" />
        <Circle cx={50} cy={50} r={49} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={2} />
      </Svg>
      <Animated.View style={[styles.eye, eye, { left: 0.4 * size - eye.width / 2 }, eyeStyle]} />
      <Animated.View style={[styles.eye, eye, { left: 0.6 * size - eye.width / 2 }, eyeStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The soft drop shadow under the sphere in the reference. A background colour gives iOS a shape
  // to cast from; it is the body's rim colour, so it never shows past the SVG.
  shadow: {
    backgroundColor: '#CFCDC8',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  eye: { position: 'absolute', backgroundColor: '#4A4844' },
});
