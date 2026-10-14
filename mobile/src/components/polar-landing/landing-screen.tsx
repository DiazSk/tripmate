import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  SlideInDown,
  SlideOutDown,
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useReducedMotion,
  useScrollOffset,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toPrefill, type PlanPrefill } from '@shared/planExamples';
import { Polar, PolarFonts, PolarRadius, PolarSpace, PolarType } from '@/constants/polar';
import { BEATS, DESTS, FACTS, FOOT_PHOTO, PLANS, STEPS, type LandingPlan } from './content';
import { DayOnMap } from './day-on-map';
import { Scrim } from './scrim';

/**
 * The Polar Interior landing, for the phone — the "TripMate — Polar Landing (Mobile)" design on the
 * MagicPath canvas, and what a signed-out launch opens on (`launchTarget` in `lib/authGate.ts`).
 *
 * **It hands off rather than mocks.** Every "plan" here opens the real wizard at `/plan/basics`,
 * prefilled through route params where it knows what to say (`draftFromPrefill`): a sample plan's
 * where, dates, budget and party, or the closing form's where, a month's first week, travellers and
 * an optional budget. Signing in is offered, never required — the soft gate `authGate.ts` describes.
 */
type Section = 'plans' | 'day' | 'knows' | 'plan';
type Mark = Section | 'intro' | 'quote';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const todayISO = () => {
  const now = new Date();
  return isoDay(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
};

/** Into the wizard, with whatever this landing can honestly fill in. */
function openWizard(prefill?: PlanPrefill) {
  if (!prefill) {
    router.push('/plan/basics');
    return;
  }
  router.push({
    pathname: '/plan/basics',
    params: {
      destination: prefill.destination,
      start: prefill.startDate,
      end: prefill.endDate,
      ...(prefill.budgetUsd !== undefined ? { budget: String(prefill.budgetUsd) } : {}),
      ...(prefill.adults !== undefined ? { adults: String(prefill.adults) } : {}),
      ...(prefill.children !== undefined ? { children: String(prefill.children) } : {}),
    },
  });
}

/* ───────────────────────── Motion ───────────────────────── */

// white-desert.com's scroll vocabulary on Reanimated. Every effect is a pure function of the scroll
// offset — the reference's `scrub: true, ease: "none"` — so it tracks the finger exactly and never
// overshoots. Section tops arrive by onLayout into shared values: nothing re-renders on scroll.
type Motion = { y: SharedValue<number>; vh: number; reduce: boolean; base: Record<Mark, SharedValue<number>> };
const MotionContext = createContext<Motion | null>(null);
const useMotion = () => useContext(MotionContext)!;
const REVEAL = Easing.bezier(0.16, 1, 0.3, 1);

/**
 * Rises into place as it comes up the screen. With `fade` its text also comes in from 10% — the
 * phone's stand-in for the web's line-by-line mask, which would need a native masked view the app
 * does not ship. Must be a direct child of the section `at` names, so its onLayout y is local to it.
 */
function Rise({ at, distance = 40, fade, style, children }: { at: Mark; distance?: number; fade?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { y, vh, reduce, base } = useMotion();
  const top = useSharedValue(0);
  const a = useAnimatedStyle(() => {
    if (reduce) return {};
    const p = interpolate(base[at].value + top.value - y.value, [vh * 0.92, vh * 0.55], [0, 1], Extrapolation.CLAMP);
    return { opacity: fade ? 0.1 + 0.9 * p : 1, transform: [{ translateY: (1 - p) * distance }] };
  });
  return (
    <Animated.View
      style={[style, a]}
      onLayout={(e) => {
        top.value = e.nativeEvent.layout.y;
      }}>
      {children}
    </Animated.View>
  );
}

export function PolarLandingScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const y = useScrollOffset(scroll);
  const reduce = useReducedMotion();
  const offsets = useRef<Partial<Record<Section, number>>>({});
  const intro = useSharedValue(0);
  const plans = useSharedValue(0);
  const day = useSharedValue(0);
  const quote = useSharedValue(0);
  const knows = useSharedValue(0);
  const plan = useSharedValue(0);
  const motion = useMemo<Motion>(() => ({ y, vh: height, reduce, base: { intro, plans, day, quote, knows, plan } }), [y, height, reduce, intro, plans, day, quote, knows, plan]);
  const [showBar, setShowBar] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [menu, setMenu] = useState(false);
  const [how, setHow] = useState(false);

  // Written from the layout event itself, never from render — the compiler lint's ref rule.
  const record = (s: Mark, e: LayoutChangeEvent) => {
    const at = e.nativeEvent.layout.y;
    if (s !== 'intro' && s !== 'quote') offsets.current[s] = at;
    // `.set()`, Reanimated's React-Compiler-safe write: the shared value went through useMemo.
    motion.base[s].set(at);
  };
  const go = useCallback(
    (s: Section) => {
      setMenu(false);
      scroll.current?.scrollTo({ y: Math.max(0, (offsets.current[s] ?? 0) - insets.top), animated: true });
    },
    [insets.top, scroll],
  );
  const startPlan = useCallback((prefill?: PlanPrefill) => {
    setMenu(false);
    setHow(false);
    openWizard(prefill);
  }, []);
  const signIn = useCallback(() => {
    setMenu(false);
    router.push('/signin');
  }, []);

  // **Set imperatively, and again after every modal.** Presenting an RN `Modal` on iOS resets the
  // status bar, and a mounted <StatusBar> never re-asserts itself afterwards — measured here: dark
  // before the How-it-works sheet opened, white over a white page for good once it closed. Both
  // modals sit on dark ground, so they get light; the page gets whatever it is scrolled to.
  useEffect(() => {
    setStatusBarStyle(menu || how || !pastHero ? 'light' : 'dark', true);
  }, [menu, how, pastHero]);
  // iOS can reset it again when the dismissal *finishes*, after the effect above has run.
  const restoreStatusBar = () => setStatusBarStyle(pastHero ? 'dark' : 'light', true);

  // Only the bar's visibility is state — a scroll offset in state would re-render the map 60x/s.
  // The motion reads the same scroll through `useScrollOffset`, on the UI thread.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const at = e.nativeEvent.contentOffset.y;
    setShowBar(at > height * 0.85 && at < (offsets.current.plan ?? Infinity) - height * 0.6);
    // Past the photograph the page is white, and white clock-and-battery on white disappears —
    // so the bar goes dark and gets a frosted ground to sit on instead of the page's text.
    setPastHero(at > Math.max(height, 640) - insets.top);
  };

  return (
    <MotionContext.Provider value={motion}>
      <View style={styles.screen}>
        <Animated.ScrollView ref={scroll} style={styles.flex} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never" automaticallyAdjustKeyboardInsets>
          <Hero height={height} width={width} onMenu={() => setMenu(true)} onPlan={() => startPlan()} onWatch={() => go('day')} />
          <View onLayout={(e) => record('intro', e)}>
            <Intro />
          </View>
          <View onLayout={(e) => record('plans', e)}>
            <Plans width={width} onPlan={(p) => startPlan(toPrefill(p, todayISO()))} />
          </View>
          <View onLayout={(e) => record('day', e)}>
            <DayOnMap width={width} />
          </View>
          <View onLayout={(e) => record('quote', e)}>
            <Quote />
          </View>
          <View onLayout={(e) => record('knows', e)}>
            <Knows width={width} />
          </View>
          <View onLayout={(e) => record('plan', e)}>
            <PlanFooter width={width} bottom={insets.bottom} onPlan={startPlan} onHow={() => setHow(true)} onGo={go} onSignIn={signIn} />
          </View>
        </Animated.ScrollView>

        {pastHero && <BlurView intensity={70} tint="light" style={[styles.statusGround, { height: insets.top }]} pointerEvents="none" />}

        {showBar && (
          <View style={[styles.barWrap, { bottom: insets.bottom + 6 }]} pointerEvents="box-none">
            <BlurView intensity={60} tint="dark" style={styles.bar}>
              <Pressable onPress={() => setHow(true)} style={({ pressed }) => [styles.barQuiet, pressed && styles.dim]} accessibilityRole="button">
                <Text style={styles.barQuietText}>How it works</Text>
              </Pressable>
              <Pressable onPress={() => startPlan()} style={({ pressed }) => [styles.signal, styles.flex, pressed && styles.signalPressed]} accessibilityRole="button">
                <Text style={styles.signalText}>Plan a trip</Text>
              </Pressable>
            </BlurView>
          </View>
        )}

        <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)} onDismiss={restoreStatusBar} statusBarTranslucent>
          <BlurView intensity={80} tint="dark" style={[StyleSheet.absoluteFill, { paddingTop: insets.top + PolarSpace.s3, paddingHorizontal: PolarSpace.pad }]}>
            <View style={styles.menuHead}>
              <Wordmark light />
              <Pressable onPress={() => setMenu(false)} style={({ pressed }) => [styles.glass, pressed && styles.dim]} accessibilityRole="button" accessibilityLabel="Close menu">
                <Text style={styles.glassText}>Close</Text>
              </Pressable>
            </View>
            <View style={styles.menuList}>
              {(
                [
                  ['plans', 'Sample plans'],
                  ['day', 'A day on the map'],
                  ['knows', 'What a plan knows'],
                ] as [Section, string][]
              ).map(([k, label], i) => (
                <Pressable key={k} onPress={() => go(k)} style={({ pressed }) => [styles.menuRow, pressed && styles.dim]} accessibilityRole="link">
                  <Text style={styles.menuN}>{pad(i + 1)}</Text>
                  <Text style={styles.menuLabel}>{label}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => {
                  setMenu(false);
                  setHow(true);
                }}
                style={({ pressed }) => [styles.menuRow, pressed && styles.dim]}
                accessibilityRole="button">
                <Text style={styles.menuN}>04</Text>
                <Text style={styles.menuLabel}>How it works</Text>
              </Pressable>
              <Pressable onPress={signIn} style={({ pressed }) => [styles.menuRow, pressed && styles.dim]} accessibilityRole="button">
                <Text style={styles.menuN}>05</Text>
                <Text style={styles.menuLabel}>Sign in</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => startPlan()} style={({ pressed }) => [styles.signal, styles.signalLg, styles.menuCta, { marginBottom: insets.bottom + PolarSpace.s4 }, pressed && styles.signalPressed]} accessibilityRole="button">
              <Text style={styles.signalText}>Plan a trip</Text>
            </Pressable>
          </BlurView>
        </Modal>

        {/* A fade modal with the sheet sliding inside it: `animationType="slide"` would slide the
            scrim up with the sheet, which reads as a second page arriving rather than a sheet. */}
        <Modal visible={how} transparent animationType="fade" onRequestClose={() => setHow(false)} onDismiss={restoreStatusBar} statusBarTranslucent>
          <Pressable style={styles.scrim} onPress={() => setHow(false)} accessibilityLabel="Close" />
          <Animated.View entering={SlideInDown.duration(450)} exiting={SlideOutDown.duration(300)} style={[styles.sheet, { paddingBottom: insets.bottom + PolarSpace.s3 }]}>
            <View style={styles.grabber} />
            <View style={styles.sheetHead}>
              <Text style={[PolarType.eyebrow, { color: Polar.ink }]} accessibilityRole="header">
                How it works
              </Text>
              <Pressable onPress={() => setHow(false)} style={({ pressed }) => [styles.quiet, pressed && styles.dim]} accessibilityRole="button">
                <Text style={styles.quietText}>Close</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              {STEPS.map((s) => (
                <View key={s.n} style={styles.step}>
                  <Text style={styles.stepN}>{s.n}.</Text>
                  <Text style={styles.stepTitle}>{s.title}</Text>
                  <Text style={[PolarType.bodyS, { color: Polar.charcoal }]}>{s.prose}</Text>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => startPlan()} style={({ pressed }) => [styles.signal, styles.signalLg, pressed && styles.signalPressed]} accessibilityRole="button">
              <Text style={styles.signalText}>Plan a trip</Text>
            </Pressable>
          </Animated.View>
        </Modal>
      </View>
    </MotionContext.Provider>
  );
}

/* ───────────────────────── Hero ───────────────────────── */

function Hero({ height, width, onMenu, onPlan, onWatch }: { height: number; width: number; onMenu: () => void; onPlan: () => void; onWatch: () => void }) {
  const insets = useSafeAreaInsets();
  const [destId, setDestId] = useState('petra');
  const dest = DESTS.find((d) => d.id === destId)!;
  const size = Math.min(width * 0.27, 150);
  const H = Math.max(height, 640);
  const { y, reduce } = useMotion();

  // The reference's [data-reveal]: 1.4s on its reveal curve, out of the hero's clipped bottom edge.
  const rise = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) return;
    rise.value = 0;
    rise.value = withTiming(1, { duration: 1400, easing: REVEAL });
  }, [destId, reduce, rise]);
  // The photograph is carried down at exactly scroll speed, so it holds still while the intro rises
  // over it like a curtain, dimming to 60% on the way out; the monument travels at 60% in front.
  const media = useAnimatedStyle(() => (reduce ? {} : { transform: [{ translateY: Math.min(Math.max(y.value, 0), H) }] }));
  const veil = useAnimatedStyle(() => ({ opacity: reduce ? 0 : interpolate(y.value, [0, H], [0, 0.6], Extrapolation.CLAMP) }));
  const lead = useAnimatedStyle(() =>
    reduce ? {} : { opacity: interpolate(y.value, [0, H * 0.4], [1, 0], Extrapolation.CLAMP), transform: [{ translateY: -Math.max(y.value, 0) * 0.15 }] },
  );
  const mon = useAnimatedStyle(() =>
    reduce ? {} : { opacity: rise.value, transform: [{ translateY: (1 - rise.value) * size + Math.min(Math.max(y.value, 0), H) * 0.6 }] },
  );

  return (
    <View style={[styles.hero, { height: H }]}>
      <Animated.View style={[StyleSheet.absoluteFill, media]} pointerEvents="none">
        <Image source={dest.img} style={StyleSheet.absoluteFill} contentFit="cover" transition={700} />
        <Scrim stops={[[0, Polar.night, 0.55], [0.22, Polar.night, 0], [0.42, Polar.night, 0], [1, Polar.night, 0.82]]} />
        <Animated.View style={[StyleSheet.absoluteFill, styles.veil, veil]} />
      </Animated.View>

      <View style={[styles.nav, { paddingTop: insets.top + PolarSpace.s2 }]}>
        <Wordmark light />
        <View style={styles.row}>
          <Pressable onPress={onMenu} style={({ pressed }) => [styles.glass, pressed && styles.dim]} accessibilityRole="button" accessibilityLabel="Open menu">
            <Text style={styles.glassText}>Menu</Text>
          </Pressable>
          {/* The landing's one "Plan a trip" above the fold, in the bar, as on the web. */}
          <Pressable onPress={onPlan} style={({ pressed }) => [styles.signal, pressed && styles.signalPressed]} accessibilityRole="button">
            <Text style={styles.signalText}>Plan a trip</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.heroFoot}>
        <Animated.View style={[styles.heroFoot, lead]}>
          <View style={styles.heroMid}>
            <Text style={[PolarType.lead, styles.heroLead]}>A trip planned against your real dates, budget and weather.</Text>
            <Pressable onPress={onWatch} style={({ pressed }) => [styles.ghost, pressed && styles.dim]} accessibilityRole="button">
              <Text style={styles.ghostText}>Watch a day play</Text>
              <Text style={styles.ghostText}>▸</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Destination">
            {DESTS.map((d) => {
              const on = d.id === destId;
              return (
                <Pressable key={d.id} onPress={() => setDestId(d.id)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <Text style={[styles.chipText, on && { color: Polar.ink }]}>{d.word}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={[PolarType.coord, styles.heroCoord]}>{dest.coord}</Text>
        </Animated.View>
        <Animated.View style={mon}>
          <Text style={[PolarType.monument, styles.monument, { fontSize: size, lineHeight: size * 1.02 }]} accessibilityRole="header" numberOfLines={1}>
            {dest.word}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

function Wordmark({ light }: { light?: boolean }) {
  const color = light ? Polar.ice : Polar.ink;
  return (
    <View style={styles.wordmark} accessibilityRole="header" accessibilityLabel="TripMate">
      <View style={[styles.peak, { borderBottomColor: color }]} />
      <Text style={[styles.wordmarkText, { color }]}>TripMate</Text>
    </View>
  );
}

/* ───────────────────────── Intro / Quote ───────────────────────── */

function Intro() {
  return (
    <View style={styles.intro}>
      <Text style={[PolarType.kicker, { color: Polar.ink }]}>The plan that already knows</Text>
      <Rise at="intro" fade>
        <Text style={styles.statement}>Forecast, holidays, opening hours and travel times go in first — before a single word of your plan is written.</Text>
      </Rise>
      <View style={styles.rule} />
      <Text style={[PolarType.eyebrow, { color: Polar.ink }]}>How a plan is made</Text>
      <Text style={[PolarType.body, { color: Polar.charcoal }]}>
        Tell TripMate where, when, how much and who is going. It fetches the real conditions for your dates, writes the days, then runs a second pass that critiques the plan against your budget and pace. Every pin is corrected against OpenStreetMap.
      </Text>
    </View>
  );
}

function Quote() {
  return (
    <View style={styles.quote}>
      <Text style={styles.quoteMark}>“</Text>
      {/* The app's own claim. The canvas had "a target to hit, not a ceiling"; the planner does the
          opposite and says so everywhere else. */}
      <Rise at="quote" fade>
        <Text style={styles.quoteText}>The budget is a ceiling, not a target. Say what you can spend, and the plan stays inside it rather than spending up to it.</Text>
      </Rise>
      <Text style={styles.quoteDash}>-</Text>
      <Text style={[PolarType.ui, { color: Polar.ink }]}>How TripMate plans</Text>
      <Text style={[PolarType.caption, { color: Polar.charcoal }]}>Step 01 · You set the constraints</Text>
    </View>
  );
}

/* ───────────────────────── Sample plans ───────────────────────── */

/** "Sep 12–20, 2027", or across months "Feb 27 – Mar 4, 2027", in UTC like every date here. */
function formatSpan(start: string, end: string) {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const mon = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return s.getUTCMonth() === e.getUTCMonth()
    ? `${mon(s)} ${s.getUTCDate()}–${e.getUTCDate()}, ${e.getUTCFullYear()}`
    : `${mon(s)} ${s.getUTCDate()} – ${mon(e)} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}
const spanLabel = (days: number) => `${days} days, ${Math.max(days - 1, 0)} ${days - 1 === 1 ? 'night' : 'nights'}`;
const partyLabel = (adults: number, children: number) =>
  `${adults} ${adults === 1 ? 'adult' : 'adults'}${children > 0 ? `, ${children} ${children === 1 ? 'child' : 'children'}` : ''}`;

function Plans({ width, onPlan }: { width: number; onPlan: (p: LandingPlan) => void }) {
  const cardW = width - PolarSpace.pad * 2 - 26;
  const step = cardW + PolarSpace.gutter;
  const [page, setPage] = useState(0);
  const ref = useRef<ScrollView>(null);
  const today = todayISO();
  return (
    <View style={styles.plans}>
      <View style={styles.sectionHead}>
        <Text style={[PolarType.display, styles.center, { color: Polar.ink }]} accessibilityRole="header">
          Sample plans
        </Text>
      </View>
      <Rise at="plans" distance={60}>
        <ScrollView
          ref={ref}
          horizontal
          snapToInterval={step}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: PolarSpace.pad, gap: PolarSpace.gutter }}
          onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / step))}
          scrollEventThrottle={16}>
          {PLANS.map((p) => {
            const { startDate, endDate } = toPrefill(p, today);
            return (
              <View key={p.id} style={[styles.planCard, { width: cardW, height: cardW * 1.38 }]}>
                <Image source={p.img} style={StyleSheet.absoluteFill} contentFit="cover" />
                <Scrim stops={[[0, Polar.night, 0.45], [0.3, Polar.night, 0], [0.45, Polar.night, 0], [1, Polar.night, 0.85]]} />
                <Text style={styles.planTitle}>{p.title}</Text>
                <View style={styles.planFoot}>
                  <View style={styles.row}>
                    <Text style={styles.planMeta}>From US ${p.budgetUsd.toLocaleString('en-US')}</Text>
                    <View style={styles.pipe} />
                    <Text style={styles.planMeta}>{p.season}</Text>
                  </View>
                  <View style={styles.facts}>
                    {(
                      [
                        ['Where', p.destination],
                        ['When', formatSpan(startDate, endDate)],
                        ['Length', spanLabel(p.days)],
                        ['Party', partyLabel(p.adults, p.children)],
                      ] as const
                    ).map(([k, v]) => (
                      <View key={k} style={styles.fact}>
                        <Text style={styles.factK}>{k}</Text>
                        <Text style={styles.factV}>{v}</Text>
                      </View>
                    ))}
                  </View>
                  <Pressable onPress={() => onPlan(p)} style={({ pressed }) => [styles.signal, styles.selfStart, pressed && styles.signalPressed]} accessibilityRole="button">
                    <Text style={styles.signalText}>Plan one like it</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </Rise>
      <View style={styles.dots} accessibilityRole="adjustable" accessibilityLabel={`Plan ${page + 1} of ${PLANS.length}`}>
        {PLANS.map((p, i) => (
          <Pressable key={p.id} onPress={() => ref.current?.scrollTo({ x: i * step, animated: true })} style={[styles.dot, i === page && styles.dotOn]} hitSlop={8} accessibilityLabel={`Go to ${p.title}`} />
        ))}
      </View>
    </View>
  );
}

/* ───────────────────────── What a plan knows ───────────────────────── */

function Knows({ width }: { width: number }) {
  const w = width - PolarSpace.pad * 2;
  return (
    <View style={styles.knows}>
      <View style={styles.sectionHead}>
        <Text style={[PolarType.kicker, styles.center, { color: Polar.ink }]}>Four things built in</Text>
        <Text style={[PolarType.display, styles.center, { color: Polar.ink }]} accessibilityRole="header">
          What a plan knows
        </Text>
      </View>
      {BEATS.map((b) => (
        <Rise key={b.id} at="knows" distance={70}>
          <View style={[styles.beat, { height: w * 1.05 }]}>
            <Image source={b.img} style={StyleSheet.absoluteFill} contentFit="cover" />
            <BlurView intensity={40} tint="dark" style={styles.beatCard}>
              <Text style={styles.beatLabel}>{b.label}</Text>
              <Text style={styles.beatStat}>{b.stat}</Text>
              <Text style={styles.beatProse}>{b.detail}</Text>
            </BlurView>
          </View>
        </Rise>
      ))}
    </View>
  );
}

/* ───────────────────────── Footer — Variant B "Monument" ───────────────────────── */

function nextMonths(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
    return { key: isoDay(d).slice(0, 7), label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) };
  });
}

/** A month picked here opens the wizard on its first week — dates the traveller then sees and edits. */
function monthPrefill(where: string, month: string, adults: number, budget: number | null): PlanPrefill {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { destination: where.trim(), startDate: isoDay(start), endDate: isoDay(end), adults, children: 0, ...(budget ? { budgetUsd: budget } : {}) };
}

function PlanFooter({
  width,
  bottom,
  onPlan,
  onHow,
  onGo,
  onSignIn,
}: {
  width: number;
  bottom: number;
  onPlan: (prefill?: PlanPrefill) => void;
  onHow: () => void;
  onGo: (s: Section) => void;
  onSignIn: () => void;
}) {
  const months = useMemo(() => nextMonths(6), []);
  const [where, setWhere] = useState('');
  const [month, setMonth] = useState<string | null>(null);
  const [party, setParty] = useState(2);
  const [budget, setBudget] = useState('');
  const [errors, setErrors] = useState<{ where?: string; month?: string }>({});
  const size = Math.min(width * 0.25, 160);
  const { y, vh, reduce, base } = useMotion();
  const h = useSharedValue(0);
  // The photograph moves slower than the page; the monument rises into place last.
  const photo = useAnimatedStyle(() =>
    reduce ? {} : { transform: [{ translateY: interpolate(base.plan.value - y.value, [vh, vh - h.value], [-0.1 * h.value, 0], Extrapolation.CLAMP) }] },
  );
  const mon = useAnimatedStyle(() =>
    reduce ? {} : { transform: [{ translateY: interpolate(base.plan.value + h.value - y.value, [vh + h.value * 0.5, vh], [size * 0.45, 0], Extrapolation.CLAMP) }] },
  );

  function submit() {
    const e: typeof errors = {};
    if (!where.trim()) e.where = 'Tell us where you’re going.';
    if (!month) e.month = 'Pick the month you’ll travel.';
    setErrors(e);
    if (e.where || e.month || !month) return;
    const amount = Number(budget);
    onPlan(monthPrefill(where, month, party, budget && amount > 0 ? amount : null));
  }

  const links: [string, () => void][] = [
    ['How it works', onHow],
    ['Sample plans', () => onGo('plans')],
    ['A day on the map', () => onGo('day')],
    ['What a plan knows', () => onGo('knows')],
    ['Sign in', onSignIn],
    ['Memories', () => router.push('/(tabs)/trips')],
  ];

  return (
    <View
      style={styles.fb}
      onLayout={(e) => {
        h.value = e.nativeEvent.layout.height;
      }}>
      <Animated.View style={[styles.fbPhoto, photo]} pointerEvents="none">
        <Image source={FOOT_PHOTO} style={StyleSheet.absoluteFill} contentFit="cover" />
      </Animated.View>
      <Scrim stops={[[0, Polar.night, 0.92], [0.3, Polar.night, 0.62], [0.7, Polar.night, 0.4], [1, Polar.night, 0.9]]} />

      <View style={styles.fbInner}>
        <View style={styles.fbTop}>
          <Text style={[PolarType.kicker, { color: Polar.ice }]}>Where to next?</Text>
          <Text style={[PolarType.coord, { color: Polar.nightText2 }]}>[ 29º 35’ N, 35º 25’ E ] · Wadi Rum</Text>
        </View>

        <View style={styles.fbLine}>
          <Text style={styles.fbTitle} accessibilityRole="header">
            Plan a trip
          </Text>
          <Text style={styles.fbSub}>Free · no account needed · drafts until you keep them</Text>
        </View>

        <BlurView intensity={60} tint="dark" style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Where</Text>
            <TextInput
              value={where}
              onChangeText={setWhere}
              placeholder="A city, region or country"
              placeholderTextColor={Polar.nightText2}
              autoCapitalize="words"
              returnKeyType="done"
              maxLength={120}
              style={[styles.input, !!errors.where && styles.inputErr]}
              accessibilityLabel="Where"
            />
            {errors.where && <Text style={styles.err}>{errors.where}</Text>}
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>When</Text>
            {/* `handled`, like the page: a nested scroller defaults to `never`, so with the keyboard up
                the first tap on a month only dismissed it and the choice was lost. */}
            <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="Month">
              {months.map((m) => {
                const on = m.key === month;
                return (
                  <Pressable key={m.key} onPress={() => setMonth(m.key)} style={[styles.monthChip, on && styles.monthChipOn, !!errors.month && !month && styles.inputErr]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <Text style={[styles.monthText, on && { color: Polar.ink }]}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {errors.month && <Text style={styles.err}>{errors.month}</Text>}
          </View>

          <View style={styles.row2}>
            <Stepper label="Travellers" value={party} min={1} max={12} onChange={setParty} />
            {/* Budget rather than a tier toggle: the planner derives the tier from the budget, so a
                tier picked here would be a question nothing listens to. */}
            <View style={[styles.field, styles.flex]}>
              <Text style={styles.fieldLabel}>Budget</Text>
              <TextInput
                value={budget}
                onChangeText={(t) => setBudget(t.replace(/[^\d]/g, ''))}
                placeholder="US $, optional"
                placeholderTextColor={Polar.nightText2}
                keyboardType="number-pad"
                maxLength={7}
                style={styles.input}
                accessibilityLabel="Budget in US dollars, optional"
              />
            </View>
          </View>

          <Pressable onPress={submit} style={({ pressed }) => [styles.signal, styles.signalLg, pressed && styles.signalPressed]} accessibilityRole="button">
            <Text style={styles.signalText}>Plan my trip</Text>
            <Text style={styles.signalText}>→</Text>
          </Pressable>
        </BlurView>

        <View style={styles.fbFacts}>
          {FACTS.map(([k, v]) => (
            <View key={k} style={styles.fbFact}>
              <Text style={[PolarType.eyebrow, { color: Polar.ice }]}>{k}</Text>
              <Text style={[PolarType.caption, { color: Polar.nightText2 }]}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={styles.fbLinks}>
          {links.map(([label, onPress]) => (
            <Pressable key={label} onPress={onPress} style={({ pressed }) => pressed && styles.dim} accessibilityRole="link" hitSlop={6}>
              <Text style={styles.fbLink}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[PolarType.caption, { color: Polar.nightText2 }]}>Photography via Pexels and Unsplash</Text>
      </View>

      <Animated.View style={mon}>
        <Text
          style={[PolarType.monument, styles.fbMonument, { fontSize: size, lineHeight: size * 1.02, marginBottom: bottom }]}
          numberOfLines={1}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          TripMate
        </Text>
      </Animated.View>
    </View>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <View style={[styles.field, styles.flex]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.stepper} accessibilityRole="adjustable" accessibilityLabel={`${label}: ${value}`}>
        <Pressable onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} style={({ pressed }) => [styles.stepBtn, pressed && styles.stepPressed]} accessibilityLabel={`Fewer ${label.toLowerCase()}`}>
          <Text style={[styles.stepSign, value <= min && styles.off]}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} style={({ pressed }) => [styles.stepBtn, pressed && styles.stepPressed]} accessibilityLabel={`More ${label.toLowerCase()}`}>
          <Text style={[styles.stepSign, value >= max && styles.off]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ───────────────────────── Styles ───────────────────────── */

const NIGHT_FIELD = 'rgba(9,11,16,0.35)';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Polar.ice },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row2: { flexDirection: 'row', gap: PolarSpace.s3 },
  selfStart: { alignSelf: 'flex-start' },
  dim: { opacity: 0.72 },
  off: { opacity: 0.35 },

  glass: { height: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: PolarRadius.hairline, backgroundColor: Polar.veil20, borderWidth: 1, borderColor: Polar.frost20 },
  glassText: { fontFamily: PolarFonts.sans, fontSize: 14, color: Polar.ice },
  signal: { height: 36, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, borderRadius: PolarRadius.hairline, backgroundColor: Polar.signal },
  signalPressed: { backgroundColor: Polar.signalPressed },
  signalLg: { height: 46, paddingHorizontal: 22 },
  signalText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },
  quiet: { height: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: PolarRadius.hairline, backgroundColor: Polar.veil05 },
  quietText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },
  ghost: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: 190, paddingVertical: 10, paddingHorizontal: 2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: Polar.frost20 },
  ghostText: { fontFamily: PolarFonts.sans, fontSize: 14, color: Polar.ice },

  hero: { overflow: 'hidden', backgroundColor: Polar.ink, justifyContent: 'space-between' },
  veil: { backgroundColor: Polar.night },
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: PolarSpace.pad },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  peak: { width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  wordmarkText: { fontFamily: PolarFonts.condensed, fontSize: 17, letterSpacing: 1.2, textTransform: 'uppercase' },
  heroMid: { paddingHorizontal: PolarSpace.pad, gap: PolarSpace.s3, marginBottom: PolarSpace.s3 },
  heroLead: { color: Polar.ice, maxWidth: 260, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 12 },
  heroFoot: { gap: PolarSpace.s2 },
  chips: { paddingHorizontal: PolarSpace.pad, gap: 6 },
  chip: { height: 32, paddingHorizontal: 13, justifyContent: 'center', borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.frost20, backgroundColor: 'rgba(9,11,16,0.22)' },
  chipOn: { backgroundColor: Polar.ice, borderColor: Polar.ice },
  chipText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ice },
  heroCoord: { color: Polar.ice, paddingHorizontal: PolarSpace.pad },
  monument: { color: Polar.ice, textAlign: 'center', marginTop: PolarSpace.s2 },

  intro: { paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s12, paddingBottom: PolarSpace.s10, gap: PolarSpace.s4 },
  statement: { fontFamily: PolarFonts.display, fontSize: 28, lineHeight: 29, textTransform: 'uppercase', color: Polar.ink },
  rule: { height: 1, backgroundColor: Polar.rule, marginTop: PolarSpace.s3 },
  quote: { paddingHorizontal: PolarSpace.s5, paddingVertical: PolarSpace.s12, gap: PolarSpace.s2 },
  quoteMark: { fontFamily: PolarFonts.display, fontSize: 48, lineHeight: 52, height: 30, color: Polar.ink },
  quoteText: { fontFamily: PolarFonts.displayItalic, fontSize: 24, lineHeight: 29, color: Polar.ink },
  quoteDash: { fontFamily: PolarFonts.sans, fontSize: 14, color: Polar.ink, marginTop: PolarSpace.s3 },

  sectionHead: { alignItems: 'center', gap: PolarSpace.s2, paddingHorizontal: PolarSpace.pad, marginBottom: PolarSpace.s6 },
  plans: { paddingTop: PolarSpace.s8, paddingBottom: PolarSpace.s8 },
  planCard: { borderRadius: PolarRadius.card, overflow: 'hidden', justifyContent: 'space-between', padding: PolarSpace.s4 },
  planTitle: { fontFamily: PolarFonts.displayItalic, fontSize: 34, lineHeight: 36, color: Polar.ice, maxWidth: 230 },
  planFoot: { gap: PolarSpace.s3 },
  planMeta: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ice },
  pipe: { width: 1, height: 13, backgroundColor: 'rgba(255,255,255,0.6)', marginHorizontal: 6 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  fact: { width: '50%', paddingRight: 8 },
  factK: { fontFamily: PolarFonts.displayItalic, fontSize: 15, color: 'rgba(255,255,255,0.85)' },
  factV: { fontFamily: PolarFonts.sans, fontSize: 13, color: Polar.ice },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: PolarSpace.s4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Polar.beige },
  dotOn: { width: 22, backgroundColor: Polar.ink },

  knows: { backgroundColor: Polar.paper, paddingTop: PolarSpace.s8, paddingBottom: PolarSpace.s10, paddingHorizontal: PolarSpace.pad, gap: PolarSpace.gutter },
  beat: { borderRadius: PolarRadius.card, overflow: 'hidden', justifyContent: 'flex-end', padding: PolarSpace.s3 },
  beatCard: { padding: PolarSpace.s4, gap: 6, alignItems: 'center', borderRadius: PolarRadius.card, borderWidth: 1, borderColor: Polar.frost20, overflow: 'hidden' },
  beatLabel: { fontFamily: PolarFonts.display, fontSize: 26, lineHeight: 28, textTransform: 'uppercase', color: Polar.ice, textAlign: 'center' },
  beatStat: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ice, textAlign: 'center' },
  beatProse: { fontFamily: PolarFonts.sans, fontSize: 12, lineHeight: 17, color: 'rgba(255,255,255,0.88)', textAlign: 'center' },

  // Footer: one dark band over the Wadi Rum photograph.
  fb: { overflow: 'hidden', backgroundColor: Polar.night },
  // 20% taller than the band, so its slower travel never shows an edge.
  fbPhoto: { position: 'absolute', left: 0, right: 0, top: '-10%', height: '120%' },
  fbInner: { gap: PolarSpace.s5, paddingTop: PolarSpace.s6, paddingHorizontal: PolarSpace.pad, paddingBottom: PolarSpace.s3 },
  fbTop: { gap: 6, paddingBottom: PolarSpace.s3, borderBottomWidth: 1, borderColor: Polar.frost20 },
  fbLine: { gap: PolarSpace.s2 },
  fbTitle: { fontFamily: PolarFonts.display, fontSize: 54, lineHeight: 56, textTransform: 'uppercase', color: Polar.ice },
  fbSub: { fontFamily: PolarFonts.displayItalic, fontSize: 17, lineHeight: 21, color: Polar.nightText2 },
  card: { gap: PolarSpace.s4, padding: PolarSpace.s4, borderRadius: PolarRadius.card, borderWidth: 1, borderColor: Polar.frost10, overflow: 'hidden' },
  field: { gap: 7 },
  fieldLabel: { fontFamily: PolarFonts.displayItalic, fontSize: 17, color: Polar.ice },
  input: { height: 46, paddingHorizontal: 13, borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: Polar.frost20, backgroundColor: NIGHT_FIELD, fontFamily: PolarFonts.sans, fontSize: 16, color: Polar.ice },
  inputErr: { borderColor: Polar.alertNight },
  err: { fontFamily: PolarFonts.sansSemi, fontSize: 12, color: Polar.alertNight },
  monthChip: { height: 40, paddingHorizontal: 13, justifyContent: 'center', borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: Polar.frost20, backgroundColor: NIGHT_FIELD },
  monthChipOn: { backgroundColor: Polar.ice, borderColor: Polar.ice },
  monthText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ice },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: Polar.frost20, backgroundColor: NIGHT_FIELD, overflow: 'hidden' },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepPressed: { backgroundColor: Polar.frost10 },
  stepSign: { fontFamily: PolarFonts.sans, fontSize: 19, color: Polar.ice },
  stepValue: { flex: 1, textAlign: 'center', fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ice },
  fbFacts: { gap: PolarSpace.s3 },
  fbFact: { gap: 4, paddingLeft: PolarSpace.s2, borderLeftWidth: 1, borderColor: Polar.frost20 },
  fbLinks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: PolarSpace.s4, rowGap: PolarSpace.s2, paddingTop: PolarSpace.s3, borderTopWidth: 1, borderColor: Polar.frost10 },
  fbLink: { fontFamily: PolarFonts.sans, fontSize: 14, lineHeight: 22, color: Polar.ice },
  fbMonument: { color: Polar.ice, opacity: 0.94, textAlign: 'center' },

  statusGround: { position: 'absolute', top: 0, left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Polar.rule },
  barWrap: { position: 'absolute', left: PolarSpace.pad, right: PolarSpace.pad },
  bar: { flexDirection: 'row', gap: 6, padding: 6, borderRadius: PolarRadius.md, borderWidth: 1, borderColor: Polar.frost20, overflow: 'hidden' },
  barQuiet: { height: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.frost20 },
  barQuietText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ice },
  menuHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menuList: { marginTop: PolarSpace.s10 },
  menuRow: { flexDirection: 'row', alignItems: 'baseline', gap: 14, paddingVertical: 14, borderTopWidth: 1, borderColor: Polar.frost10 },
  menuN: { fontFamily: PolarFonts.sansSemi, fontSize: 12, color: Polar.nightText2 },
  menuLabel: { fontFamily: PolarFonts.display, fontSize: 30, lineHeight: 34, textTransform: 'uppercase', color: Polar.ice },
  menuCta: { marginTop: 'auto' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(31,42,68,0.5)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%', backgroundColor: Polar.ice, borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingHorizontal: PolarSpace.pad, gap: PolarSpace.s3 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: Polar.beige, marginTop: 8 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetScroll: { flexGrow: 0 },
  step: { gap: 5, paddingVertical: PolarSpace.s3, borderTopWidth: 1, borderColor: Polar.rule },
  stepN: { fontFamily: PolarFonts.sansSemi, fontSize: 12, color: Polar.charcoal },
  stepTitle: { fontFamily: PolarFonts.displayItalic, fontSize: 24, lineHeight: 27, color: Polar.ink },
});
