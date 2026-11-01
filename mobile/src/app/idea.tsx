import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MeriAnswer } from '@shared/meriAnswer';
import type { ReadyTrip } from '@shared/readyTrips';

import { readIdea, type ReadWithAnswer } from '@/api/tripMateApi';
import { isoDaysFromNow } from '@/components/form';
import { RailPostcard } from '@/components/home/postcard';
import { Meridian } from '@/components/meridian';
import { usePolarFonts } from '@/components/polar-ui';
import { Polar, PolarFonts } from '@/constants/polar';
import {
  answerPlanLabel,
  answerToPrefill,
  ideaHeadline,
  ideaPrefill,
  keywordTrips,
  matchTrips,
  NOTHING_CHECKED,
  planPrefillParams,
  prefillQuery,
  readingLine,
} from '@/lib/homeIdeas';
import { useReadyTrips } from '@/lib/useReadyTrips';
import { Text } from '@/components/themed-text';

/** `undefined` while Meri reads; `null` when she could not be asked (no signal). */
type Answer = ReadWithAnswer | { error: string; limited: boolean } | null | undefined;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ENTRY_NOTE = 'Meri doesn’t answer entry questions from memory.';

const isRead = (a: Answer): a is ReadWithAnswer => !!a && !('error' in a);

/**
 * Meri's answer to a sentence typed on Home (spec, "Sending the Meri search").
 *
 * A read becomes a headline and **Build this trip**, which opens the planner filled in; the
 * catalogue trips that fit what was read follow. Anything else — a refusal, a throttle, no signal,
 * or a read that understood nothing — is said beside Meri in words, with **Change something** back
 * to the box (Home keeps the text). Where the reader could not be asked, the catalogue is still
 * searched for the words typed, since that needs no server.
 *
 * A question about a place ("when's the best time to go to Lisbon?") comes back with an `answer`,
 * drawn in the reading's place: the evidence's places, months and sources, and a button that carries
 * the answer into the planner. Home sends `offline=1` when it already knows the last request never reached the server, and then
 * nothing is asked at all.
 */
export default function IdeaSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const fonts = usePolarFonts();
  const { text = '', offline } = useLocalSearchParams<{ text?: string; offline?: string }>();
  const skip = offline === '1';
  const [answer, setAnswer] = useState<Answer>(skip ? null : undefined);
  // Seconds Meri has been working, so the line beside her moves on (`readingLine`).
  const [waited, setWaited] = useState(0);
  const trips = useReadyTrips() ?? [];

  useEffect(() => {
    if (skip) return;
    let alive = true;
    readIdea(text).then((r) => alive && setAnswer(r ?? null));
    return () => {
      alive = false;
    };
  }, [text, skip]);

  const waiting = answer === undefined;
  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setWaited((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [waiting]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const open = (slug: string) => router.replace(`/ready/${slug}`);
  const meri = isRead(answer) ? answer.answer : undefined;
  // One day for the label and the prefill, so the button never names a month the planner will not open on.
  const today = isoDaysFromNow(0);
  const understood = isRead(answer) && (answer.destination !== null || answer.kind !== null || answer.days !== null);

  // What is said beside Meri, and which trips follow, for every answer but a read that understood.
  let said: string | null = null;
  let matches: ReadyTrip[] = [];
  let none: string | null = null;
  if (answer === undefined) said = readingLine(waited);
  else if (answer === null) {
    said = 'Meri can read your idea when you’re back online.';
    matches = keywordTrips(trips, text);
    none = 'Nothing in the ready-made trips matches yet.';
  } else if ('error' in answer) {
    said = answer.error;
    // A throttle or the daily cap is a wait, not a no: the words alone can still find a trip.
    if (answer.limited) matches = keywordTrips(trips, text);
  } else if (!understood && !meri) {
    said = 'Meri couldn’t tell where or how long. Say a place, or how many days.';
    matches = keywordTrips(trips, text);
  } else {
    // An answer takes the reading's place, so the catalogue's close-to trips have nowhere to show.
    matches = meri ? [] : matchTrips(trips, answer);
    // A named place no ready-made trip covers: say so, or the sheet below the actions reads as broken.
    const place = answer.destination?.split(',')[0].trim();
    if (!meri && !matches.length && place && trips.length) none = `No ready-made trip goes to ${place} yet. Build this trip and TripMate writes one for you.`;
  }

  return (
    <ScrollView style={styles.sheet} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.meri}>
        <Meridian state={answer === undefined ? 'thinking' : answer === null ? 'offline' : 'idle'} size={32} />
        {said ? (
          <Text maxFontSizeMultiplier={1.6} style={styles.said} accessibilityLiveRegion="polite">
            {said}
          </Text>
        ) : (
          <Text maxFontSizeMultiplier={1.6} style={styles.name}>Meri</Text>
        )}
      </View>

      {understood && !meri ? (
        <Text maxFontSizeMultiplier={1.3} style={[styles.headline, fonts && styles.headlineFont]} accessibilityRole="header" accessibilityLiveRegion="polite">
          {ideaHeadline(answer)}
        </Text>
      ) : null}
      {text ? (
        <Text maxFontSizeMultiplier={1.6} style={styles.quote} accessibilityLabel={`You wrote: ${text}`}>
          {`“${text}”`}
        </Text>
      ) : null}

      {isRead(answer) && meri ? <AnswerCard answer={meri} read={answer} today={today} /> : null}
      {waiting ? <Waiting /> : null}

      {waiting ? (
        // A way out from the first second: a wait with no control reads as a screen that froze.
        <View style={styles.actions}>
          <Pressable onPress={back} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}>
            <Text maxFontSizeMultiplier={1.6} style={styles.secondaryText}>Change something</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.actions}>
          {isRead(answer) && meri ? (
            showPlan(answer, meri) ? (
              <Pressable
                onPress={() => router.replace(`/plan/basics?${prefillQuery(planPrefillParams(answerToPrefill(answer, meri, today)))}`)}
                accessibilityRole="button"
                accessibilityLabel={answerPlanLabel(answer, meri, today)}
                style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}>
                <Text maxFontSizeMultiplier={1.6} style={styles.primaryText}>{answerPlanLabel(answer, meri, today)}</Text>
              </Pressable>
            ) : null
          ) : understood ? (
            <Pressable
              onPress={() => router.replace(`/plan/basics?${prefillQuery(ideaPrefill(answer, today))}`)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}>
              <Text maxFontSizeMultiplier={1.6} style={styles.primaryText}>Build this trip</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={back} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}>
            <Text maxFontSizeMultiplier={1.6} style={styles.secondaryText}>Change something</Text>
          </Pressable>
        </View>
      )}

      {matches.length ? (
        <View style={styles.more}>
          <Text maxFontSizeMultiplier={1.6} style={styles.moreTitle} accessibilityRole="header">
            Or start from a ready-made trip
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rail} contentContainerStyle={styles.railContent}>
            {matches.map((trip) => (
              <RailPostcard key={trip.slug} trip={trip} onPress={() => open(trip.slug)} />
            ))}
          </ScrollView>
        </View>
      ) : none ? (
        <Text maxFontSizeMultiplier={1.6} style={styles.none}>{none}</Text>
      ) : null}
    </ScrollView>
  );
}

/** The button shows for a named place, or for a checked answer that is not about entry. */
const showPlan = (read: ReadWithAnswer, a: MeriAnswer) =>
  Boolean(read.destination ?? read.question?.place) || (!a.nothingChecked && read.question?.kind !== 'entry');

/**
 * Meri's answer: the places, months and sources are the evidence records the server rendered,
 * never the answer's prose. Nothing checked says so and shows nothing else.
 */
/**
 * The answer card's outline while Meri works: three soft bars breathing in the card's place, so the
 * sheet shows something is coming and where. Held still under Reduce Motion; the line beside Meri
 * still moves on, which is what VoiceOver hears.
 */
function Waiting() {
  const reduce = useReducedMotion();
  const glow = useSharedValue(0.45);
  useEffect(() => {
    if (!reduce) glow.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [reduce, glow]);
  const breathe = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <Animated.View style={[styles.card, breathe]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[92, 100, 64].map((w) => (
        <View key={w} style={[styles.waitBar, { width: `${w}%` }]} />
      ))}
    </Animated.View>
  );
}

function AnswerCard({ answer, read, today }: { answer: MeriAnswer; read: ReadWithAnswer; today: string }) {
  const kind = read.question?.kind;
  const checked = !answer.nothingChecked;
  const good = [...answer.months].sort((a, b) => a - b);
  // The planner's real start month, which is not always the first the answer named.
  const goes = kind === 'best_time' && good.length ? Number(answerToPrefill(read, answer, today).startDate?.slice(5, 7)) : null;
  return (
    <View style={styles.card}>
      <Text maxFontSizeMultiplier={1.6} style={styles.answerText} accessibilityLiveRegion="polite">
        {answer.answer || NOTHING_CHECKED}
      </Text>

      {checked && good.length ? (
        <View accessible accessibilityLabel={`Good months: ${good.map((m) => MONTH_NAMES[m - 1]).join(', ')}.${goes ? ` ${MONTH_NAMES[goes - 1]} goes into the plan.` : ''}`}>
          <View style={styles.monthRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {MONTH_NAMES.map((name, i) => (
              <View key={name} style={[styles.month, good.includes(i + 1) && styles.monthOn, goes === i + 1 && styles.monthBest]}>
                <Text maxFontSizeMultiplier={1.2} style={[styles.monthText, good.includes(i + 1) && styles.monthTextOn]}>{name[0]}</Text>
              </View>
            ))}
          </View>
          {goes ? (
            <Text maxFontSizeMultiplier={1.6} style={styles.monthKey} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {`${MONTH_NAMES[goes - 1]} goes into the plan`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {checked && answer.places.length ? (
        <View style={styles.places}>
          {answer.places.map((p, i) => (
            <View key={p.id} style={styles.place}>
              <Text maxFontSizeMultiplier={1.6} style={styles.placeIdx}>{String(i + 1).padStart(2, '0')}</Text>
              <View style={styles.placeBody}>
                <Text maxFontSizeMultiplier={1.6} style={styles.placeName}>{p.name}</Text>
                {p.detail ? <Text maxFontSizeMultiplier={1.6} style={styles.placeDetail}>{p.detail}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {kind === 'entry' && checked ? (
        <Text maxFontSizeMultiplier={1.6} style={styles.note}>{ENTRY_NOTE}</Text>
      ) : null}

      {checked && answer.sources.length ? (
        <Text maxFontSizeMultiplier={1.6} style={styles.from}>
          <Text style={styles.fromKicker}>From </Text>
          {answer.sources.map((s) => s.label).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

const GROUND = '#F2F2F7';

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#fff' },
  content: { paddingTop: 28, paddingHorizontal: 20 },
  meri: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.secondary },
  said: { flex: 1, fontFamily: PolarFonts.sans, fontSize: 16, lineHeight: 22, color: Polar.ink },
  headline: { marginTop: 12, fontSize: 30, lineHeight: 34, color: Polar.ink },
  headlineFont: { fontFamily: PolarFonts.display, fontSize: 32, lineHeight: 35 },
  quote: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: GROUND, fontFamily: PolarFonts.sansRegular, fontSize: 14, lineHeight: 19, color: Polar.secondary },
  card: { marginTop: 12, padding: 16, borderRadius: 16, backgroundColor: GROUND, gap: 14 },
  waitBar: { height: 12, borderRadius: 6, backgroundColor: Polar.rule },
  answerText: { fontFamily: PolarFonts.sans, fontSize: 16, lineHeight: 22, color: Polar.ink },
  monthRow: { flexDirection: 'row', gap: 4 },
  month: { flex: 1, paddingVertical: 6, minHeight: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  monthOn: { backgroundColor: Polar.signal },
  monthBest: { borderWidth: 2, borderColor: Polar.ink },
  monthText: { fontFamily: PolarFonts.sansRegular, fontSize: 12, color: Polar.secondary },
  monthTextOn: { fontFamily: PolarFonts.sansSemi, color: Polar.ink },
  monthKey: { marginTop: 6, fontFamily: PolarFonts.sansRegular, fontSize: 12, color: Polar.secondary },
  places: { gap: 10 },
  place: { flexDirection: 'row', gap: 10 },
  placeIdx: { width: 22, fontFamily: PolarFonts.sansSemi, fontSize: 13, lineHeight: 20, color: Polar.secondary },
  placeBody: { flex: 1 },
  placeName: { fontFamily: PolarFonts.sansSemi, fontSize: 15, lineHeight: 20, color: Polar.ink },
  placeDetail: { fontFamily: PolarFonts.sansRegular, fontSize: 13, lineHeight: 18, color: Polar.secondary },
  note: { fontFamily: PolarFonts.sansRegular, fontSize: 13, lineHeight: 18, color: Polar.secondary },
  from: { fontFamily: PolarFonts.sansRegular, fontSize: 13, lineHeight: 18, color: Polar.secondary },
  fromKicker: { fontFamily: PolarFonts.sansSemi, color: Polar.ink },
  actions: { marginTop: 20, gap: 8 },
  primary: { minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.signal },
  primaryPressed: { backgroundColor: Polar.signalPressed },
  primaryText: { fontFamily: PolarFonts.sansSemi, fontSize: 16, color: Polar.ink },
  secondary: { minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Polar.rule, backgroundColor: '#fff' },
  secondaryPressed: { backgroundColor: GROUND },
  secondaryText: { fontFamily: PolarFonts.sansSemi, fontSize: 16, color: Polar.ink },
  more: { marginTop: 28 },
  moreTitle: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ink },
  // Out to the sheet's edges, so the cards scroll under the gutter rather than stopping at it.
  rail: { marginTop: 12, marginHorizontal: -20 },
  railContent: { gap: 12, paddingHorizontal: 20 },
  none: { marginTop: 24, fontFamily: PolarFonts.sansRegular, fontSize: 14, lineHeight: 20, color: Polar.secondary },
});
