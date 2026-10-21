import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
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

import { LENSES, petraPrefill, petraSampleDate, type LensId } from '@shared/petraDay';
import { toPrefill, type PlanPrefill } from '@shared/planExamples';
import { DateField } from '@/components/form';
import { Polar, PolarFonts, PolarRadius, PolarSpace, PolarType } from '@/constants/polar';
import { crossFieldProblem } from '@/lib/formGap';
import { BEATS, DESTS, FACTS, FOOT_PHOTO, PLANS, type LandingPlan } from './content';
import { DayStory, OpenDaySheet, PlanMap, TickContext, Ways, type Tick } from './imagine';
import { Scrim } from './scrim';

/**
 * The Polar Interior landing, for the phone — the "TripMate — Polar Landing (Mobile)" design on the
 * MagicPath canvas: the welcome a signed-out phone opens on once (`launchTarget` in
 * `lib/authGate.ts`), and the tour Profile opens later.
 *
 * **On the welcome there is nothing under it yet but Home**, so it offers Skip into the app, and
 * the plan and sign-in it leads to *replace* it: closing either lands on Home, not back here. As the
 * tour, it is pushed over Profile, so it offers Close and the hand-offs push as before.
 *
 * **It hands off rather than mocks.** Every "plan" here opens the real wizard at `/plan/basics`,
 * prefilled through route params where it knows what to say (`draftFromPrefill`): a sample plan's
 * where, dates, budget and party; the Petra day's dates and travellers; or the closing form's where
 * and dates, with no budget or party because it did not ask. Signing in is offered, never required.
 */
type Section = 'day' | 'ways' | 'map' | 'plans' | 'knows' | 'plan';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** Today on the traveller's own calendar, as `YYYY-MM-DD` — the day the native picker calls today. */
const todayISO = () => {
  const now = new Date();
  return isoDay(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
};
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Wed 14 Apr 2027", read in UTC like every date-only value here. By hand rather than through
 *  `toLocaleDateString`, whose separators differ between ICU builds. */
function sampleLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Into the wizard, with whatever this landing can honestly fill in. Absent is not zero. */
function openWizard(prefill: PlanPrefill, welcome: boolean) {
  (welcome ? router.replace : router.push)({
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
type Motion = { y: SharedValue<number>; vh: number; reduce: boolean; base: Record<Section, SharedValue<number>> };
const MotionContext = createContext<Motion | null>(null);
const useMotion = () => useContext(MotionContext)!;
const REVEAL = Easing.bezier(0.16, 1, 0.3, 1);
const ROTATE_MS = 6000;

/**
 * Rises into place as it comes up the screen. Must be a direct child of the section `at` names, so
 * its onLayout y is local to it.
 */
function Rise({ at, distance = 40, style, children }: { at: Section; distance?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { y, vh, reduce, base } = useMotion();
  const top = useSharedValue(0);
  const a = useAnimatedStyle(() => {
    if (reduce) return {};
    const p = interpolate(base[at].value + top.value - y.value, [vh * 0.92, vh * 0.55], [0, 1], Extrapolation.CLAMP);
    return { transform: [{ translateY: (1 - p) * distance }] };
  });
  return (
    <Animated.View
      style={[style, a]}
      onLayout={(e) => {
        top.set(e.nativeEvent.layout.y);
      }}>
      {children}
    </Animated.View>
  );
}

/** Out of the landing into the app: Home on the welcome, wherever it was opened from otherwise. */
function leave(welcome: boolean) {
  if (welcome || !router.canGoBack()) router.dismissTo('/(tabs)');
  else router.back();
}

export function PolarLandingScreen({ welcome = false }: { welcome?: boolean }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const y = useScrollOffset(scroll);
  const reduce = useReducedMotion();
  const offsets = useRef<Partial<Record<Section, number>>>({});
  const day = useSharedValue(0);
  const ways = useSharedValue(0);
  const mapTop = useSharedValue(0);
  const plans = useSharedValue(0);
  const knows = useSharedValue(0);
  const plan = useSharedValue(0);
  const motion = useMemo<Motion>(
    () => ({ y, vh: height, reduce, base: { day, ways, map: mapTop, plans, knows, plan } }),
    [y, height, reduce, day, ways, mapTop, plans, knows, plan],
  );
  // Sections whose *state* follows the scroll (the lit beat, the globe's first flight) listen here.
  const [ticks] = useState(() => new Set<Tick>());
  const tick = useMemo(
    () => ({
      add: (f: Tick) => {
        ticks.add(f);
        return () => {
          ticks.delete(f);
        };
      },
    }),
    [ticks],
  );
  const [showBar, setShowBar] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [lens, setLens] = useState<LensId>('slow');
  const [hot, setHot] = useState<string | null>(null);
  const [today] = useState(todayISO);
  const dateLabel = sampleLabel(petraSampleDate(today));

  // Written from the layout event itself, never from render — the compiler lint's ref rule.
  const record = (s: Section, e: LayoutChangeEvent) => {
    const at = e.nativeEvent.layout.y;
    offsets.current[s] = at;
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
  const startPlan = useCallback(
    (prefill: PlanPrefill) => {
      setSheet(false);
      openWizard(prefill, welcome);
    },
    [welcome],
  );
  const signIn = useCallback(() => (welcome ? router.replace('/signin') : router.push('/signin')), [welcome]);
  const openStop = (id: string) => {
    setLens('slow');
    setHot(id);
    go('map');
  };

  // **Set imperatively, and again after every modal.** Presenting an RN `Modal` on iOS resets the
  // status bar, and a mounted <StatusBar> never re-asserts itself afterwards — measured here: dark
  // before the How-it-works sheet opened, white over a white page for good once it closed. The
  // modals sit on dark scrims, so they get light; the page gets whatever it is scrolled to.
  useEffect(() => {
    setStatusBarStyle(menu || sheet || !pastHero ? 'light' : 'dark', true);
  }, [menu, sheet, pastHero]);
  // iOS can reset it again when the dismissal *finishes*, after the effect above has run.
  const restoreStatusBar = () => setStatusBarStyle(pastHero ? 'dark' : 'light', true);
  // And when How it works, a route of its own, closes back onto this one.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(pastHero ? 'dark' : 'light', true);
    }, [pastHero]),
  );
  // The one How it works, Home's own sheet (`app/how-it-works.tsx`): this page used to keep a second
  // with its own copy, and the two said different things about the same four steps.
  // From the menu it waits for the menu to go: iOS will not present a sheet from under an RN Modal
  // that is still on its way out, so the push runs from the menu's `onDismiss` (iOS only).
  const afterMenu = useRef<(() => void) | null>(null);
  const openHow = () => {
    const show = () => router.push('/how-it-works');
    if (menu && Platform.OS === 'ios') afterMenu.current = show;
    else show();
    setMenu(false);
  };

  // Only the bar's visibility is state — a scroll offset in state would re-render the map 60x/s.
  // The motion reads the same scroll through `useScrollOffset`, on the UI thread.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const at = e.nativeEvent.contentOffset.y;
    ticks.forEach((f) => f(at, height));
    setShowBar(at > height * 0.85 && at < (offsets.current.plan ?? Infinity) - height * 0.6);
    // Past the photograph white clock-and-battery on a white page disappears, so the bar goes
    // dark and gets a frosted ground to sit on instead of the page's text.
    setPastHero(at > Math.max(height, 640) - insets.top);
  };

  const menuItems: [Section, string][] = [
    ['day', 'A day in Petra'],
    ['ways', 'Four ways'],
    ['map', 'The plan'],
    ['plans', 'More journeys'],
    ['knows', 'What a plan knows'],
    ['plan', 'Plan a trip'],
  ];

  return (
    <MotionContext.Provider value={motion}>
      <TickContext.Provider value={tick}>
        <View style={styles.screen}>
          <Animated.ScrollView ref={scroll} style={styles.flex} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never" automaticallyAdjustKeyboardInsets>
            <Hero height={height} width={width} welcome={welcome} onLeave={() => leave(welcome)} onMenu={() => setMenu(true)} onPlan={() => go('plan')} onWatch={() => go('day')} />
            <View onLayout={(e) => record('day', e)}>
              <DayStory top={day} width={width} onOpenStop={openStop} onWays={() => go('ways')} />
            </View>
            <View onLayout={(e) => record('ways', e)}>
              <Ways lens={lens} setLens={setLens} width={width} />
            </View>
            <View onLayout={(e) => record('map', e)}>
              <PlanMap top={mapTop} width={width} lens={lens} setLens={setLens} hot={hot} setHot={setHot} dateLabel={dateLabel} onOpen={() => setSheet(true)} />
            </View>
            <View onLayout={(e) => record('plans', e)}>
              <Plans width={width} today={today} onPlan={(p) => startPlan(toPrefill(p, today))} />
            </View>
            <View onLayout={(e) => record('knows', e)}>
              <Knows width={width} />
            </View>
            <View onLayout={(e) => record('plan', e)}>
              <PlanFooter
                width={width}
                bottom={insets.bottom}
                today={today}
                carry={`Petra · ${dateLabel} · ${LENSES[lens].name}. Or start from your own idea below.`}
                onPlan={startPlan}
                onOpenDay={() => setSheet(true)}
                onHow={openHow}
                onGo={go}
                onSignIn={signIn}
              />
            </View>
          </Animated.ScrollView>

          {pastHero && <BlurView intensity={70} tint="light" style={[styles.statusGround, { height: insets.top }]} pointerEvents="none" />}

          {showBar && (
            <View style={[styles.barWrap, { bottom: insets.bottom + 6 }]} pointerEvents="box-none">
              <BlurView intensity={60} tint="dark" style={styles.bar}>
                <Pressable onPress={openHow} style={({ pressed }) => [styles.barQuiet, pressed && styles.dim]} accessibilityRole="button">
                  <Text style={styles.barQuietText}>How it works</Text>
                </Pressable>
                <Pressable onPress={() => go('plan')} style={({ pressed }) => [styles.signal, styles.flex, pressed && styles.signalPressed]} accessibilityRole="button">
                  <Text style={styles.signalText}>Plan a trip</Text>
                </Pressable>
              </BlurView>
            </View>
          )}

          <Modal
            visible={menu}
            transparent
            animationType="fade"
            onRequestClose={() => setMenu(false)}
            onDismiss={() => {
              restoreStatusBar();
              afterMenu.current?.();
              afterMenu.current = null;
            }}
            statusBarTranslucent>
            <BlurView intensity={80} tint="dark" style={[StyleSheet.absoluteFill, { paddingTop: insets.top + PolarSpace.s3, paddingHorizontal: PolarSpace.pad }]}>
              <View style={styles.menuHead}>
                <Wordmark light />
                <Pressable onPress={() => setMenu(false)} hitSlop={TOP_BAR_SLOP} style={({ pressed }) => [styles.glass, pressed && styles.dim]} accessibilityRole="button" accessibilityLabel="Close menu">
                  <Text style={styles.glassText}>Close</Text>
                </Pressable>
              </View>
              <View style={styles.menuList}>
                {menuItems.map(([k, label], i) => (
                  <Pressable key={k} onPress={() => go(k)} style={({ pressed }) => [styles.menuRow, pressed && styles.dim]} accessibilityRole="link">
                    <Text style={styles.menuN}>{pad(i + 1)}</Text>
                    <Text style={styles.menuLabel}>{label}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={openHow} style={({ pressed }) => [styles.menuRow, pressed && styles.dim]} accessibilityRole="button">
                  <Text style={styles.menuN}>{pad(menuItems.length + 1)}</Text>
                  <Text style={styles.menuLabel}>How it works</Text>
                </Pressable>
              </View>
              <Text style={[PolarType.coord, styles.menuCoord, { marginBottom: insets.bottom + PolarSpace.s6 }]}>[ 42º 20’ 23” N, 71º 05’ 22” W ]</Text>
            </BlurView>
          </Modal>

          <OpenDaySheet visible={sheet} lens={lens} dateLabel={dateLabel} onClose={() => setSheet(false)} onDismiss={restoreStatusBar} onOpen={(adults) => startPlan(petraPrefill(today, adults))} />
        </View>
      </TickContext.Provider>
    </MotionContext.Provider>
  );
}

/* ───────────────────────── Hero ───────────────────────── */

function Hero({
  height,
  width,
  welcome,
  onLeave,
  onMenu,
  onPlan,
  onWatch,
}: {
  height: number;
  width: number;
  welcome: boolean;
  onLeave: () => void;
  onMenu: () => void;
  onPlan: () => void;
  onWatch: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [destId, setDestId] = useState('petra');
  // Bumped by every tap, so picking the place already showing still restarts its clock.
  const [picks, setPicks] = useState(0);
  const dest = DESTS.find((d) => d.id === destId)!;
  const size = Math.min(width * 0.27, 150);
  const H = Math.max(height, 640);
  const { y, reduce } = useMotion();

  // Moves on every ROTATE_MS; picking a place restarts the clock; reduced motion never rotates.
  // The active chip fills along its bottom edge over the interval, on the UI thread.
  const fill = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    fill.set(0);
    fill.set(withTiming(1, { duration: ROTATE_MS, easing: Easing.linear }));
    const t = setTimeout(() => {
      const i = DESTS.findIndex((d) => d.id === destId);
      setDestId(DESTS[(i + 1) % DESTS.length].id);
    }, ROTATE_MS);
    return () => clearTimeout(t);
  }, [destId, picks, reduce, fill]);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));

  // The reference's [data-reveal]: 1.4s on its reveal curve, out of the hero's clipped bottom edge.
  const rise = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) return;
    rise.set(0);
    rise.set(withTiming(1, { duration: 1400, easing: REVEAL }));
  }, [destId, reduce, rise]);
  // The photograph is carried down at exactly scroll speed, so it holds still while the next
  // section rises over it like a curtain, dimming to 60% on the way out; the monument travels at
  // 60% in front.
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
        <Scrim stops={[[0, Polar.night, 0.55], [0.22, Polar.night, 0], [0.42 - FOOT_SCRIM_LIFT / H, Polar.night, 0], [1, Polar.night, 0.82]]} />
        <Animated.View style={[StyleSheet.absoluteFill, styles.veil, veil]} />
      </Animated.View>

      <View style={[styles.nav, { paddingTop: insets.top + PolarSpace.s2 }]}>
        <Wordmark light />
        <View style={styles.row}>
          {/* The way into the app, as iOS onboarding puts it: plain text in the top bar, quieter than
              the two buttons beside it. Skip on the welcome, Close on the tour. */}
          <Pressable onPress={onLeave} hitSlop={TOP_BAR_SLOP} style={({ pressed }) => [styles.leave, pressed && styles.dim]} accessibilityRole="button" accessibilityLabel={welcome ? 'Skip to the app' : 'Close'}>
            <Text style={styles.leaveText}>{welcome ? 'Skip' : 'Close'}</Text>
          </Pressable>
          <Pressable onPress={onMenu} hitSlop={TOP_BAR_SLOP} style={({ pressed }) => [styles.glass, pressed && styles.dim]} accessibilityRole="button" accessibilityLabel="Open menu">
            <Text style={styles.glassText}>Menu</Text>
          </Pressable>
          <Pressable onPress={onPlan} hitSlop={TOP_BAR_SLOP} style={({ pressed }) => [styles.signal, pressed && styles.signalPressed]} accessibilityRole="button">
            <Text style={styles.signalText}>Plan a trip</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.heroFoot}>
        <Animated.View style={[styles.heroFoot, lead]}>
          <View style={styles.heroMid}>
            <Text style={[PolarType.lead, styles.heroLead]}>Be there before the day arrives. Imagine it first and TripMate plans the rest.</Text>
            <Pressable onPress={onWatch} style={({ pressed }) => [styles.ghost, pressed && styles.dim]} accessibilityRole="button">
              <Text style={styles.ghostText}>Picture a day in Petra</Text>
              <Text style={styles.ghostText}>↓</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Destination">
            {DESTS.map((d) => {
              const on = d.id === destId;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => {
                    setDestId(d.id);
                    setPicks((n) => n + 1);
                  }}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}>
                  <Text style={[styles.chipText, on && { color: Polar.ink }]}>{d.word}</Text>
                  {on && !reduce && <Animated.View style={[styles.chipFill, fillStyle]} />}
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

export function Wordmark({ light }: { light?: boolean }) {
  const color = light ? Polar.ice : Polar.ink;
  return (
    <View style={styles.wordmark} accessibilityRole="header" accessibilityLabel="TripMate">
      <View style={[styles.peak, { borderBottomColor: color }]} />
      <Text style={[styles.wordmarkText, { color }]}>TripMate</Text>
    </View>
  );
}

/* ───────────────────────── Sample journeys ───────────────────────── */

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

function Plans({ width, today, onPlan }: { width: number; today: string; onPlan: (p: LandingPlan) => void }) {
  const cardW = width - PolarSpace.pad * 2 - 26;
  const step = cardW + PolarSpace.gutter;
  const [page, setPage] = useState(0);
  const ref = useRef<ScrollView>(null);
  return (
    <View style={styles.plans}>
      <View style={styles.sectionHead}>
        <Text style={[PolarType.kicker, styles.center, { color: Polar.ink }]}>Sample journeys</Text>
        <Text style={[PolarType.display, styles.center, { color: Polar.ink }]} accessibilityRole="header">
          More journeys to imagine
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
      {/* One adjustable element for VoiceOver (swipe up and down to page), the dots for touch. */}
      <View
        style={styles.dots}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Sample journeys"
        accessibilityValue={{ text: `${page + 1} of ${PLANS.length}, ${PLANS[page]?.title ?? ''}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const i = Math.min(PLANS.length - 1, Math.max(0, page + (e.nativeEvent.actionName === 'increment' ? 1 : -1)));
          ref.current?.scrollTo({ x: i * step, animated: true });
          setPage(i);
        }}>
        {PLANS.map((p, i) => (
          <Pressable key={p.id} onPress={() => ref.current?.scrollTo({ x: i * step, animated: true })} style={[styles.dot, i === page && styles.dotOn]} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Go to ${p.title}`} />
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

/* ───────────────────────── Footer: Variant B "Monument" ───────────────────────── */

function PlanFooter({
  width,
  bottom,
  today,
  carry,
  onPlan,
  onOpenDay,
  onHow,
  onGo,
  onSignIn,
}: {
  width: number;
  bottom: number;
  today: string;
  /** The line under "Open this day in the planner": which day, and which way of it. */
  carry: string;
  onPlan: (prefill: PlanPrefill) => void;
  onOpenDay: () => void;
  onHow: () => void;
  onGo: (s: Section) => void;
  onSignIn: () => void;
}) {
  const [where, setWhere] = useState('');
  // A native picker always draws *some* date, so the fields start on the wizard's own defaults (a
  // month out, for six nights) rather than pretending to be empty.
  const [start, setStart] = useState(() => addDays(today, 30));
  const [end, setEnd] = useState(() => addDays(today, 36));
  const [errors, setErrors] = useState<{ where?: string; dates?: string }>({});
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
    const e = { where: where.trim() ? undefined : 'Tell us where you’re going.', dates: crossFieldProblem(start, end) };
    setErrors(e);
    if (e.where || e.dates) return;
    onPlan({ destination: where.trim(), startDate: start, endDate: end });
  }

  const links: [string, () => void][] = [
    ['How it works', onHow],
    ['A day in Petra', () => onGo('day')],
    ['Four ways', () => onGo('ways')],
    ['The plan', () => onGo('map')],
    ['More journeys', () => onGo('plans')],
    ['Sign in', onSignIn],
  ];

  return (
    <View
      style={styles.fb}
      onLayout={(e) => {
        h.set(e.nativeEvent.layout.height);
      }}>
      <Animated.View style={[styles.fbPhoto, photo]} pointerEvents="none">
        <Image source={FOOT_PHOTO} style={StyleSheet.absoluteFill} contentFit="cover" />
      </Animated.View>
      <Scrim stops={[[0, Polar.night, 0.92], [0.3, Polar.night, 0.62], [0.7, Polar.night, 0.4], [1, Polar.night, 0.9]]} />

      <View style={styles.fbInner}>
        <View style={styles.fbTop}>
          <Text style={[PolarType.kicker, { color: Polar.ice }]}>Let’s make yours.</Text>
          <Text style={[PolarType.coord, { color: Polar.nightText2 }]}>[ 29º 35’ N, 35º 25’ E ] · Wadi Rum</Text>
        </View>

        <View style={styles.fbLine}>
          <Text style={styles.fbTitle} accessibilityRole="header">
            Plan a trip
          </Text>
          <Text style={styles.fbSub}>Free · no account needed · drafts until you keep them</Text>
        </View>

        <View style={styles.fbCarry}>
          <Pressable onPress={onOpenDay} style={({ pressed }) => [styles.signal, styles.signalLg, pressed && styles.signalPressed]} accessibilityRole="button">
            <Text style={styles.signalText}>Open this day in the planner</Text>
            <Text style={styles.signalText}>→</Text>
          </Pressable>
          <Text style={[PolarType.caption, { color: Polar.nightText2 }]}>{carry}</Text>
        </View>

        <BlurView intensity={60} tint="dark" style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Where</Text>
            <TextInput
              value={where}
              onChangeText={(t) => {
                setWhere(t);
                setErrors(({ dates }) => ({ dates }));
              }}
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

          {/* The platform's own pickers, the wizard's own fields: the same rule (`crossFieldProblem`)
              is checked here and again at /plan/basics, so the hand-off can never carry a range the
              next screen refuses. */}
          <View style={[styles.dates, !!errors.dates && styles.inputErr]}>
            <DateField
              label="Arriving"
              value={start}
              minimumDate={today}
              style={styles.dateRow}
              labelStyle={styles.fieldLabel}
              accentColor={Polar.signal}
              onChange={(d) => {
                setStart(d);
                // Keep the range whole: a departure before the new arrival moves to the day after.
                if (end < d) setEnd(addDays(d, 1));
                setErrors(({ where: w }) => ({ where: w }));
              }}
            />
            <View style={styles.dateRule} />
            <DateField
              label="Leaving"
              value={end}
              minimumDate={start}
              style={styles.dateRow}
              labelStyle={styles.fieldLabel}
              accentColor={Polar.signal}
              onChange={(d) => {
                setEnd(d);
                setErrors(({ where: w }) => ({ where: w }));
              }}
            />
          </View>
          {errors.dates && <Text style={styles.err}>{errors.dates}</Text>}

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
        <Text style={[PolarType.caption, { color: Polar.nightText2 }]}>Photography via Pexels and Unsplash · every journey here is a sample</Text>
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

/* ───────────────────────── Styles ───────────────────────── */

const NIGHT_FIELD = 'rgba(9,11,16,0.35)';
/** The top bar's buttons are drawn 36pt tall; this brings each touch to the 44pt floor. Vertical
 *  only: they sit 6pt apart, and a sideways slop would hand a tap on one to its neighbour. */
const TOP_BAR_SLOP = { top: 4, bottom: 4 };
/** How far above its old start the hero's foot scrim now begins, so the coordinates line under the
 *  chips sits on shade rather than on bright sandstone. */
const FOOT_SCRIM_LIFT = 40;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Polar.ice },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  selfStart: { alignSelf: 'flex-start' },
  dim: { opacity: 0.72 },

  glass: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: PolarRadius.hairline, backgroundColor: Polar.veil20, borderWidth: 1, borderColor: Polar.frost20 },
  glassText: { fontFamily: PolarFonts.sans, fontSize: 14, color: Polar.ice },
  leave: { minHeight: 36, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  leaveText: { fontFamily: PolarFonts.sans, fontSize: 14, color: Polar.frost68 },
  signal: { minHeight: 36, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, borderRadius: PolarRadius.hairline, backgroundColor: Polar.signal },
  signalPressed: { backgroundColor: Polar.signalPressed },
  signalLg: { minHeight: 46, paddingHorizontal: 22 },
  signalText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },
  ghost: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: 210, paddingVertical: 10, paddingHorizontal: 2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: Polar.frost20 },
  ghostText: { fontFamily: PolarFonts.sans, fontSize: 14, color: Polar.ice },

  hero: { overflow: 'hidden', backgroundColor: Polar.ink, justifyContent: 'space-between' },
  veil: { backgroundColor: Polar.night },
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: PolarSpace.pad },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  peak: { width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  wordmarkText: { fontFamily: PolarFonts.condensed, fontSize: 17, letterSpacing: 1.2, textTransform: 'uppercase' },
  heroMid: { paddingHorizontal: PolarSpace.pad, gap: PolarSpace.s3, marginBottom: PolarSpace.s3 },
  heroLead: { color: Polar.ice, maxWidth: 280, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 12 },
  heroFoot: { gap: PolarSpace.s2 },
  chips: { paddingHorizontal: PolarSpace.pad, gap: 6 },
  chip: { minHeight: 32, paddingHorizontal: 13, justifyContent: 'center', borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.frost20, backgroundColor: 'rgba(9,11,16,0.22)', overflow: 'hidden' },
  chipOn: { backgroundColor: Polar.ice, borderColor: Polar.ice },
  chipText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ice },
  chipFill: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: Polar.signal, transformOrigin: 'left' },
  heroCoord: { color: Polar.ice, paddingHorizontal: PolarSpace.pad },
  monument: { color: Polar.ice, textAlign: 'center', marginTop: PolarSpace.s2 },

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
  fbCarry: { gap: PolarSpace.s2, alignItems: 'flex-start' },
  fbTitle: { fontFamily: PolarFonts.display, fontSize: 54, lineHeight: 56, textTransform: 'uppercase', color: Polar.ice },
  fbSub: { fontFamily: PolarFonts.displayItalic, fontSize: 17, lineHeight: 21, color: Polar.nightText2 },
  card: { gap: PolarSpace.s4, padding: PolarSpace.s4, borderRadius: PolarRadius.card, borderWidth: 1, borderColor: Polar.frost10, overflow: 'hidden' },
  field: { gap: 7 },
  fieldLabel: { fontFamily: PolarFonts.displayItalic, fontSize: 17, lineHeight: 21, letterSpacing: 0, textTransform: 'none', color: Polar.ice },
  input: { minHeight: 46, paddingHorizontal: 13, borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: Polar.frost20, backgroundColor: NIGHT_FIELD, fontFamily: PolarFonts.sans, fontSize: 16, color: Polar.ice },
  inputErr: { borderColor: Polar.alertNight },
  err: { fontFamily: PolarFonts.sansSemi, fontSize: 12, color: Polar.alertNight, marginTop: -2 },
  // The wizard's trough, on night ground: two rows of label and native chip, one hairline between.
  dates: { borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: Polar.frost20, backgroundColor: NIGHT_FIELD, overflow: 'hidden' },
  dateRow: { paddingHorizontal: 13 },
  dateRule: { height: StyleSheet.hairlineWidth, backgroundColor: Polar.frost20, marginLeft: 13 },
  fbFacts: { gap: PolarSpace.s3 },
  fbFact: { gap: 4, paddingLeft: PolarSpace.s2, borderLeftWidth: 1, borderColor: Polar.frost20 },
  fbLinks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: PolarSpace.s4, rowGap: PolarSpace.s2, paddingTop: PolarSpace.s3, borderTopWidth: 1, borderColor: Polar.frost10 },
  fbLink: { fontFamily: PolarFonts.sans, fontSize: 14, lineHeight: 22, color: Polar.ice },
  fbMonument: { color: Polar.ice, opacity: 0.94, textAlign: 'center' },

  statusGround: { position: 'absolute', top: 0, left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Polar.rule },
  barWrap: { position: 'absolute', left: PolarSpace.pad, right: PolarSpace.pad },
  bar: { flexDirection: 'row', gap: 6, padding: 6, borderRadius: PolarRadius.md, borderWidth: 1, borderColor: Polar.frost20, overflow: 'hidden' },
  barQuiet: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.frost20 },
  barQuietText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ice },
  menuHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menuList: { marginTop: PolarSpace.s10 },
  menuRow: { flexDirection: 'row', alignItems: 'baseline', gap: 14, paddingVertical: 14, borderTopWidth: 1, borderColor: Polar.frost10 },
  menuN: { fontFamily: PolarFonts.sansSemi, fontSize: 12, color: Polar.nightText2 },
  menuLabel: { fontFamily: PolarFonts.display, fontSize: 30, lineHeight: 34, textTransform: 'uppercase', color: Polar.ice },
  menuCoord: { color: Polar.nightText2, marginTop: 'auto' },
});
