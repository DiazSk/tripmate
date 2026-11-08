import { Capsule, Circle, HStack, Image, Link, ProgressView, Rectangle, RoundedRectangle, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  aspectRatio,
  clipped,
  clipShape,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  kerning,
  labelsHidden,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  opacity,
  padding,
  progressViewStyle,
  resizable,
  strokeBorder,
  textCase,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { placePhotoFor } from '@/api/placePhotos';
import type { Trip } from '@/api/types';
import { dayActivityProps, type DayActivityProps } from '@/lib/dayActivity';
import { savePhoto } from '@/lib/planLiveActivity';
import { tripClockNow } from '@/lib/tripClock';
import { dayIndexFor } from '@/lib/tripPhase';

/**
 * A trip day in the Dynamic Island and on the Lock Screen — the canvas design "Live Activity · 1 Day
 * clock", drawn in SwiftUI through `expo-widgets`. Like `planLiveActivity.tsx`, **this function is
 * not run by the app**: the `'widget'` directive turns it into source the widget extension runs on
 * its own, so everything it uses is defined inside it and props arrive as JSON.
 *
 * Once iOS marks the activity stale (`staleAt`, the next change of the day) it draws `next`: one
 * step of the day moves on its own without push. The design's Oswald and Cormorant are the system's
 * faces here: the extension bundles no fonts.
 */
function DayClock(props: DayActivityProps, environment: LiveActivityEnvironment) {
  'widget';
  const SIGNAL = '#FF7E15';
  const ALERT = '#FF6B6B';
  const LABEL2 = 'rgba(235,235,245,0.62)';
  const LABEL3 = 'rgba(235,235,245,0.38)';
  const FROST68 = 'rgba(255,255,255,0.68)';
  const INK = '#1F2A44';
  const f = environment.isStale === true && props.next ? props.next : props.face;
  const late = f.kind === 'late';
  const done = f.kind === 'done';
  const hot = late ? ALERT : SIGNAL;
  const figColor = f.kind === 'imminent' || late ? hot : '#FFFFFF';
  const leave = { lower: new Date(f.barFrom), upper: new Date(f.leaveAt) };
  const icon = f.mode === 'walk' ? 'figure.walk' : f.mode === 'transit' ? 'tram.fill' : f.mode === 'drive' ? 'car.fill' : f.mode === 'bike' ? 'bicycle' : 'clock';

  // The stop's photograph: the artwork, as a track's is in a player.
  const art = (s: number, r: number) =>
    f.photo ? (
      <Image uiImage={f.photo} modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), frame({ width: s, height: s }), clipShape('roundedRectangle', r)]} />
    ) : (
      <RoundedRectangle cornerRadius={r} modifiers={[foregroundStyle('#2A2D35'), frame({ width: s, height: s })]} />
    );
  // The figure: the leave-by clock until it matters, then iOS's own countdown, then "Now".
  const figure = (size: number) =>
    done ? (
      <Image systemName="checkmark" color="#FFFFFF" size={size * 0.8} />
    ) : f.countdown ? (
      <Text
        timerInterval={leave}
        countsDown
        // An explicit width: a timer measures as its widest possible text, so fixedSize() would
        // push the rest of the island out. "29:59" fits; minimumScaleFactor rather than an ellipsis.
        modifiers={[font({ size, weight: 'medium' }), monospacedDigit(), foregroundStyle(figColor), multilineTextAlignment('trailing'), lineLimit(1), minimumScaleFactor(0.7), frame({ width: size * 3.2, alignment: 'trailing' })]}
      />
    ) : (
      <Text modifiers={[font({ size, weight: 'medium' }), monospacedDigit(), foregroundStyle(figColor), lineLimit(1), fixedSize()]}>{f.figure}</Text>
    );
  const unit = (color: string) => <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(late ? ALERT : color), lineLimit(1)]}>{f.unit}</Text>;
  // The ring round the minimal photo: the 30-minute window filling. A `timerInterval` ring draws iOS's
  // own countdown in its middle, so that text is shrunk to nothing and made clear.
  const ring = (s: number) =>
    f.countdown ? (
      <ProgressView timerInterval={leave} countsDown={false} modifiers={[progressViewStyle('circular'), tint(hot), labelsHidden(), font({ size: 1 }), foregroundStyle('#00000000'), frame({ width: s, height: s })]} />
    ) : (
      <ProgressView value={late || f.figure === 'Now' ? 1 : 0} modifiers={[progressViewStyle('circular'), tint(hot), labelsHidden(), frame({ width: s, height: s })]} />
    );
  const small = (color: string) => [font({ size: 11, weight: 'semibold' }), monospacedDigit(), foregroundStyle(color), lineLimit(1)];
  // The leg as a scrubber: now on the left, the moment to leave on the right.
  const bar = f.countdown ? (
    <ProgressView timerInterval={leave} countsDown={false} modifiers={[progressViewStyle('linear'), tint(hot), labelsHidden(), frame({ maxWidth: 1000, height: 5 })]} />
  ) : (
    <ZStack alignment="leading" modifiers={[frame({ maxWidth: 1000, height: 5 })]}>
      <Capsule modifiers={[foregroundStyle('rgba(255,255,255,0.22)'), frame({ maxWidth: 1000, height: 5 })]} />
      <Capsule modifiers={[foregroundStyle(done ? 'rgba(255,255,255,0.7)' : hot), frame(late || done || f.figure === 'Now' ? { maxWidth: 1000, height: 5 } : { width: 7, height: 5 })]} />
    </ZStack>
  );
  const leg = (
    <HStack spacing={10}>
      <Image systemName={icon} color={late ? ALERT : LABEL2} size={13} />
      <Text modifiers={small(LABEL2)}>{f.fromLabel}</Text>
      {bar}
      <Text modifiers={small(late ? ALERT : LABEL2)}>{f.toLabel}</Text>
    </HStack>
  );
  const pill = (
    // 34pt, as drawn: a Capsule fills whatever height it is offered, and the Lock Screen offers a lot.
    <ZStack modifiers={[frame({ height: 34 }), fixedSize({ horizontal: true, vertical: false }), opacity(done ? 0.4 : 1)]}>
      <Capsule modifiers={[foregroundStyle(SIGNAL)]} />
      <HStack spacing={6} modifiers={[padding({ horizontal: 14 })]}>
        <Image systemName="arrow.triangle.turn.up.right.diamond.fill" color={INK} size={13} />
        <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(INK)]}>Directions</Text>
      </HStack>
    </ZStack>
  );
  const directions = f.directions ? <Link destination={f.directions}>{pill}</Link> : pill;
  // The day: stops done, the one ahead, the rest.
  const dayLine = (
    <HStack spacing={5}>
      {Array.from({ length: props.stopCount }, (_, k) => {
        const current = k === f.stopIndex && !done;
        const dot = (
          <Circle
            modifiers={[
              foregroundStyle(done || k < f.stopIndex ? 'rgba(255,255,255,0.7)' : current ? hot : '#00000000'),
              ...(k > f.stopIndex && !done ? [strokeBorder({ color: 'rgba(255,255,255,0.4)', shape: 'circle', style: { lineWidth: 1.5 } })] : []),
              frame({ width: current ? 9 : 6, height: current ? 9 : 6 }),
            ]}
          />
        );
        return k === 0 ? (
          <ZStack key={k}>{dot}</ZStack>
        ) : (
          <HStack key={k} spacing={5}>
            <Capsule modifiers={[foregroundStyle(k <= f.stopIndex || done ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)'), frame({ maxWidth: 1000, height: 2 })]} />
            {dot}
          </HStack>
        );
      })}
    </HStack>
  );
  const words = (titleSize: number, serif: boolean, color: string) => (
    <VStack alignment="leading" spacing={serif ? 2 : 1} modifiers={[frame({ maxWidth: 1000, alignment: 'leading' })]}>
      <Text modifiers={[font({ size: 11, weight: 'semibold' }), kerning(0.6), textCase('uppercase'), foregroundStyle(late ? ALERT : color), lineLimit(1)]}>{f.eyebrow}</Text>
      <Text modifiers={[font(serif ? { size: titleSize, weight: 'medium', design: 'serif' } : { size: titleSize, weight: 'semibold' }), kerning(serif ? 0 : -0.2), foregroundStyle('#FFFFFF'), lineLimit(1)]}>{f.title}</Text>
      <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(late ? ALERT : color), lineLimit(1)]}>{f.sub}</Text>
    </VStack>
  );

  return {
    compactLeading: art(24, 6),
    compactTrailing: done ? (
      <Image systemName="checkmark" color="#FFFFFF" size={16} />
    ) : f.countdown ? (
      <Text timerInterval={leave} countsDown modifiers={[font({ size: 16, weight: 'medium' }), monospacedDigit(), foregroundStyle(figColor), multilineTextAlignment('trailing'), frame({ width: 46, alignment: 'trailing' })]} />
    ) : (
      <Text modifiers={[font({ size: 16, weight: 'medium' }), monospacedDigit(), foregroundStyle(figColor), lineLimit(1)]}>{f.compact}</Text>
    ),
    minimal: (
      <ZStack>
        {ring(30)}
        <ZStack modifiers={[clipShape('circle')]}>{art(22, 11)}</ZStack>
      </ZStack>
    ),
    expandedLeading: art(52, 12),
    expandedCenter: words(17, false, LABEL2),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={3}>
        {figure(28)}
        {unit(LABEL2)}
      </VStack>
    ),
    expandedBottom: (
      <HStack spacing={12} modifiers={[padding({ horizontal: 6, top: 4 })]}>
        {leg}
        {directions}
      </HStack>
    ),
    // The Lock Screen: the stop's photograph under the night, the stop in the display serif.
    banner: (
      <ZStack modifiers={[activityBackgroundTint('#0E1118')]}>
        {f.photo ? <Image uiImage={f.photo} modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), frame({ maxWidth: 1000, maxHeight: 1000 }), clipped()]} /> : null}
        {/* The design's night gradient (0.92 to 0.45 across) as one even layer: the widget draws no gradients. */}
        <Rectangle modifiers={[foregroundStyle('#090B10'), opacity(0.78)]} />
        <VStack alignment="leading" spacing={0} modifiers={[padding({ all: 14 })]}>
          <HStack spacing={8}>
            <Circle modifiers={[foregroundStyle(done ? LABEL3 : hot), frame({ width: 7, height: 7 })]} />
            <Text modifiers={[font({ size: 11, weight: 'medium' }), kerning(2), textCase('uppercase'), foregroundStyle(FROST68), lineLimit(1)]}>{props.day}</Text>
            <Spacer />
            <Text modifiers={[font({ size: 11, weight: 'medium' }), kerning(2.4), textCase('uppercase'), foregroundStyle('#FFFFFF')]}>TripMate</Text>
          </HStack>
          <HStack alignment="bottom" spacing={12} modifiers={[padding({ top: 10 })]}>
            {words(27, true, FROST68)}
            <VStack alignment="trailing" spacing={2}>
              {figure(38)}
              {unit(FROST68)}
            </VStack>
          </HStack>
          <HStack spacing={12} modifiers={[padding({ top: 14 })]}>
            {dayLine}
            {directions}
          </HStack>
        </VStack>
      </ZStack>
    ),
  };
}

/** iOS only: `expo-widgets` has no Live Activities elsewhere. */
export const dayLiveActivity = Platform.OS === 'ios' ? createLiveActivity<DayActivityProps>('DayClock', DayClock) : null;

/** How often the open app brings the day up to date: the figures move by the minute. */
const TICK_MS = 30_000;

/**
 * The day's Live Activity, kept by Home while a trip is running: started on the day, brought up to
 * date whenever the app is open (and each half minute while it stays open), and ended once the day
 * is done. **Leaving Home does not end it**, since the day goes on; a relaunch adopts the activity
 * already running rather than starting a second one.
 */
export function useDayLiveActivity(input: { trip: Trip; dayIndex: number } | null): void {
  const activity = useRef<LiveActivity<DayActivityProps> | null>(null);
  const [tick, setTick] = useState(0);
  const [photos, setPhotos] = useState<Record<number, string | null>>({});
  const trip = input?.trip ?? null;
  const dayIndex = input?.dayIndex ?? 0;
  const day = trip?.itinerary.days[dayIndex] ?? null;

  useEffect(() => {
    if (!dayLiveActivity || !day) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [day]);

  // The day's photographs, copied where the extension can read them; one file per stop.
  useEffect(() => {
    if (!dayLiveActivity || !day || !trip) return;
    let live = true;
    (day.stops ?? []).forEach((stop, k) => {
      void placePhotoFor(stop.name).then(async (photo) => {
        const url = photo?.thumbnailUrl ?? photo?.imageUrl;
        const uri = url ? await savePhoto(url, `day-${trip.id}-${dayIndex}-${k}.jpg`) : null;
        if (live) setPhotos((p) => ({ ...p, [k]: uri }));
      });
    });
    return () => {
      live = false;
    };
  }, [day, trip, dayIndex]);

  useEffect(() => {
    if (!dayLiveActivity || !day || !trip) return;
    // The same rule as Home's widgets: the previous day runs on past midnight until its last stop
    // has ended. Re-derived here because this effect ticks on its own, and the `dayIndex` it was
    // handed is only as fresh as Home's last render.
    const clockNow = tripClockNow(trip);
    if (!clockNow) return;
    const nowMinutes = clockNow.minutes;
    const days = trip.itinerary.days;
    const index = dayIndexFor(trip, clockNow.today) ?? dayIndex;
    const stops = days[index]?.stops ?? day.stops ?? [];
    const tomorrow = days[index + 1];
    const { props, staleAt } = dayActivityProps({
      city: trip.destination.split(',')[0]?.trim() || trip.destination,
      dayNumber: index + 1,
      dayCount: days.length,
      stops,
      tomorrow: tomorrow ? (tomorrow.theme ?? tomorrow.stops?.[0]?.name ?? null) : null,
      now: Date.now(),
      nowMinutes,
    });
    // Photographs are fetched for the day Home handed over; another day's stops have none yet.
    const photoOf = (k: number) => (index === dayIndex ? (photos[k] ?? null) : null);
    props.face.photo = photoOf(props.face.stopIndex);
    if (props.next) props.next.photo = photoOf(props.next.stopIndex);

    if (!activity.current) {
      const [running, ...extra] = dayLiveActivity.getInstances();
      extra.forEach((a) => void a.end('immediate').catch(() => {}));
      activity.current = running ?? null;
    }
    try {
      if (props.face.kind === 'done' && !props.next) {
        void activity.current?.end('default', props).catch(() => {});
        activity.current = null;
      } else if (activity.current) {
        void activity.current.update(props, staleAt ?? undefined).catch(() => {});
      } else {
        activity.current = dayLiveActivity.start(props, `tripmate://trip/${trip.id}`, staleAt ?? undefined);
      }
    } catch {
      // Live Activities switched off, or an older iOS: the day simply has none.
      activity.current = null;
    }
  }, [day, trip, dayIndex, photos, tick]);
}
