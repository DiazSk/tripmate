import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Polar, PolarFonts, PolarRadius, PolarSpace, PolarType, PolarMotion } from '@/constants/polar';
import { BEATS, DESTS, PHASES, PLANS, STEPS, TIERS } from './content';
import { DayOnMap } from './day-on-map';
import { Scrim } from './scrim';

/**
 * The Polar Interior landing, for the phone — the "TripMate — Polar Landing (Mobile)" frame on the
 * MagicPath board, ported to the app. A design study, reachable at `tripmate://polar-landing`;
 * nothing links to it, and its "Plan my trip" ends in a mock draft rather than the real flow.
 */
type Section = 'plans' | 'knows' | 'day' | 'plan';

export function PolarLandingScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<Section, number>>>({});
  const [showBar, setShowBar] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [menu, setMenu] = useState(false);
  const [how, setHow] = useState(false);
  const [where, setWhere] = useState('');

  // Written from the layout event itself, never from render — the compiler lint's ref rule.
  const record = (s: Section, e: LayoutChangeEvent) => {
    offsets.current[s] = e.nativeEvent.layout.y;
  };
  const go = useCallback(
    (s: Section) => {
      setMenu(false);
      scroll.current?.scrollTo({ y: Math.max(0, (offsets.current[s] ?? 0) - insets.top), animated: true });
    },
    [insets.top],
  );

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
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowBar(y > height * 0.85 && y < (offsets.current.plan ?? Infinity) - height * 0.6);
    // Past the photograph the page is white, and white clock-and-battery on white disappears —
    // so the bar goes dark and gets a frosted ground to sit on instead of the page's text.
    setPastHero(y > Math.max(height, 640) - insets.top);
  };

  return (
    <View style={styles.screen}>
      <ScrollView ref={scroll} style={styles.flex} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="never" automaticallyAdjustKeyboardInsets>
        <Hero height={height} width={width} onMenu={() => setMenu(true)} onPlan={() => go('plan')} onWatch={() => go('day')} />
        <Intro />
        <View onLayout={(e) => record('plans', e)}>
          <Plans
            width={width}
            onPlan={(w) => {
              setWhere(w);
              go('plan');
            }}
          />
        </View>
        <Quote />
        <View onLayout={(e) => record('knows', e)}>
          <Knows width={width} />
        </View>
        <View onLayout={(e) => record('day', e)}>
          <DayOnMap width={width} />
        </View>
        <View onLayout={(e) => record('plan', e)}>
          <PlanForm where={where} setWhere={setWhere} />
        </View>
        <Footer bottom={insets.bottom} />
      </ScrollView>

      {pastHero && <BlurView intensity={70} tint="light" style={[styles.statusGround, { height: insets.top }]} pointerEvents="none" />}

      {showBar && (
        <View style={[styles.barWrap, { bottom: insets.bottom + 6 }]} pointerEvents="box-none">
          <BlurView intensity={60} tint="dark" style={styles.bar}>
            <Pressable onPress={() => setHow(true)} style={({ pressed }) => [styles.barQuiet, pressed && styles.dim]} accessibilityRole="button">
              <Text style={styles.barQuietText}>How it works</Text>
            </Pressable>
            <Pressable onPress={() => go('plan')} style={({ pressed }) => [styles.signal, styles.flex, pressed && styles.signalPressed]} accessibilityRole="button">
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
                ['knows', 'What a plan knows'],
                ['day', 'A day on the map'],
                ['plan', 'Plan a trip'],
              ] as [Section, string][]
            ).map(([k, label], i) => (
              <Pressable key={k} onPress={() => go(k)} style={({ pressed }) => [styles.menuRow, pressed && styles.dim]} accessibilityRole="link">
                <Text style={styles.menuN}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={styles.menuLabel}>{label}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => {
                setMenu(false);
                setHow(true);
              }}
              style={({ pressed }) => [styles.menuRow, pressed && styles.dim]}
              accessibilityRole="button"
            >
              <Text style={styles.menuN}>05</Text>
              <Text style={styles.menuLabel}>How it works</Text>
            </Pressable>
          </View>
          <Text style={[PolarType.coord, styles.menuCoord, { marginBottom: insets.bottom + PolarSpace.s4 }]}>[ 42º 20’ 23” N, 71º 05’ 22” W ]</Text>
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
          <Pressable
            onPress={() => {
              setHow(false);
              go('plan');
            }}
            style={({ pressed }) => [styles.signal, styles.signalLg, pressed && styles.signalPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.signalText}>Plan a trip</Text>
          </Pressable>
        </Animated.View>
      </Modal>
    </View>
  );
}

/* ───────────────────────── Hero ───────────────────────── */

function Hero({ height, width, onMenu, onPlan, onWatch }: { height: number; width: number; onMenu: () => void; onPlan: () => void; onWatch: () => void }) {
  const insets = useSafeAreaInsets();
  const [destId, setDestId] = useState('petra');
  const dest = DESTS.find((d) => d.id === destId)!;
  const size = Math.min(width * 0.27, 150);

  return (
    <View style={[styles.hero, { height: Math.max(height, 640) }]}>
      <Image source={dest.img} style={StyleSheet.absoluteFill} contentFit="cover" transition={700} />
      <Scrim stops={[[0, Polar.night, 0.55], [0.22, Polar.night, 0], [0.42, Polar.night, 0], [1, Polar.night, 0.82]]} />

      <View style={[styles.nav, { paddingTop: insets.top + PolarSpace.s2 }]}>
        <Wordmark light />
        <View style={styles.row}>
          <Pressable onPress={onMenu} style={({ pressed }) => [styles.glass, pressed && styles.dim]} accessibilityRole="button" accessibilityLabel="Open menu">
            <Text style={styles.glassText}>Menu</Text>
          </Pressable>
          <Pressable onPress={onPlan} style={({ pressed }) => [styles.signal, pressed && styles.signalPressed]} accessibilityRole="button">
            <Text style={styles.signalText}>Plan a trip</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.heroFoot}>
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
        <Text style={[PolarType.monument, styles.monument, { fontSize: size, lineHeight: size * 1.02 }]} accessibilityRole="header" numberOfLines={1}>
          {dest.word}
        </Text>
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
      <Text style={styles.statement}>Forecast, holidays, opening hours and travel times go in first — before a single word of your plan is written.</Text>
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
      <Text style={styles.quoteText}>The budget is a target to hit, not a ceiling to stay under. Say what you want to spend and get a plan that actually spends it.</Text>
      <Text style={styles.quoteDash}>-</Text>
      <Text style={[PolarType.ui, { color: Polar.ink }]}>How TripMate plans</Text>
      <Text style={[PolarType.caption, { color: Polar.charcoal }]}>Step 01 · You set the constraints</Text>
    </View>
  );
}

/* ───────────────────────── Sample plans ───────────────────────── */

function Plans({ width, onPlan }: { width: number; onPlan: (where: string) => void }) {
  const cardW = width - PolarSpace.pad * 2 - 26;
  const step = cardW + PolarSpace.gutter;
  const [page, setPage] = useState(0);
  const ref = useRef<ScrollView>(null);
  return (
    <View style={styles.plans}>
      <View style={styles.sectionHead}>
        <Text style={[PolarType.display, styles.center, { color: Polar.ink }]} accessibilityRole="header">
          Sample plans
        </Text>
      </View>
      <ScrollView
        ref={ref}
        horizontal
        snapToInterval={step}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: PolarSpace.pad, gap: PolarSpace.gutter }}
        onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / step))}
        scrollEventThrottle={16}
      >
        {PLANS.map((p) => (
          <View key={p.title} style={[styles.planCard, { width: cardW, height: cardW * 1.38 }]}>
            <Image source={p.img} style={StyleSheet.absoluteFill} contentFit="cover" />
            <Scrim stops={[[0, Polar.night, 0.45], [0.3, Polar.night, 0], [0.45, Polar.night, 0], [1, Polar.night, 0.85]]} />
            <Text style={styles.planTitle}>{p.title}</Text>
            <View style={styles.planFoot}>
              <View style={styles.row}>
                <Text style={styles.planMeta}>US ${p.price.toLocaleString('en-US')}</Text>
                <View style={styles.pipe} />
                <Text style={styles.planMeta}>{p.season}</Text>
              </View>
              <View style={styles.facts}>
                {(
                  [
                    ['Where', p.where],
                    ['When', p.when],
                    ['Length', p.length],
                    ['Party', p.party],
                  ] as const
                ).map(([k, v]) => (
                  <View key={k} style={styles.fact}>
                    <Text style={styles.factK}>{k}</Text>
                    <Text style={styles.factV}>{v}</Text>
                  </View>
                ))}
              </View>
              <Pressable onPress={() => onPlan(p.where)} style={({ pressed }) => [styles.signal, styles.selfStart, pressed && styles.signalPressed]} accessibilityRole="button">
                <Text style={styles.signalText}>Plan one like it</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots} accessibilityRole="adjustable" accessibilityLabel={`Plan ${page + 1} of ${PLANS.length}`}>
        {PLANS.map((p, i) => (
          <Pressable key={p.title} onPress={() => ref.current?.scrollTo({ x: i * step, animated: true })} style={[styles.dot, i === page && styles.dotOn]} hitSlop={8} accessibilityLabel={`Go to ${p.title}`} />
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
        <View key={b.label} style={[styles.beat, { height: w * 1.05 }]}>
          <Image source={b.img} style={StyleSheet.absoluteFill} contentFit="cover" />
          <BlurView intensity={40} tint="dark" style={styles.beatCard}>
            <Text style={styles.beatLabel}>{b.label}</Text>
            <Text style={styles.beatStat}>{b.stat}</Text>
            <Text style={styles.beatProse}>{b.prose}</Text>
          </BlurView>
        </View>
      ))}
    </View>
  );
}

/* ───────────────────────── Plan form ───────────────────────── */

function nextMonths(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) };
  });
}

function PlanForm({ where, setWhere }: { where: string; setWhere: (s: string) => void }) {
  const months = useMemo(() => nextMonths(6), []);
  const [month, setMonth] = useState<string | null>(null);
  const [nights, setNights] = useState(6);
  const [tier, setTier] = useState<(typeof TIERS)[number]>('Mid-range');
  const [party, setParty] = useState(2);
  const [errors, setErrors] = useState<{ where?: string; month?: string }>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (status !== 'loading') return;
    const t = setInterval(() => {
      setPhase((p) => {
        if (p >= PHASES.length - 1) {
          clearInterval(t);
          setStatus('done');
          return p;
        }
        return p + 1;
      });
    }, PolarMotion.phase);
    return () => clearInterval(t);
  }, [status]);

  function submit() {
    const e: typeof errors = {};
    if (!where.trim()) e.where = 'Tell us where you’re going.';
    if (!month) e.month = 'Pick the month you’ll travel.';
    setErrors(e);
    if (!e.where && !e.month) {
      setPhase(0);
      setStatus('loading');
    }
  }

  const busy = status === 'loading';
  const monthLabel = months.find((m) => m.key === month)?.label ?? '';

  return (
    <View style={styles.cta}>
      <View style={styles.sectionHead}>
        <Text style={[PolarType.kicker, styles.center, { color: Polar.ink }]}>Start here</Text>
        <Text style={[PolarType.display, styles.center, { color: Polar.ink }]} accessibilityRole="header">
          Start planning your trip
        </Text>
      </View>

      {status === 'done' ? (
        <View style={styles.card} accessibilityLiveRegion="polite">
          <Text style={[PolarType.eyebrow, { color: Polar.ember }]}>Draft ready</Text>
          <Text style={styles.resultTitle}>
            {nights + 1} days in {where}
          </Text>
          <View style={styles.resultFacts}>
            {(
              [
                ['From', monthLabel],
                ['Tier', tier],
                ['Party', `${party} ${party === 1 ? 'traveller' : 'travellers'}`],
              ] as const
            ).map(([k, v]) => (
              <View key={k} style={styles.flex}>
                <Text style={styles.fieldLabel}>{k}</Text>
                <Text style={[PolarType.bodyS, { color: Polar.ink }]}>{v}</Text>
              </View>
            ))}
          </View>
          <Text style={[PolarType.bodyS, { color: Polar.charcoal }]}>A design study — in the app the plan opens on the map with every day priced and timed.</Text>
          <View style={styles.row}>
            <Pressable style={({ pressed }) => [styles.signal, pressed && styles.signalPressed]} accessibilityRole="button">
              <Text style={styles.signalText}>Open the plan</Text>
            </Pressable>
            <Pressable onPress={() => setStatus('idle')} style={({ pressed }) => [styles.quiet, pressed && styles.dim]} accessibilityRole="button">
              <Text style={styles.quietText}>Change details</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.card} accessibilityState={{ busy }}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Where</Text>
            <TextInput
              value={where}
              onChangeText={setWhere}
              placeholder="A city, region or country"
              placeholderTextColor={Polar.charcoal}
              editable={!busy}
              autoCapitalize="words"
              returnKeyType="done"
              maxLength={80}
              style={[styles.input, !!errors.where && styles.inputErr]}
              accessibilityLabel="Where"
            />
            {errors.where && <Text style={styles.err}>{errors.where}</Text>}
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>When</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="Month">
              {months.map((m) => {
                const on = m.key === month;
                return (
                  <Pressable key={m.key} onPress={() => setMonth(m.key)} disabled={busy} style={[styles.monthChip, on && styles.monthChipOn, !!errors.month && !month && styles.inputErr]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <Text style={[styles.monthText, on && { color: Polar.ice }]}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {errors.month && <Text style={styles.err}>{errors.month}</Text>}
          </View>

          <View style={styles.row2}>
            <Stepper label="Nights" value={nights} min={1} max={30} onChange={setNights} disabled={busy} />
            <Stepper label="Travellers" value={party} min={1} max={12} onChange={setParty} disabled={busy} />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Way to travel</Text>
            <View style={styles.seg} accessibilityRole="radiogroup">
              {TIERS.map((t) => {
                const on = tier === t;
                return (
                  <Pressable key={t} onPress={() => setTier(t)} disabled={busy} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <Text style={[styles.segText, on && { color: Polar.ice }]}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.formFoot}>
            {busy ? (
              <View style={styles.progressWrap} accessibilityLiveRegion="polite">
                <View style={styles.progressTrack}>
                  <View style={[styles.progressBar, { width: `${((phase + 1) / PHASES.length) * 100}%` }]} />
                </View>
                <Text style={[PolarType.caption, { color: Polar.charcoal }]}>{PHASES[phase]}…</Text>
              </View>
            ) : (
              <Text style={[PolarType.caption, { color: Polar.charcoal }]}>No account needed to try it. Plans are drafts until you keep them.</Text>
            )}
            <Pressable onPress={submit} disabled={busy} style={({ pressed }) => [styles.signal, styles.signalLg, busy && styles.off, pressed && styles.signalPressed]} accessibilityRole="button">
              <Text style={styles.signalText}>{busy ? 'Planning…' : 'Plan my trip'}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function Stepper({ label, value, min, max, onChange, disabled }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <View style={[styles.field, styles.flex]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.stepper} accessibilityRole="adjustable" accessibilityLabel={`${label}: ${value}`}>
        <Pressable onPress={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} style={({ pressed }) => [styles.stepBtn, pressed && styles.stepPressed]} accessibilityLabel={`Fewer ${label.toLowerCase()}`}>
          <Text style={[styles.stepSign, (disabled || value <= min) && { color: Polar.stone }]}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable onPress={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} style={({ pressed }) => [styles.stepBtn, pressed && styles.stepPressed]} accessibilityLabel={`More ${label.toLowerCase()}`}>
          <Text style={[styles.stepSign, (disabled || value >= max) && { color: Polar.stone }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Footer({ bottom }: { bottom: number }) {
  return (
    <View style={[styles.footer, { paddingBottom: bottom + PolarSpace.s4 }]}>
      <Wordmark />
      <Text style={[PolarType.coord, { color: Polar.ink }]}>[ 42º 20’ 23” N, 71º 05’ 22” W ]</Text>
      <Text style={[PolarType.caption, { color: Polar.charcoal }]}>Design study · Polar Interior tokens · photography via Pexels</Text>
    </View>
  );
}

/* ───────────────────────── Styles ───────────────────────── */

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

  cta: { paddingTop: PolarSpace.s10, paddingBottom: PolarSpace.s8, paddingHorizontal: PolarSpace.pad },
  card: { gap: PolarSpace.s4, padding: PolarSpace.s4, backgroundColor: Polar.ice, borderRadius: PolarRadius.card, borderWidth: 1, borderColor: Polar.rule, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  field: { gap: 7 },
  fieldLabel: { fontFamily: PolarFonts.displayItalic, fontSize: 17, color: Polar.ink },
  input: { height: 46, paddingHorizontal: 13, borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: Polar.rule, backgroundColor: Polar.snow, fontFamily: PolarFonts.sans, fontSize: 16, color: Polar.ink },
  inputErr: { borderColor: Polar.alertText },
  err: { fontFamily: PolarFonts.sansSemi, fontSize: 12, color: Polar.alertText },
  monthChip: { height: 40, paddingHorizontal: 13, justifyContent: 'center', borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: Polar.rule, backgroundColor: Polar.snow },
  monthChipOn: { backgroundColor: Polar.ink, borderColor: Polar.ink },
  monthText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: Polar.rule, backgroundColor: Polar.snow, overflow: 'hidden' },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepPressed: { backgroundColor: Polar.veil05 },
  stepSign: { fontFamily: PolarFonts.sans, fontSize: 19, color: Polar.ink },
  stepValue: { flex: 1, textAlign: 'center', fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ink },
  seg: { flexDirection: 'row', padding: 3, gap: 3, height: 46, borderRadius: PolarRadius.sm, borderWidth: 1, borderColor: Polar.rule, backgroundColor: Polar.snow },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: PolarRadius.hairline },
  segOn: { backgroundColor: Polar.ink },
  segText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.charcoal },
  formFoot: { gap: PolarSpace.s3, paddingTop: PolarSpace.s3, borderTopWidth: 1, borderColor: Polar.rule },
  progressWrap: { gap: 7 },
  progressTrack: { height: 2, backgroundColor: Polar.rule },
  progressBar: { height: 2, backgroundColor: Polar.signal },
  resultTitle: { fontFamily: PolarFonts.displayItalic, fontSize: 32, lineHeight: 34, color: Polar.ink },
  resultFacts: { flexDirection: 'row', gap: PolarSpace.s3, paddingVertical: PolarSpace.s3, borderTopWidth: 1, borderBottomWidth: 1, borderColor: Polar.rule },

  footer: { gap: PolarSpace.s2, paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s5, borderTopWidth: 1, borderColor: Polar.rule },

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
  menuCoord: { color: Polar.nightText2, marginTop: 'auto' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(31,42,68,0.5)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%', backgroundColor: Polar.ice, borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingHorizontal: PolarSpace.pad, gap: PolarSpace.s3 },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: Polar.beige, marginTop: 8 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetScroll: { flexGrow: 0 },
  step: { gap: 5, paddingVertical: PolarSpace.s3, borderTopWidth: 1, borderColor: Polar.rule },
  stepN: { fontFamily: PolarFonts.sansSemi, fontSize: 12, color: Polar.charcoal },
  stepTitle: { fontFamily: PolarFonts.displayItalic, fontSize: 24, lineHeight: 27, color: Polar.ink },
});
