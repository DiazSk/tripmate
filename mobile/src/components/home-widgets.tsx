import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { SymbolView, type SymbolViewProps } from '@/components/symbol';
import type { SavedPlace, Stop, Trip } from '@/api/types';
import { Polar, PolarFonts } from '@/constants/polar';
import { clockAt, formatRange } from '@/lib/dayDisplay';
import { directionsUrl } from '@/lib/directions';
import { isBlocking, tripHealth } from '@/lib/health';
import { useHere } from '@/lib/here';
import { describeDistance, savedNearby, savedNotInPlan } from '@/lib/savedPlaces';
import { formatMoney } from '@/lib/spend';
import { tripDays } from '@/lib/tiers';
import { glanceFor, type NextGlance } from '@/lib/todayGlance';
import { clockInZone, nowInZone } from '@/lib/tripClock';
import { dayIndexFor, tripPhase } from '@/lib/tripPhase';

/**
 * Home as a page of widgets, in the system's three sizes (canvas design "Phone home · 4 Widgets
 * with a live next stop"): small is half the width, medium the full width, large two rows tall.
 * Each one is a glanceable answer and one tap target that opens the place it is about.
 *
 * `TripWidgets` is the page on a trip, and replaces what `Today` drew: the next stop as a Live
 * Activity (when to leave, a countdown, Directions, Plans changed), then where you are, the
 * weather, a saved place near you, the rest of the day and what needs attention. Every figure is
 * `glanceFor`'s, which is `todayState` underneath, so it agrees with the trip screen by
 * construction.
 */

export const WidgetColors = {
  grey: Polar.secondary,
  card: '#FFFFFF',
  live: '#1C1C1E',
  warn: '#FFF4E0',
  warnInk: '#6B3200',
} as const;

const GAP = 14;
const PAD = 16;
const ROW = 168;

type Size = 'small' | 'medium' | 'large';
type Tone = 'light' | 'signal' | 'paper' | 'warn';
type SymbolName = SymbolViewProps['name'];

/** The width a widget of this size takes in a two-column grid on this screen. */
export function useWidgetWidth(size: Size): number {
  const { width } = useWindowDimensions();
  const full = width - PAD * 2;
  return size === 'small' ? (full - GAP) / 2 : full;
}

export function WidgetGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

export function Widget({
  size,
  tone = 'light',
  photo,
  label,
  onPress,
  accessibilityLabel,
  fit = false,
  children,
}: {
  size: Size;
  tone?: Tone;
  /** A photograph for the ground; the words then sit on a scrim in white. */
  photo?: string | null;
  label: string;
  /** Absent for a widget that only reports, which is then not a button. */
  onPress?: () => void;
  accessibilityLabel?: string;
  /** As tall as its words: for a widget that stands alone on its line, where a row's fixed height
   *  only pushed the label and the content apart. */
  fit?: boolean;
  children: ReactNode;
}) {
  const width = useWidgetWidth(size);
  const fixed = size === 'large' ? ROW * 2 + GAP : ROW;
  // A floor, not a fixed height: at the larger text sizes the words grow the widget rather than
  // spilling out of it over the photograph (the grid's rows stretch the pair beside it to match).
  const height = fit ? null : { minHeight: fixed };
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'summary'}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.widget, toneStyle[tone], { width }, height, pressed && styles.pressed]}>
      {photo ? (
        <>
          <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} accessibilityIgnoresInvertColors />
          <View style={[StyleSheet.absoluteFill, styles.scrim]} />
        </>
      ) : null}
      <Text maxFontSizeMultiplier={1.6} style={[styles.label, photo ? styles.labelOnPhoto : labelTone[tone]]}>{label.toUpperCase()}</Text>
      <View style={styles.body}>{children}</View>
    </Pressable>
  );
}

/** A widget's leading SF Symbol, top left under the label. */
export function WidgetIcon({ name, color = Polar.ink }: { name: SymbolName; color?: string }) {
  return (
    <View style={styles.icon}>
      <SymbolView name={name} size={26} tintColor={color} weight="medium" />
    </View>
  );
}

export const widgetText = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '600', lineHeight: 20, color: '#000' },
  dim: { fontSize: 13, lineHeight: 17, color: WidgetColors.grey },
  big: { fontFamily: PolarFonts.display, fontSize: 26, lineHeight: 28, color: '#000' },
  num: { fontFamily: PolarFonts.condensed, fontSize: 40, lineHeight: 44, color: '#000' },
  ember: { fontSize: 13, lineHeight: 17, color: Polar.ember },
  onPhoto: { color: Polar.ice },
});

/* ---------------------------------------------------------------- on a trip */

/**
 * The page while a trip is running: what `Today` used to draw, as widgets. Null outside the trip's
 * days and its eve, which is how the host knows to draw the planning page instead.
 */
export function TripWidgets({
  trip,
  today,
  cachedAt,
  onAsk,
  onOpenTrip,
  saved,
}: {
  trip: Trip;
  /** Today where the trip is when a zone is known, else the device's (see `Home`). */
  today: string;
  /** When this copy was taken, or null when it came from the network. */
  cachedAt: string | null;
  /** Opens Ask scoped to the day on screen. Absent while offline. */
  onAsk?: (dayIndex: number) => void;
  onOpenTrip: () => void;
  saved?: SavedPlace[];
}) {
  const phase = tripPhase(trip, today);
  if (phase !== 'today' && phase !== 'eve') return null;
  const dayIndex = phase === 'today' ? (dayIndexFor(trip, today) ?? 0) : 0;
  const day = trip.itinerary.days[dayIndex];
  if (!day) return null;
  const stops = day.stops ?? [];
  // No clock without a zone, and none on the eve: the day still draws, only "now" goes quiet.
  const now = phase === 'today' ? nowInZone(trip.timezone) : null;
  const glance = now === null ? null : glanceFor(stops, now);
  const clock = phase === 'today' ? clockInZone(trip.timezone) : null;

  return (
    <View style={styles.trip}>
      {cachedAt ? (
        <Text maxFontSizeMultiplier={1.6} style={styles.stale}>{`A saved copy from ${clockAt(cachedAt) ?? 'earlier'}. Times and order hold; the forecast may have moved.`}</Text>
      ) : null}

      {glance?.kind === 'live' ? (
        <LiveNext trip={trip} dayIndex={dayIndex} clock={clock} next={glance.next} onAsk={onAsk} />
      ) : null}

      <WidgetGrid>
        {glance?.kind === 'live' && glance.at ? (
          <Widget size="medium" label={clock ? `Now · ${clock}` : 'Now'} onPress={onOpenTrip} accessibilityLabel={`Now at ${glance.at.name}. Open the trip`}>
            <Text maxFontSizeMultiplier={1.3} style={widgetText.big} numberOfLines={2}>
              {glance.at.name}
            </Text>
            <Text maxFontSizeMultiplier={1.6} style={widgetText.dim} numberOfLines={1}>
              {[`Since ${glance.at.time}`, glance.at.durationLabel].filter(Boolean).join(' · ')}
            </Text>
          </Widget>
        ) : null}

        {glance === null || glance.kind !== 'live' ? (
          <Widget size="medium" label={phase === 'eve' ? 'Tomorrow, day 1' : glance?.kind === 'done' ? 'Nothing left today' : 'Today'} onPress={onOpenTrip}>
            <Agenda stops={stops} />
          </Widget>
        ) : null}

        <Smalls day={day} stops={stops} glanceStop={glance?.kind === 'live' ? glance.next.stop : undefined} saved={saved ?? []} destination={trip.destination} onOpenTrip={onOpenTrip} />

        {glance?.kind === 'live' && glance.after.length ? (
          <Widget size="medium" label="Rest of today" onPress={onOpenTrip}>
            <Agenda stops={glance.after} />
          </Widget>
        ) : null}

        <Attention trip={trip} dayIndex={dayIndex} cachedAt={cachedAt} onPress={onOpenTrip} />
      </WidgetGrid>
    </View>
  );
}

/** The next stop as a Live Activity: where, when to leave, a countdown, and the two actions. */
function LiveNext({
  trip,
  dayIndex,
  clock,
  next,
  onAsk,
}: {
  trip: Trip;
  dayIndex: number;
  clock: string | null;
  next: NextGlance;
  onAsk?: (dayIndex: number) => void;
}) {
  const late = next.late !== null;
  return (
    <View style={styles.live} accessibilityRole="summary">
      <View style={styles.liveTop}>
        <View style={styles.liveDot} />
        <Text maxFontSizeMultiplier={1.6} style={styles.liveMeta} numberOfLines={1}>
          {`${trip.destination.split(',')[0].trim()} · Day ${dayIndex + 1} of ${trip.itinerary.days.length}`}
        </Text>
        {clock ? <Text maxFontSizeMultiplier={1.6} style={styles.liveClock}>{clock}</Text> : null}
      </View>
      <View style={styles.liveMain}>
        <View style={styles.liveText}>
          <Text maxFontSizeMultiplier={1.6} style={[styles.liveEyebrow, late && styles.liveAlert]}>{next.stop.time ? `NEXT · ${next.stop.time}` : 'NEXT'}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.liveTitle} numberOfLines={2}>
            {next.stop.name}
          </Text>
          {next.leave || next.leg ? (
            <Text maxFontSizeMultiplier={1.6} style={[styles.liveLeave, late && styles.liveAlert]} numberOfLines={2}>
              {[next.leave, next.leg].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          {next.late ? <Text maxFontSizeMultiplier={1.6} style={[styles.liveLeave, styles.liveAlert]}>{next.late}</Text> : null}
        </View>
        {next.countdown ? (
          <View style={styles.count} accessibilityLabel={`${next.countdown.value} ${next.countdown.unit}`.trim()}>
            <Text maxFontSizeMultiplier={1.3} style={styles.countValue}>{next.countdown.value}</Text>
            {next.countdown.unit ? <Text maxFontSizeMultiplier={1.6} style={styles.countUnit}>{next.countdown.unit}</Text> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.liveActions}>
        {next.stop.lat !== 0 || next.stop.lng !== 0 ? <Directions to={next.stop} /> : null}
        <Pressable
          onPress={onAsk ? () => onAsk(dayIndex) : undefined}
          disabled={!onAsk}
          accessibilityRole="button"
          style={({ pressed }) => [styles.liveGhost, pressed && styles.pressed, !onAsk && styles.dim]}>
          <SymbolView name="bubble.left" size={15} tintColor={Polar.ice} />
          <Text maxFontSizeMultiplier={1.6} style={styles.liveGhostText}>{onAsk ? 'Plans changed?' : 'Needs a connection'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Hands off to the maps app, and says so when it cannot: a tap that did nothing used to look
 * exactly like one that worked. The label reverts on its own; by then they have pressed again.
 */
function Directions({ to }: { to: { lat: number; lng: number } }) {
  const [failed, setFailed] = useState(false);
  return (
    <Pressable
      onPress={() =>
        Linking.openURL(directionsUrl(to)).catch(() => {
          setFailed(true);
          setTimeout(() => setFailed(false), 2500);
        })
      }
      accessibilityRole="button"
      style={({ pressed }) => [styles.go, pressed && styles.goPressed]}>
      <SymbolView name="location.north.fill" size={15} tintColor={Polar.ink} />
      <Text maxFontSizeMultiplier={1.6} style={styles.goText}>{failed ? 'Can’t open Maps' : 'Directions'}</Text>
    </Pressable>
  );
}

/** Up to four stops as a time and a name each. */
function Agenda({ stops }: { stops: Stop[] }) {
  return (
    <View style={styles.agenda}>
      {stops.slice(0, 4).map((s, i) => (
        <View key={`${s.name}-${i}`} style={styles.agendaRow}>
          <Text maxFontSizeMultiplier={1.6} style={styles.agendaTime}>{s.time}</Text>
          <Text maxFontSizeMultiplier={1.6} style={styles.agendaName} numberOfLines={1}>
            {s.name}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The two small widgets: the day's forecast, and a saved place near you. One alone takes the full
 * width rather than leaving a hole beside it.
 */
function Smalls({ day, stops, glanceStop, saved, destination, onOpenTrip }: { day: Trip['itinerary']['days'][number]; stops: Stop[]; glanceStop?: Stop; saved: SavedPlace[]; destination: string; onOpenTrip: () => void }) {
  const { here } = useHere();
  const w = day.weatherDetail;
  const unused = savedNotInPlan(saved, stops, destination);
  const anchor = here ?? (glanceStop && (glanceStop.lat !== 0 || glanceStop.lng !== 0) ? { lat: glanceStop.lat, lng: glanceStop.lng } : null);
  const near = savedNearby(unused, anchor)[0];
  const items = [
    w ? 'weather' : null,
    near ? 'saved' : null,
  ].filter(Boolean) as ('weather' | 'saved')[];
  const size: Size = items.length === 1 ? 'medium' : 'small';
  return (
    <>
      {items.map((k) =>
        k === 'weather' && w ? (
          <Widget key={k} size={size} label={w.historical ? 'Weather · usual' : 'Weather'} onPress={onOpenTrip} accessibilityLabel={`High ${Math.round(w.tempMaxC)} degrees, low ${Math.round(w.tempMinC)}`}>
            <WidgetIcon name="sun.max.fill" color="#E0A100" />
            <Text maxFontSizeMultiplier={1.3} style={widgetText.num}>{`${Math.round(w.tempMaxC)}°`}</Text>
            <Text maxFontSizeMultiplier={1.6} style={widgetText.dim} numberOfLines={1}>
              {`Low ${Math.round(w.tempMinC)}°${w.precipitationProbability !== null ? ` · ${w.precipitationProbability}% rain` : ''}`}
            </Text>
          </Widget>
        ) : near ? (
          <Widget
            key={k}
            size={size}
            label={here ? 'Saved, near you' : 'Saved nearby'}
            onPress={() => {
              if (typeof near.place.lat === 'number' && typeof near.place.lng === 'number') void Linking.openURL(directionsUrl({ lat: near.place.lat, lng: near.place.lng })).catch(() => {});
            }}
            accessibilityLabel={`Saved place ${near.place.name}. Directions`}>
            <WidgetIcon name="mappin.and.ellipse" color={Polar.ember} />
            <Text maxFontSizeMultiplier={1.6} style={widgetText.title} numberOfLines={2}>
              {near.place.name}
            </Text>
            {describeDistance(near.metres) ? <Text maxFontSizeMultiplier={1.6} style={widgetText.dim}>{`${describeDistance(near.metres)} away`}</Text> : null}
          </Widget>
        ) : null,
      )}
    </>
  );
}

/** What needs attention today: blocking findings for this day, and rain worth knowing about. */
function Attention({ trip, dayIndex, cachedAt, onPress }: { trip: Trip; dayIndex: number; cachedAt: string | null; onPress: () => void }) {
  const findings = tripHealth(trip)
    .dimensions.flatMap((d) => d.findings)
    .filter((f) => isBlocking(f) && f.dayIndex === dayIndex);
  const rain = trip.itinerary.days[dayIndex]?.weatherDetail?.precipitationProbability ?? null;
  const wet = rain !== null && rain >= 50;
  if (findings.length === 0 && !wet) return null;
  // A cached forecast changes tense; a cached itinerary does not.
  const lines = [
    ...findings.slice(0, 2).map((f) => f.message),
    wet ? (cachedAt ? `Rain was forecast today: ${rain}%${clockAt(cachedAt) ? `, as of ${clockAt(cachedAt)}` : ''}.` : `Rain likely today: ${rain}% chance.`) : null,
  ].filter(Boolean) as string[];
  return (
    <Widget size="medium" tone="warn" label="Worth a look" onPress={onPress}>
      {lines.map((line) => (
        <View key={line} style={styles.warnRow}>
          <SymbolView name="exclamationmark.triangle.fill" size={14} tintColor={WidgetColors.warnInk} />
          <Text maxFontSizeMultiplier={1.6} style={styles.warnText} numberOfLines={3}>
            {line}
          </Text>
        </View>
      ))}
    </Widget>
  );
}

/* ---------------------------------------------------------------- planning */

/** The large photo widget: the next trip and the days to go, or the latest memory. */
/**
 * The lead as the design draws it (home-4, Planning): the destination's photograph, the countdown
 * top right in signal, the city as a monument, then "Nov 6 – 12 · 7 days · $1,800". `note` is a
 * line under that, for a draft leading the page (its `clearsIn`), so the card never passes an
 * unkept plan off as a trip.
 */
export function TripPhotoWidget({
  label,
  trip,
  photo,
  days,
  note,
  size = 'large',
  onPress,
}: {
  label: string;
  trip: { destination: string; startDate: string; endDate: string; budget?: number };
  /** Large when the trip is the page; medium when ideas follow it (Home not on a trip). */
  size?: 'medium' | 'large';
  photo: string | null;
  days: number | null;
  note?: string | null;
  onPress: () => void;
}) {
  const city = trip.destination.split(',')[0].trim();
  const length = tripDays(trip.startDate, trip.endDate);
  const meta = [formatRange(trip.startDate, trip.endDate), `${length} ${length === 1 ? 'day' : 'days'}`, trip.budget ? formatMoney(trip.budget) : null]
    .filter(Boolean)
    .join(' · ');
  // A medium card is one row tall, so at the larger text sizes the meta reaches the countdown's
  // corner: there it wraps short of it instead of running under the figure.
  const { fontScale } = useWindowDimensions();
  const crowded = size === 'medium' && days !== null && days > 0 && fontScale > 1.2;
  return (
    <Widget size={size} photo={photo} label={label} onPress={onPress} accessibilityLabel={`${label}: ${trip.destination}${days !== null ? `, in ${days} days` : ''}${note ? `. ${note}` : ''}`}>
      {days !== null && days > 0 ? (
        <View style={styles.daysToGo}>
          <Text maxFontSizeMultiplier={1.3} style={styles.daysValue}>{days}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.daysUnit}>{days === 1 ? 'day to go' : 'days to go'}</Text>
        </View>
      ) : null}
      <Text maxFontSizeMultiplier={1.3} style={styles.photoCity} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>
        {city.toUpperCase()}
      </Text>
      <Text maxFontSizeMultiplier={1.6} style={[styles.photoMeta, crowded && styles.photoMetaShort]} numberOfLines={crowded ? 3 : 1}>
        {meta}
      </Text>
      {note ? <Text maxFontSizeMultiplier={1.6} style={styles.photoNote}>{note}</Text> : null}
    </Widget>
  );
}

const toneStyle = StyleSheet.create({
  light: { backgroundColor: WidgetColors.card },
  signal: { backgroundColor: Polar.signal },
  paper: { backgroundColor: Polar.paper },
  warn: { backgroundColor: WidgetColors.warn },
});
const labelTone = StyleSheet.create({
  light: { color: WidgetColors.grey },
  signal: { color: 'rgba(31,42,68,0.7)' },
  paper: { color: Polar.ember },
  warn: { color: '#9A4700' },
});

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: PAD },
  widget: {
    overflow: 'hidden',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    shadowColor: Polar.ink,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  dim: { opacity: 0.5 },
  scrim: { backgroundColor: 'rgba(9,11,16,0.35)' },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7 },
  labelOnPhoto: { color: 'rgba(255,255,255,0.85)' },
  body: { flex: 1, justifyContent: 'flex-end', gap: 3 },
  // In the flow, pushed to the top by the auto margin, rather than absolute: same place at the
  // ordinary sizes, and at the large ones the words below push it rather than run under it.
  icon: { marginTop: 6, marginBottom: 'auto', alignSelf: 'flex-start' },

  // In the card's top-right corner on the same margins as the label opposite it: right flush with
  // the padding (less the figures' side bearing), and the top pulled up by their own leading so the
  // cap line meets the label's. Measured on the sim: both ~16pt in from the card's top and right.
  // No lineHeight on the figure: Oswald's ascent is taller than 74pt type, and a tighter line box
  // clips the tops of the digits flat on iOS.
  daysToGo: { position: 'absolute', top: -40, right: -3, alignItems: 'flex-end' },
  daysValue: { fontFamily: PolarFonts.condensed, fontSize: 74, color: Polar.signal },
  daysUnit: { marginTop: -16, marginRight: 3, fontSize: 13, fontWeight: '600', color: Polar.ice },
  photoCity: { fontFamily: PolarFonts.condensed, fontSize: 52, lineHeight: 56, color: Polar.ice },
  photoMeta: { fontSize: 15, lineHeight: 20, fontWeight: '500', color: Polar.ice, fontVariant: ['tabular-nums'] },
  photoMetaShort: { maxWidth: '58%' },
  photoNote: { marginTop: 2, fontSize: 13, lineHeight: 17, color: Polar.frost68 },

  trip: { gap: GAP },
  stale: { marginHorizontal: 20, fontSize: 13, lineHeight: 18, color: WidgetColors.grey },

  live: { marginHorizontal: PAD, padding: 16, borderRadius: 24, backgroundColor: WidgetColors.live, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 15, shadowOffset: { width: 0, height: 12 } },
  liveTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Polar.signal },
  liveMeta: { flex: 1, fontSize: 13, fontWeight: '600', color: 'rgba(235,235,245,0.7)' },
  liveClock: { fontSize: 13, fontWeight: '600', color: 'rgba(235,235,245,0.7)', fontVariant: ['tabular-nums'] },
  liveMain: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 10 },
  liveText: { flex: 1, gap: 2 },
  liveEyebrow: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7, color: Polar.signal },
  liveTitle: { fontFamily: PolarFonts.display, fontSize: 26, lineHeight: 28, color: Polar.ice },
  liveLeave: { marginTop: 4, fontSize: 14, lineHeight: 19, color: 'rgba(235,235,245,0.7)' },
  liveAlert: { color: Polar.alertNight },
  count: { minWidth: 66, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 16, alignItems: 'center', backgroundColor: 'rgba(255,126,21,0.18)' },
  countValue: { fontFamily: PolarFonts.condensed, fontSize: 32, lineHeight: 36, color: Polar.signal },
  countUnit: { fontSize: 12, color: Polar.signal },
  // Wraps at the large text sizes: Plans changed? takes a line of its own instead of squeezing
  // Directions down to a word broken in two.
  liveActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  go: { flexGrow: 1, minHeight: 46, paddingHorizontal: 16, borderRadius: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Polar.signal },
  goPressed: { backgroundColor: Polar.signalPressed },
  goText: { fontSize: 16, fontWeight: '600', color: Polar.ink },
  liveGhost: { minHeight: 46, paddingHorizontal: 16, borderRadius: 23, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)' },
  liveGhostText: { fontSize: 15, fontWeight: '600', color: Polar.ice },

  agenda: { gap: 8 },
  agendaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  agendaTime: { minWidth: 70, fontFamily: PolarFonts.condensed, fontSize: 15, color: Polar.ember },
  agendaName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#000' },

  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  warnText: { flex: 1, fontSize: 15, fontWeight: '500', lineHeight: 20, color: WidgetColors.warnInk },
});
