import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop as GradientStop } from 'react-native-svg';

import { usePlacePhoto } from '@/api/placePhotos';
import type { DayPlan, SharedTrip, Stop } from '@/api/types';
import { RoundButton } from '@/components/glass-auth';
import { SettingsColors } from '@/components/settings-list';
import { ControlShadow } from '@/constants/theme';
import { Polar, PolarFonts } from '@/constants/polar';
import { formatDayChip, formatRange, weatherLine } from '@/lib/dayDisplay';
import { directionsUrl } from '@/lib/directions';
import { timelineRows, type TimelineLeg } from '@/lib/sharedTimeline';
import { formatMoney } from '@/lib/spend';

/**
 * A trip somebody sent you, as the canvas design "Phone shared trip · 4 Cover, days, thumb bar".
 *
 * The pieces only; `app/s/[token].tsx` holds the trip, the day and the save. A photograph cover that
 * says who sent it, the days as calendar tiles with the chosen day already open beneath them, each
 * day as a timeline, and the trip screen's own thumb bar with Save a copy as the one action.
 */

type SymbolName = SymbolViewProps['name'];

export const SharedColors = {
  ground: SettingsColors.ground,
  /** One step darker than iOS's 60% grey, which measured 3.3:1 on this ground. */
  grey: '#636366',
  body: '#3C3C43',
  red: '#D70015',
  booked: '#1F6F66',
  bookedTint: '#E3F0EE',
} as const;

/** Category colours deep enough to carry a white numeral at 4.5:1. */
export const categoryInk: Record<Stop['category'], string> = { entry: '#2F6BC2', food: '#C8323A', transit: '#636366', other: '#6E4FBF' };
const categoryName: Record<Stop['category'], string> = { entry: 'Sight', food: 'Food', transit: 'Transit', other: 'Place' };

export const COVER_HEIGHT = 420;

/* ---------------------------------------------------------------- the cover */

export function Cover({ trip, onClose, onShare }: { trip: SharedTrip; onClose: () => void; onShare: () => void }) {
  const insets = useSafeAreaInsets();
  const photo = usePlacePhoto(trip.destination);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? undefined;
  const days = trip.itinerary.days.length;
  const city = trip.destination.split(',')[0].trim();
  return (
    <View style={styles.cover}>
      {url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
      ) : null}
      {/* Darker at the foot, where the words are, and a touch at the head, under the buttons. */}
      <View style={[StyleSheet.absoluteFill, styles.scrimAll]} />
      <View style={styles.scrimFoot} />
      {/* And a fall of shade under the status bar. **On iOS 26 the bar's colour follows what is under
          it, not what the app asks**: measured on this screen, React Native held "light-content" and a
          pale sky still drew a black clock, and a black band under it drew a white one. This is the
          lightest shade that tips it to white over Val d'Orcia's sky. */}
      <Svg style={[styles.scrimHead, { height: insets.top + 130 }]} width="100%" height={insets.top + 130} pointerEvents="none">
        <Defs>
          <LinearGradient id="head" x1="0" y1="0" x2="0" y2="1">
            <GradientStop offset="0" stopColor="#090B10" stopOpacity={0.72} />
            <GradientStop offset="0.45" stopColor="#090B10" stopOpacity={0.42} />
            <GradientStop offset="1" stopColor="#090B10" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#head)" />
      </Svg>
      <View style={[styles.corner, { top: insets.top + 4 }]}>
        <RoundButton icon={{ ios: 'xmark', android: 'close' }} label="Close" onPress={onClose} />
        <RoundButton icon={{ ios: 'square.and.arrow.up', android: 'share' }} label="Share the link" onPress={onShare} />
      </View>
      <Animated.View entering={FadeInDown.duration(500)} style={styles.coverText}>
        <View style={styles.eyebrow}>
          {trip.sharedBy ? (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{trip.sharedBy[0].toUpperCase()}</Text>
            </View>
          ) : null}
          <Text style={styles.eyebrowText}>{trip.sharedBy ? `${trip.sharedBy} sent you a trip` : 'A trip shared with you'}</Text>
        </View>
        <Text style={styles.coverTitle} accessibilityRole="header">
          {`${days} ${days === 1 ? 'day' : 'days'} in ${city}`}
        </Text>
        <Text style={styles.coverMeta}>
          {[formatRange(trip.startDate, trip.endDate), days > 1 ? `${days - 1} ${days === 2 ? 'night' : 'nights'}` : null, `about ${formatMoney(planned(trip.itinerary.days))}`]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Animated.View>
    </View>
  );
}

/** What the plan says it costs: the estimates only. The sender's real spending is theirs. */
function planned(days: DayPlan[]): number {
  return days.reduce((sum, day) => sum + (day.lodging?.cost ?? 0) + day.stops.reduce((s, stop) => s + (stop.cost || 0), 0), 0);
}

/* ---------------------------------------------------------------- the days, as calendar tiles */

/**
 * Apple's Calendar icon: a white tile, the weekday in red over a large light date; the chosen day
 * inverts to ink. **Every tile is the same width**, the widest a two-digit date needs at the
 * current text size, so the gaps between them are equal whether the date is 6 or 12.
 */
export function DayTiles({ days, current, onPick }: { days: DayPlan[]; current: number; onPick: (index: number) => void }) {
  const { fontScale } = useWindowDimensions();
  const width = Math.round(48 * Math.max(1, fontScale));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles} accessibilityRole="tablist">
      {days.map((day, i) => {
        const chip = formatDayChip(day.date);
        const on = i === current;
        return (
          <Pressable
            key={day.date + i}
            onPress={() => onPick(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Day ${i + 1}${chip ? `, ${spokenDate(day.date)}` : ''}`}
            style={({ pressed }) => [styles.tile, { width }, on && styles.tileOn, pressed && styles.pressed]}>
            <Text style={[styles.tileWeekday, on && styles.tileWeekdayOn]}>{(chip?.weekday ?? `D${i + 1}`).toUpperCase()}</Text>
            <Text style={[styles.tileDate, on && styles.tileDateOn]}>{chip?.dayOfMonth ?? i + 1}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** "Nov 6", read as a calendar date so it never rolls back a day west of Greenwich. */
function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function spokenDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/* ---------------------------------------------------------------- the day */

export function DayHead({ day, index }: { day: DayPlan; index: number }) {
  const chip = formatDayChip(day.date);
  const weather = weatherLine(day);
  return (
    <View style={styles.dayHead}>
      <Text style={styles.dayEyebrow}>
        {[`Day ${index + 1}`, chip ? `${chip.weekday} ${shortDate(day.date)}` : null, weather].filter(Boolean).join(' · ')}
      </Text>
      {day.theme || day.title ? <Text style={styles.dayTitle}>{day.theme || day.title}</Text> : null}
      {day.summary ? <Text style={styles.daySummary}>{day.summary}</Text> : null}
    </View>
  );
}

const MODE: Record<TimelineLeg['mode'], { label: string; icon: SymbolName }> = {
  walk: { label: 'on foot', icon: { ios: 'figure.walk', android: 'directions_walk' } },
  bike: { label: 'by bike', icon: { ios: 'bicycle', android: 'pedal_bike' } },
  transit: { label: 'by transit', icon: { ios: 'tram.fill', android: 'tram' } },
  drive: { label: 'by car', icon: { ios: 'car.fill', android: 'directions_car' } },
};

/**
 * The day as a timeline: start and end on the left, the stop's number on a rail, and each leg drawn
 * as the rail itself between two stops with how long it takes. A leg the plan leaves too little
 * time for says how much there is, in ember.
 */
export function Timeline({ stops, sharedBy, onOpen }: { stops: Stop[]; sharedBy: string | null; onOpen: (index: number) => void }) {
  const rows = timelineRows(stops);
  // One width for the whole day, so the rail runs straight: "9:00 AM" and "11:00 AM" differ, and a
  // column sized per row would kink the line between them.
  const { fontScale } = useWindowDimensions();
  const twelve = rows.some((r) => /am|pm/i.test(r.start));
  const timeWidth = Math.round((twelve ? 80 : 48) * Math.max(1, fontScale));
  return (
    <View style={styles.line}>
      {stops.map((stop, i) => {
        const row = rows[i];
        const leg = row.leg;
        const first = i === 0;
        const last = i === stops.length - 1;
        const how = leg ? `${leg.minutes} min ${MODE[leg.mode].label}` : '';
        const booked = stop.timeFlexibility === 'FIXED';
        return (
          <Animated.View key={`${stop.name}-${i}`} entering={FadeInDown.duration(320).delay(Math.min(i, 5) * 40)}>
            {leg ? (
              <View
                style={styles.leg}
                accessible
                accessibilityLabel={`${stops[i - 1].name} to ${stop.name}: ${how}${leg.short ? `, ${fit(leg, true)}` : ''}`}>
                <View style={[styles.timeCol, { width: timeWidth }]} />
                <View style={styles.railCol}>
                  <View style={[styles.rail, styles.railDashed]} />
                  <View style={styles.legBadge}>
                    <SymbolView name={MODE[leg.mode].icon} size={11} tintColor={SharedColors.grey} />
                  </View>
                </View>
                <Text style={[styles.legText, leg.short && styles.legShort]}>
                  {how}
                  {leg.short ? ` · ${fit(leg, false)}` : ''}
                </Text>
              </View>
            ) : null}
            <Pressable
              onPress={() => onOpen(i)}
              accessibilityRole="button"
              accessibilityLabel={[
                `Stop ${i + 1} of ${stops.length}, ${stop.name}`,
                row.end ? `${row.start} until ${row.end}` : row.start,
                categoryName[stop.category],
                stop.cost ? formatMoney(stop.cost) : 'free',
                booked ? `booked by ${sharedBy ?? 'the sender'}` : null,
              ]
                .filter(Boolean)
                .join(', ')}
              style={({ pressed }) => [styles.stop, pressed && styles.stopPressed]}>
              <View style={[styles.timeCol, { width: timeWidth }]}>
                <Text style={styles.start} numberOfLines={1}>{row.start}</Text>
                {row.end ? <Text style={styles.end} numberOfLines={1}>{row.end}</Text> : null}
              </View>
              <View style={styles.railCol}>
                <View style={[styles.rail, first && styles.railFirst, last && styles.railLast, first && last && styles.railNone]} />
                <View style={[styles.dot, { backgroundColor: categoryInk[stop.category] }]}>
                  <Text style={styles.dotText}>{i + 1}</Text>
                </View>
              </View>
              <View style={styles.body}>
                <Text style={styles.name}>{stop.name}</Text>
                <Text style={styles.meta}>
                  {[categoryName[stop.category], stop.durationLabel, stop.cost ? formatMoney(stop.cost) : 'Free'].filter(Boolean).join(' · ')}
                </Text>
                {stop.note ? <Text style={styles.note}>{stop.note}</Text> : null}
                {booked ? (
                  <View style={styles.booked}>
                    <SymbolView name={{ ios: 'lock.fill', android: 'lock' }} size={10} tintColor={SharedColors.booked} />
                    <Text style={styles.bookedText}>{sharedBy ? `${sharedBy} booked` : 'Booked by the sender'}</Text>
                  </View>
                ) : null}
              </View>
              <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right' }} size={12} tintColor={SettingsColors.faint} style={styles.chevron} />
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** What a leg that does not fit says: how much time the plan leaves, or that the stops overlap. */
function fit(leg: TimelineLeg, spoken: boolean): string {
  const gap = leg.gap ?? 0;
  if (gap < 0) return spoken ? 'and it starts before the stop before it ends' : 'starts before the last one ends';
  return spoken ? `but only ${gap} minutes between them` : `only ${gap} min between`;
}

/* ---------------------------------------------------------------- the thumb bar */

/**
 * The trip screen's own toolbar material and its List | Map switch, so a shared trip reads like a
 * trip; the one action is Save a copy, and once there is a copy, Open my copy.
 */
export function ThumbBar({
  face,
  onFace,
  phase,
  sharedBy,
  onSave,
  onOpenCopy,
  onHeight,
}: {
  face: 'list' | 'map';
  onFace: (face: 'list' | 'map') => void;
  phase: 'idle' | 'saving' | 'saved' | 'failed';
  sharedBy: string | null;
  onSave: () => void;
  onOpenCopy: () => void;
  onHeight: (height: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom - 6, 8);
  const glass = isLiquidGlassAvailable();
  const saved = phase === 'saved';
  return (
    <View pointerEvents="box-none" style={[styles.dock, { bottom }]} onLayout={(e) => onHeight(e.nativeEvent.layout.height + bottom)}>
      {saved || phase === 'failed' ? (
        <Animated.View entering={FadeInDown.duration(260)} style={[styles.notice, ControlShadow]} accessibilityLiveRegion="polite">
          <SymbolView
            name={saved ? { ios: 'checkmark.circle.fill', android: 'check_circle' } : { ios: 'exclamationmark.circle.fill', android: 'error' }}
            size={15}
            tintColor={saved ? SharedColors.booked : Polar.ember}
          />
          <Text style={styles.noticeText}>
            {saved ? `Saved to your Trips. Changes there won't touch ${sharedBy ? `${sharedBy}'s` : 'the original'} plan.` : "Couldn't save a copy just now. Try again."}
          </Text>
        </Animated.View>
      ) : null}
      <View style={[styles.bar, ControlShadow]}>
        {glass ? (
          <GlassView glassEffectStyle="regular" colorScheme="light" isInteractive style={StyleSheet.absoluteFill} />
        ) : (
          <BlurView intensity={80} tint="systemChromeMaterialLight" style={StyleSheet.absoluteFill} />
        )}
        <View style={styles.switch}>
          {(['list', 'map'] as const).map((option) => {
            const on = face === option;
            return (
              <Pressable
                key={option}
                onPress={() => onFace(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.half, on && styles.halfOn]}>
                <SymbolView
                  name={option === 'list' ? { ios: 'list.bullet', android: 'format_list_bulleted' } : { ios: 'map', android: 'map' }}
                  tintColor={on ? Polar.ink : SharedColors.grey}
                  size={14}
                />
                <Text style={[styles.halfText, on && styles.halfTextOn]}>{option === 'list' ? 'List' : 'Map'}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={saved ? onOpenCopy : onSave}
          disabled={phase === 'saving'}
          accessibilityRole="button"
          accessibilityState={{ busy: phase === 'saving' }}
          style={({ pressed }) => [styles.save, pressed && styles.savePressed]}>
          <Text style={styles.saveText}>{phase === 'saving' ? 'Saving…' : saved ? 'Open my copy' : 'Save a copy'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- a stop, opened */

/** The stop's particulars and a way there. Nothing on it edits: the plan is the sender's. */
export function StopSheet({ stop, index, day, sharedBy, onClose }: { stop: Stop | null; index: number; day: DayPlan | null; sharedBy: string | null; onClose: () => void }) {
  const rows = day ? timelineRows(day.stops) : [];
  const row = rows[index];
  return (
    <Modal visible={!!stop} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {stop ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={[styles.dot, styles.sheetDot, { backgroundColor: categoryInk[stop.category] }]}>
              <Text style={styles.dotText}>{index + 1}</Text>
            </View>
            <View style={styles.body}>
              <Text style={styles.sheetName} accessibilityRole="header">
                {stop.name}
              </Text>
              <Text style={styles.meta}>{[row?.end ? `${row.start} – ${row.end}` : row?.start, stop.durationLabel, categoryName[stop.category]].filter(Boolean).join(' · ')}</Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.sheetClose}>
              <SymbolView name={{ ios: 'xmark', android: 'close' }} size={13} tintColor={SharedColors.grey} weight="semibold" />
            </Pressable>
          </View>
          <Pressable onPress={() => Linking.openURL(directionsUrl(stop))} accessibilityRole="button" style={({ pressed }) => [styles.directions, pressed && styles.savePressed]}>
            <SymbolView name={{ ios: 'arrow.triangle.turn.up.right.diamond.fill', android: 'directions' }} size={17} tintColor={Polar.ink} />
            <Text style={styles.saveText}>Directions</Text>
          </Pressable>
          <View style={styles.facts}>
            <Fact label="Cost" value={stop.cost ? formatMoney(stop.cost) : 'Free'} />
            {row?.leg ? <Fact label="From the stop before" value={`about ${row.leg.minutes} min ${MODE[row.leg.mode].label}`} /> : null}
            {stop.timeFlexibility === 'FIXED' ? <Fact label="Booked" value={`${sharedBy ?? 'The sender'} booked this one`} /> : null}
            {stop.note ? <Fact label="Note" value={stop.note} last /> : null}
          </View>
          {stop.why ? <Text style={styles.why}>{stop.why}</Text> : null}
        </View>
      ) : null}
    </Modal>
  );
}

function Fact({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.fact, !last && styles.factRule]}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- the ends */

/** A link that no longer opens: a broken link, drawn, since SF Symbols has no slashed one. */
export function LinkOff() {
  return (
    <Svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={SharedColors.grey} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9.5 14.5 14.5 9.5M8 11l-2.2 2.2a3.5 3.5 0 0 0 5 5L13 16M16 13l2.2-2.2a3.5 3.5 0 0 0-5-5L11 8M3.5 3.5l17 17" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },

  cover: { height: COVER_HEIGHT, backgroundColor: '#1C1C1E', overflow: 'hidden' },
  scrimAll: { backgroundColor: 'rgba(9,11,16,0.18)' },
  scrimHead: { position: 'absolute', top: 0, left: 0, right: 0 },
  scrimFoot: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%', backgroundColor: 'rgba(9,11,16,0.5)' },
  corner: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  coverText: { position: 'absolute', left: 22, right: 22, bottom: 24 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.24)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  avatarText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  eyebrowText: { fontSize: 15, fontWeight: '500', color: '#fff' },
  coverTitle: { marginTop: 8, fontFamily: PolarFonts.display, fontSize: 46, lineHeight: 46, color: '#fff' },
  coverMeta: { marginTop: 6, fontSize: 15, color: 'rgba(255,255,255,0.86)', fontVariant: ['tabular-nums'] },

  tiles: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tile: {
    minHeight: 52,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  tileOn: { backgroundColor: Polar.ink, shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  tileWeekday: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2, color: SharedColors.red },
  tileWeekdayOn: { color: Polar.signal },
  tileDate: { fontSize: 24, fontWeight: '300', letterSpacing: -0.4, color: '#000', fontVariant: ['tabular-nums'] },
  tileDateOn: { color: '#fff' },

  dayHead: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14 },
  dayEyebrow: { fontSize: 13, color: SharedColors.grey },
  dayTitle: { marginTop: 4, fontFamily: PolarFonts.display, fontSize: 32, lineHeight: 34, color: '#000' },
  daySummary: { marginTop: 6, fontSize: 15, lineHeight: 21, color: SharedColors.body },

  line: { marginHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: '#fff' },
  stop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  stopPressed: { backgroundColor: SettingsColors.pressed },
  timeCol: { alignItems: 'flex-end', paddingTop: 3 },
  start: { fontSize: 15, fontWeight: '600', color: '#000', fontVariant: ['tabular-nums'] },
  end: { fontSize: 13, color: SharedColors.grey, fontVariant: ['tabular-nums'] },
  railCol: { width: 28, alignSelf: 'stretch', alignItems: 'center' },
  rail: { position: 'absolute', top: -10, bottom: -10, width: 2, backgroundColor: 'rgba(60,60,67,0.14)' },
  railFirst: { top: 14 },
  railLast: { bottom: undefined, height: 24 },
  railNone: { display: 'none' },
  railDashed: { top: 0, bottom: 0, backgroundColor: 'transparent', borderLeftWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(60,60,67,0.22)' },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' },
  dotText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  body: { flex: 1, minWidth: 0, gap: 1, paddingTop: 2 },
  name: { fontSize: 17, fontWeight: '600', color: '#000' },
  meta: { fontSize: 13, color: SharedColors.grey },
  note: { marginTop: 3, fontSize: 14, lineHeight: 19, color: SharedColors.body },
  booked: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: SharedColors.bookedTint,
  },
  bookedText: { fontSize: 12, fontWeight: '600', color: SharedColors.booked },
  chevron: { alignSelf: 'center' },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30, paddingHorizontal: 14 },
  legBadge: {
    width: 22,
    height: 22,
    marginTop: 4,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.16)',
  },
  legText: { flex: 1, fontSize: 13, color: SharedColors.grey },
  legShort: { fontWeight: '500', color: Polar.ember },

  dock: { position: 'absolute', left: 16, right: 16, alignItems: 'stretch', gap: 8 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.97)',
  },
  noticeText: { flexShrink: 1, fontSize: 13, lineHeight: 17, color: '#1C1C1E' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderRadius: 999, overflow: 'hidden' },
  switch: { flexDirection: 'row', height: 44, padding: 3, borderRadius: 999, backgroundColor: 'rgba(120,120,128,0.14)' },
  half: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, borderRadius: 999 },
  halfOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  halfText: { fontSize: 14, fontWeight: '600', color: SharedColors.grey },
  halfTextOn: { color: Polar.ink },
  save: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.signal },
  savePressed: { backgroundColor: Polar.signalPressed },
  saveText: { fontSize: 16, fontWeight: '600', color: Polar.ink },

  sheet: { flex: 1, padding: 20, backgroundColor: SharedColors.ground },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 8 },
  sheetDot: { borderWidth: 0, marginTop: 2 },
  sheetName: { fontSize: 22, fontWeight: '600', color: '#000' },
  sheetClose: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(120,120,128,0.16)' },
  directions: {
    flexDirection: 'row',
    gap: 8,
    height: 50,
    marginTop: 20,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Polar.signal,
  },
  facts: { marginTop: 20, borderRadius: 12, backgroundColor: '#fff', paddingLeft: 16 },
  fact: { paddingVertical: 12, paddingRight: 16, gap: 2 },
  factRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: SettingsColors.separator },
  factLabel: { fontSize: 13, color: SharedColors.grey },
  factValue: { fontSize: 16, lineHeight: 21, color: '#000' },
  why: { marginTop: 16, marginHorizontal: 4, fontSize: 15, lineHeight: 21, color: SharedColors.body },
});
