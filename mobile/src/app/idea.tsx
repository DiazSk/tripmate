import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IdeaRead } from '@shared/ideaRead';
import type { ReadyTrip } from '@shared/readyTrips';

import { readIdea } from '@/api/tripMateApi';
import { isoDaysFromNow } from '@/components/form';
import { RailPostcard } from '@/components/home/postcard';
import { Meridian } from '@/components/meridian';
import { usePolarFonts } from '@/components/polar-ui';
import { Polar, PolarFonts } from '@/constants/polar';
import { ideaHeadline, ideaPrefill, keywordTrips, matchTrips, prefillQuery } from '@/lib/homeIdeas';
import { useReadyTrips } from '@/lib/useReadyTrips';

/** `undefined` while Meri reads; `null` when she could not be asked (no signal). */
type Answer = IdeaRead | { error: string; limited: boolean } | null | undefined;

const isRead = (a: Answer): a is IdeaRead => !!a && !('error' in a);

/**
 * Meri's answer to a sentence typed on Home (spec, "Sending the Meri search").
 *
 * A read becomes a headline and **Build this trip**, which opens the planner filled in; the
 * catalogue trips that fit what was read follow. Anything else — a refusal, a throttle, no signal,
 * or a read that understood nothing — is said beside Meri in words, with **Change something** back
 * to the box (Home keeps the text). Where the reader could not be asked, the catalogue is still
 * searched for the words typed, since that needs no server.
 *
 * Home sends `offline=1` when it already knows the last request never reached the server, and then
 * nothing is asked at all.
 */
export default function IdeaSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const fonts = usePolarFonts();
  const { text = '', offline } = useLocalSearchParams<{ text?: string; offline?: string }>();
  const skip = offline === '1';
  const [answer, setAnswer] = useState<Answer>(skip ? null : undefined);
  const trips = useReadyTrips() ?? [];

  useEffect(() => {
    if (skip) return;
    let alive = true;
    readIdea(text).then((r) => alive && setAnswer(r ?? null));
    return () => {
      alive = false;
    };
  }, [text, skip]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const open = (slug: string) => router.replace(`/ready/${slug}`);
  const understood = isRead(answer) && (answer.destination !== null || answer.kind !== null || answer.days !== null);

  // What is said beside Meri, and which trips follow, for every answer but a read that understood.
  let said: string | null = null;
  let matches: ReadyTrip[] = [];
  let none: string | null = null;
  if (answer === undefined) said = 'Meri is reading your idea';
  else if (answer === null) {
    said = 'Meri can read your idea when you’re back online.';
    matches = keywordTrips(trips, text);
    none = 'Nothing in the ready-made trips matches yet.';
  } else if ('error' in answer) {
    said = answer.error;
    // A throttle or the daily cap is a wait, not a no: the words alone can still find a trip.
    if (answer.limited) matches = keywordTrips(trips, text);
  } else if (!understood) {
    said = 'Meri couldn’t tell where or how long. Say a place, or how many days.';
    matches = keywordTrips(trips, text);
  } else {
    matches = matchTrips(trips, answer);
  }

  return (
    <ScrollView style={styles.sheet} contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]} showsVerticalScrollIndicator={false}>
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

      {understood ? (
        <Text maxFontSizeMultiplier={1.3} style={[styles.headline, fonts && styles.headlineFont]} accessibilityRole="header" accessibilityLiveRegion="polite">
          {ideaHeadline(answer)}
        </Text>
      ) : null}
      {text ? (
        <Text maxFontSizeMultiplier={1.6} style={styles.quote} accessibilityLabel={`You wrote: ${text}`}>
          {`“${text}”`}
        </Text>
      ) : null}

      {answer === undefined ? null : (
        <View style={styles.actions}>
          {understood ? (
            <Pressable
              onPress={() => router.replace(`/plan/basics?${prefillQuery(ideaPrefill(answer, isoDaysFromNow(0)))}`)}
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
