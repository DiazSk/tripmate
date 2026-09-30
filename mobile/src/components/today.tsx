import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { aboutDuration } from '@shared/travelTime';

import { PillButton } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Colors, Curve, Motion, Radius, Spacing } from '@/constants/theme';
import type { DayPlan, SavedPlace, Stop, Trip } from '@/api/types';
import { clockAt, formatDayChip } from '@/lib/dayDisplay';
import { dayLegs, leaveBy } from '@/lib/dayTravel';
import { directionsUrl } from '@/lib/directions';
import { isBlocking, tripHealth } from '@/lib/health';
import { useHere } from '@/lib/here';
import { describeDistance, savedNearby, savedNotInPlan } from '@/lib/savedPlaces';
import { clockInZone, describeGap, nowInZone, todayState } from '@/lib/tripClock';
import { dayIndexFor, tripPhase } from '@/lib/tripPhase';

/**
 * What to do now.
 *
 * The rest of this app answers "what should my week look like". This answers the other question
 * a trip asks, which only starts being asked once the trip begins: it is 10:38 in Lisbon, where
 * am I going and when do I have to leave.
 *
 * **It is a projection, not a new feature.** Every figure here is computed by a function that
 * already existed for the day page — `leaveBy`, `dayLegs`, `tripHealth`, `directionsUrl`. What is
 * new is the selection: one next thing, hoisted, with the rest of the day demoted beneath it.
 * That is why this is its own component rather than a mode on `day-page`. The day page is a list
 * and answers "what is this day"; a list cannot answer "what now" without the reader doing the
 * scanning, which is the entire job.
 *
 * **No clock without a timezone.** `trip.timezone` is null for trips saved before it was stored
 * and for destinations that never geocoded, and the device's own clock is not a substitute —
 * measured, a phone reading 21:07 on Sep 28 is Lisbon 05:07 on Sep *29*, so it gets the wrong
 * day of the itinerary rather than merely the wrong hour. Without a zone this still draws the
 * day, its order and every leave-by, because those come from the stops' own stated times. Only
 * "now" goes quiet. Same contract as Plan Health's "Not checked".
 */

/** The live clock re-reads once a minute. Anything faster is a render nobody can perceive. */
function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

export function Today({
  trip,
  today,
  cachedAt,
  onAsk,
  onOpenTrip,
  onPlanAnother,
  saved,
}: {
  trip: Trip;
  /** Today where the *trip* is when a zone is known, else the device's — see `Home`. */
  today: string;
  /** When this copy was taken, or null when it came from the network. */
  cachedAt: string | null;
  /** Opens Ask already scoped to the day on screen. Absent while offline. */
  onAsk?: (dayIndex: number) => void;
  onOpenTrip: () => void;
  /** Starts the wizard. Rendered beside Ask so the two screen-level actions share one row
   *  rather than stacking into the reading order; Home passes it only while a trip is running. */
  onPlanAnother?: () => void;
  /**
   * Everything this traveller has ever saved, unfiltered — the screen narrows it.
   *
   * Passed in rather than fetched here so Today stays a pure projection of data the host already
   * holds, which is what lets it render identically from the network and from disk.
   */
  saved?: SavedPlace[];
}) {
  useMinuteTick();

  const phase = tripPhase(trip, today);
  if (phase !== 'today' && phase !== 'eve') return null;

  // On the eve the day in question is the first one; there is no "today" index yet.
  const dayIndex = phase === 'today' ? (dayIndexFor(trip, today) ?? 0) : 0;
  const day = trip.itinerary.days[dayIndex];
  if (!day) return null;

  const now = phase === 'today' ? nowInZone(trip.timezone) : null;
  const clock = phase === 'today' ? clockInZone(trip.timezone) : null;

  return (
    <View style={styles.wrap}>
      <Header trip={trip} day={day} phase={phase} clock={clock} onOpenTrip={onOpenTrip} />
      {cachedAt ? <Stale at={cachedAt} /> : null}
      {now === null ? (
        <WholeDay day={day} eve={phase === 'eve'} />
      ) : (
        <NowAndAfter day={day} now={now} saved={saved ?? []} destination={trip.destination} />
      )}
      <Attention trip={trip} dayIndex={dayIndex} cachedAt={cachedAt} />
      {/* **A jade label, not a jade pill, because the hierarchy was inverted.** A full-width
          filled bar made replanning the loudest thing on the screen, while Directions — the
          thing somebody standing in a street actually presses — was a line of text. Replanning
          is the rare case on an execution surface; it needs to be findable, not shouted. So it
          takes the same idiom Directions already uses, and the 44pt target is kept on the
          pressable rather than drawn.
          **On a row, not stacked**: two full-width actions one above the other were simply two
          more rows in the reading order, which is most of why this screen scanned as a list. */}
      <View style={styles.actions}>
        <PillButton
          title={onAsk ? 'Plans changed?' : 'Needs a connection'}
          onPress={onAsk ? () => onAsk(dayIndex) : undefined}
          disabled={!onAsk}
        />
        {onPlanAnother ? <PillButton title="Plan another trip" onPress={onPlanAnother} /> : null}
      </View>
    </View>
  );
}

function Header({
  trip,
  day,
  phase,
  clock,
  onOpenTrip,
}: {
  trip: Trip;
  day: DayPlan;
  phase: 'today' | 'eve';
  clock: string | null;
  onOpenTrip: () => void;
}) {
  const chip = formatDayChip(day.date);
  const date = chip ? `${chip.weekday} ${chip.dayOfMonth}` : null;
  return (
    <Pressable onPress={onOpenTrip} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedText type="label" themeColor="muted">
        {trip.destination.toUpperCase()}
      </ThemedText>
      <ThemedText type="display">{phase === 'eve' ? 'Tomorrow' : 'Today'}</ThemedText>

      {/* **The clock reads down the left edge now, paired with the date.**
          
          It used to sit baseline-locked to the 28pt serif at the far right — the only
          right-aligned element on an otherwise entirely left-aligned screen, which is exactly
          why it read as detached: there was nothing for it to belong to, and the column under it
          was empty. It also had no way of saying *what* it was. A bare time in a corner could be
          a departure, a duration, or the device's own clock.
          
          Beside the date it is unambiguous without needing a label to say so — "Wed 30, 8:26 AM"
          is one fact, and the destination sits directly above it, which is what makes it read as
          *Kyoto's* time rather than the phone's. That distinction is the whole reason
          `tripClock` exists: measured, a device on 21:07 Sep 28 is Lisbon 05:07 Sep **29**.

          Tabular, not the display face: the serif cuts its zero with a bar, so "8:30" renders as
          "8:3Ø" — fine in a headline, wrong in a clock, and wrong beside the stop times set in
          this same face below. Paper rather than jade: it is the most factual thing on the
          screen, and jade here means press me. */}
      <View style={styles.whenRow}>
        {clock ? <ThemedText type="moneyLarge" style={styles.clock}>{clock}</ThemedText> : null}
        {date ? (
          <ThemedText type="label" themeColor="muted">
            {date}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Says which copy this is. A cached screen that does not admit it is worse than no cache. */
function Stale({ at }: { at: string }) {
  const time = clockAt(at);
  return (
    <ThemedText type="detail" themeColor="muted">
      {time ? `Saved copy from ${time} — no connection` : 'Saved copy — no connection'}
    </ThemedText>
  );
}

/**
 * The next thing, hoisted, and everything after it demoted. The whole point of the screen.
 *
 * **What the hoisted thing says depends on how far away it is**, which is the difference between
 * a screen that works at 10:15 and one that works at 6:27. `todayState` decides; this only
 * draws. The departure leads wherever there is one, because on an execution surface the moment
 * you have to go outranks the moment you are due — and where there is none, because the day's
 * first stop has no origin to leave from, the wait is stated instead of a time being invented.
 */
function NowAndAfter({
  day,
  now,
  saved,
  destination,
}: {
  day: DayPlan;
  now: number;
  saved: SavedPlace[];
  destination: string;
}) {
  const stops = day.stops ?? [];
  const state = todayState(stops, now, (i) => leaveBy(stops, i));

  if (state.kind === 'empty' || state.kind === 'done') {
    return (
      <ThemedText type="title" themeColor="muted">
        {state.kind === 'empty' ? 'Nothing planned today' : 'Nothing left today'}
      </ThemedText>
    );
  }

  const { index } = state;
  const stop = stops[index];
  const leg = dayLegs(stops).find((l) => l.toIndex === index);
  const after = stops.slice(index + 1);

  // The facts under the lead, in the order somebody asks for them: when it starts, how far off
  // that is, how long the hop takes. One line, never a stack.
  const beneath = [
    stop.time,
    state.kind === 'upcoming' && !state.leaveBy ? `in ${describeGap(state.minutes)}` : null,
    leg ? `${aboutDuration(`${leg.minutes} min`)} by ${leg.mode}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  /**
   * The lead as a phrase with stress on it.
   *
   * **Speech, not a label and a value.** Said aloud, "leave in" is unstressed and "11 min" is
   * the word that carries — so the verb is set at `muted` and the figure at full tone in the
   * same face and size. That is emphasis by contrast rather than by a second typeface, which is
   * the lesson from the Tabular attempt: the Figure Rule reserves that face for columns, and
   * mixing it mid-sentence broke the phrase into two fragments.
   *
   * `verb` is null where the place itself is the lead and there is nothing to stress against.
   */
  const lead: { verb: string | null; figure: string; tone: 'foreground' | 'alert' } =
    state.kind === 'free'
      ? { verb: 'Free for about', figure: describeGap(state.minutes), tone: 'foreground' }
      : state.kind === 'imminent'
        ? // **"Leave in 0 min" is not a thing anyone says.** `describeGap` is right to return it —
          // it formats a duration and zero is a duration — but at the moment the departure lands
          // the sentence stops being about how long is left and becomes an instruction. Verb
          // only, so the whole phrase carries the alert rather than a nothing-figure beside it.
          state.minutes === 0
          ? { verb: null, figure: 'Leave now', tone: 'alert' as const }
          : { verb: 'Leave in', figure: describeGap(state.minutes), tone: 'alert' as const }
        : state.leaveBy
          ? { verb: 'Leave by', figure: state.leaveBy, tone: 'foreground' }
          : { verb: null, figure: stop.name, tone: 'foreground' };

  return (
    <View style={styles.spine}>

      {/* **One stop back, and only one.**
          
          A day you are halfway through looks identical to one that has not started unless
          something marks the ground covered — but the ground covered is *orientation*, not
          content, and this screen answers "what now". Two past rows pushed the subject down far
          enough that the thing you opened the app for was no longer the thing you saw first.
          
          The one kept is the place you have just come from, which is the only past stop that is
          still context rather than history. The rest of the day — including everything done —
          is the day screen's job. */}
      {index > 0 ? (
        <Node state="past">
          <Row
            time={stops[index - 1].time}
            name={stops[index - 1].name}
            booked={stops[index - 1].timeFlexibility === 'FIXED'}
            dim
          />
        </Node>
      ) : null}

      <Node
        state="now"
        tone={state.kind === 'imminent' ? 'alert' : 'accent'}
        last={after.length === 0}>
        <View style={styles.subjectRow}>
          <View style={styles.subjectText}>
            <Lead verb={lead.verb} figure={lead.figure} tone={lead.tone} />

            {state.kind === 'free' ? (
              <ThemedText type="detail" themeColor="muted">
                {`then ${stop.name}${stop.time ? ` at ${stop.time}` : ''}`}
              </ThemedText>
            ) : // The place, unless the lead already *is* the place. Keyed on the figure, not on
            // the verb: "Leave now" has no verb either, and keying on that hid the destination at
            // the one moment the screen is shouting that you have to go somewhere.
            lead.figure !== stop.name ? (
              <ThemedText type="heading" style={styles.place} numberOfLines={2}>
                {stop.name}
              </ThemedText>
            ) : null}

            {state.kind !== 'free' && beneath ? (
              <ThemedText type="detail" themeColor="muted" style={styles.beneath}>
                {beneath}
              </ThemedText>
            ) : null}
          </View>

        </View>

        {state.kind !== 'free' && (stop.lat !== 0 || stop.lng !== 0) ? (
          <OpenIn label="Directions" to={stop} name={stop.name} />
        ) : null}

        {state.kind === 'free' ? (
          <SavedNearby saved={saved} planned={stops} destination={destination} from={stops[index]} />
        ) : null}
      </Node>

      {/* No "After" opener: the rail already says these come next, and an uppercase word saying
          so on top of a geometry that says it is the furniture this pass exists to remove. */}
      {after.map((s, i) => (
        <Node
          key={`${s.name}-${i}`}
          state="ahead"
          last={i === after.length - 1}>
          <Row time={s.time} name={s.name} booked={s.timeFlexibility === 'FIXED'} />
        </Node>
      ))}
    </View>
  );
}

/**
 * A control that hands off to the maps app, and says so.
 *
 * **A tap that does nothing used to look exactly like a tap that worked.** Both of this screen's
 * hand-offs were `Linking.openURL(...).catch(() => {})` — the swallow is correct in that a
 * missing maps app must not throw, but it left the one case worth reporting silent: press
 * Directions on a device where nothing handles the URL and the screen simply does not react.
 *
 * So the press has three states and each is legible. Working: the label dims and the app
 * leaves, which is the platform's own confirmation and needs nothing added. Slow: `Opening…`
 * after the press, so the gap between tap and hand-off is accounted for. Failed: `Can't open
 * Maps`, in the colour this system reserves for *cannot happen*, held briefly and then gone —
 * an error you cannot dismiss on a screen you are reading in a street is worse than the failure.
 *
 * The label reverts on its own rather than latching, because by the time it has failed the
 * traveller has usually already pressed again.
 */
function OpenIn({
  label,
  to,
  name,
  inline,
  style,
}: {
  label: string;
  to: { lat: number; lng: number };
  name: string;
  /** A row action, which stays text. Standalone actions get the capsule instead. */
  inline?: boolean;
  style?: object;
}) {
  const [said, setSaid] = useState<'idle' | 'opening' | 'failed'>('idle');

  async function open() {
    setSaid('opening');
    try {
      await Linking.openURL(directionsUrl(to));
      setSaid('idle');
    } catch {
      setSaid('failed');
      setTimeout(() => setSaid('idle'), 2600);
    }
  }

  return (
    <Pressable
      onPress={open}
      disabled={said === 'opening'}
      accessibilityRole="link"
      accessibilityLabel={`Directions to ${name}`}
      hitSlop={8}
      style={({ pressed }) => [inline ? styles.inlineAction : styles.leadAction, style, pressed && styles.pressed]}>
      {/* **Sentence case, never tracked caps.** The uppercase, letter-spaced treatment these
          actions shipped with is a web link wearing a label's clothes: on iOS a fluent reader
          takes tracked caps for a heading and does not know it is pressable. A tinted text button
          *is* native — it is what a nav bar's Edit and Done are — so what had to go was the
          casing and the 0.18em, not the control. A standalone action goes further and takes a
          capsule; see `PillButton`. */}
      <ThemedText
        type={inline ? 'detail' : 'headingSmall'}
        themeColor={said === 'failed' ? 'alert' : said === 'opening' ? 'muted' : 'accent'}>
        {said === 'failed' ? "Can't open Maps" : said === 'opening' ? 'Opening…' : label}
      </ThemedText>
    </Pressable>
  );
}

/**
 * The lead line, and the screen's one authored moment.
 *
 * **Today is the only surface here that changes while you watch it**, and it used to change by
 * snapping: "Leave in 11 min" became "Leave in 10 min" between one frame and the next, and the
 * flip from `upcoming` to `imminent` repainted the whole phrase coral with no acknowledgement
 * that anything had happened. Both are the screen's most important events and both were silent.
 *
 * So the figure re-settles whenever its value changes — keyed on the text, so the entrance plays
 * on the tick and on the state flip alike, and on nothing else. One moment, not an effect per
 * element: the verb beside it never moves, which is what makes the figure look like the thing
 * that changed.
 *
 * `Motion.respond` and the house curve, because this is the screen answering time passing rather
 * than something arriving. **Reduced Motion drops the travel and keeps the fade** — the event is
 * still worth marking for somebody who has asked for less movement, and a crossfade marks it.
 *
 * **The text is always mounted and the animation only decorates it**, which is the second
 * version of this. The first keyed an `Animated.View` on the figure and let `entering` play on
 * the remount — shorter, and it deletes the number when the animation does not run. Caught in
 * the browser: reanimated's web path left the wrapper at `visibility: hidden; position:
 * absolute` with the keyframes never starting, so the screen said "Leave in" and nothing else.
 * Web is not the target and that exact failure will not happen on the device — but a countdown
 * that can render blank is the worst failure this screen has, and a design where the motion is
 * additive cannot produce it on any platform.
 */
function Lead({
  verb,
  figure,
  tone,
}: {
  verb: string | null;
  figure: string;
  tone: 'foreground' | 'alert';
}) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  const shift = useSharedValue(0);

  useEffect(() => {
    const easing = Easing.bezier(...Curve);
    opacity.value = 0.25;
    opacity.value = withTiming(1, { duration: Motion.respond, easing });
    if (!reduceMotion) {
      shift.value = -5;
      shift.value = withTiming(0, { duration: Motion.respond, easing });
    }
    // `figure` only: the verb does not move, which is what makes the number look like the thing
    // that changed rather than the whole line repainting.
  }, [figure, reduceMotion, opacity, shift]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: shift.value }],
  }));

  return (
    <View style={styles.leadLine}>
      {verb ? (
        <ThemedText type="title" style={styles.lead} themeColor="muted">
          {verb}
        </ThemedText>
      ) : null}
      <Animated.View style={style}>
        <ThemedText type="title" style={styles.lead} themeColor={tone} numberOfLines={2}>
          {figure}
        </ThemedText>
      </Animated.View>
    </View>
  );
}

/**
 * One position on the day's rail.
 *
 * The dot carries its own canvas-coloured ring so the rule passes behind it rather than through
 * it, which is what makes the line read as continuous and the node as sitting *on* it.
 */
function Node({
  state,
  tone = 'accent',
  last,
  children,
}: {
  state: 'past' | 'now' | 'ahead';
  tone?: 'accent' | 'alert';
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.node, last && styles.nodeLast]}>
      <View style={styles.gutter}>
        <View
          style={[
            styles.dot,
            state === 'now' && styles.dotNow,
            state === 'now' && tone === 'alert' && styles.dotAlert,
            state === 'past' && styles.dotPast,
          ]}
        />
      </View>
      <View style={styles.nodeBody}>{children}</View>
    </View>
  );
}


/**
 * The places this traveller saved for this city that the plan never used.
 *
 * **Only in the free state, and only their own list.** The reviewer's rule for the silence
 * between stops was that the answer is temporal context, not content — and a feed of
 * recommendations is exactly the content they meant. This is not that: every row is somewhere
 * this person deliberately saved, for this city, which the planner left out. The app already
 * offers these once in the wizard and then never mentions them again, so a place someone
 * screenshotted for Lisbon is invisible on the Lisbon trip it was saved for.
 *
 * Ranked from the **next stop** rather than from the device, because there is no device
 * location in this app and asking for one would be the wrong trade on a screen built to work in
 * a tunnel. It is also the better anchor: in a three-hour gap before Belém Tower, what is near
 * Belém Tower is more use than what is near the café you are sitting in.
 *
 * Three rows. The list is a nudge toward something already on their own list, and a fourth row
 * turns that into a feed to scroll — which is the thing this is deliberately not.
 */
const SAVED_SHOWN = 3;

function SavedNearby({
  saved,
  planned,
  destination,
  from,
}: {
  saved: SavedPlace[];
  planned: { name: string }[];
  destination: string;
  from: Stop | undefined;
}) {
  const { here, canAsk, busy, ask } = useHere();
  const unused = savedNotInPlan(saved, planned, destination);
  if (unused.length === 0) return null;

  // A stop at 0,0 is the app's "nowhere known" and must not anchor a distance — every saved
  // place would read as ~5,000 km from the Gulf of Guinea.
  const stopAnchor = from && (from.lat !== 0 || from.lng !== 0) ? { lat: from.lat, lng: from.lng } : null;
  // **Where you are beats where you are going, and only when it is actually known.** The next
  // stop was never the ideal anchor — it was the honest one while this app could not ask. With a
  // fix in hand the question becomes the one somebody standing in a street is really asking, and
  // without one nothing changes: `here` is null for a denial, a refusal, a timeout, a simulator
  // with no location set, and a build with no native module, and every one of those keeps the
  // ranking this screen already shipped with.
  const anchor = here ?? stopAnchor;
  const near = savedNearby(unused, anchor).slice(0, SAVED_SHOWN);

  return (
    <View style={styles.block}>
      <View style={[styles.row, styles.sectionLabel]}>
        <ThemedText type="label" themeColor="muted" style={styles.grow}>
          {here ? 'You saved these — near you' : 'You saved these'}
        </ThemedText>
        {/* Offered rather than demanded, and only where a prompt would really appear. The system
            dialog is answered once and for all, so asking before the list it improves is on
            screen would spend that one answer on a screen nobody had read yet. */}
        {canAsk ? (
          <Pressable
            onPress={ask}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Sort these by how near you are"
            hitSlop={8}
            style={({ pressed }) => [styles.firm, pressed && styles.pressed]}>
            <ThemedText type="label" themeColor={busy ? 'muted' : 'accent'}>
              {busy ? 'Locating…' : 'Near me'}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {near.map(({ place, metres }) => {
        const away = describeDistance(metres);
        return (
          <View key={place.id} style={styles.row}>
            <ThemedText type="detail" style={styles.grow} numberOfLines={1}>
              {place.name}
            </ThemedText>
            {/* The distance is stated where it is known and simply absent where it is not — a
                saved place with no coordinates is still theirs, and "—" would read as zero. */}
            {away ? (
              <ThemedText type="micro" themeColor="muted" style={styles.firm}>
                {away}
              </ThemedText>
            ) : null}
            {typeof place.lat === 'number' && typeof place.lng === 'number' ? (
              <OpenIn
                label="Go"
                to={{ lat: place.lat, lng: place.lng }}
                name={place.name}
                inline
                style={styles.firm}
              />
            ) : null}
          </View>
        );
      })}
      {/* Said once, because the count is the part that makes the three rows honest: this is a
          sample of their pile, not the whole of it. */}
      {unused.length > SAVED_SHOWN ? (
        <ThemedText type="detail" themeColor="muted">
          {`and ${unused.length - SAVED_SHOWN} more saved for ${destination.split(',')[0].trim()}`}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * The day with no "now" in it — the eve, or a trip with no timezone on record.
 *
 * Still worth drawing in full: the times, the order and the leave-bys are all properties of the
 * plan rather than of the clock, so none of them is unknown just because the hour is.
 */
function WholeDay({ day, eve }: { day: DayPlan; eve: boolean }) {
  const stops = day.stops ?? [];
  return (
    <View style={styles.block}>
      <ThemedText type="label" themeColor="muted">
        {eve ? 'Starts with' : 'The day'}
      </ThemedText>
      {stops.length === 0 ? (
        <ThemedText type="detail" themeColor="muted">
          This day has no stops.
        </ThemedText>
      ) : (
        stops.map((s, i) => <Row key={`${s.name}-${i}`} time={s.time} name={s.name} booked={s.timeFlexibility === 'FIXED'} />)
      )}
    </View>
  );
}

function Row({
  time,
  name,
  booked,
  dim,
}: {
  time?: string;
  name: string;
  booked?: boolean;
  /** Behind you. Stated at a lower contrast rather than removed — it is orientation, not noise. */
  dim?: boolean;
}) {
  return (
    <View style={[styles.row, dim && styles.rowDim]}>
      <ThemedText type="money" themeColor="muted" style={styles.time}>
        {time ?? ''}
      </ThemedText>
      {/* Booked is stated rather than implied: it is the one thing on this screen nothing may
          move, and on the eve it is the reason to read the row at all.
          **It sits against the name, not at the far margin.** Right-aligned, it drifted a whole
          phone-width away from the thing it qualifies, and on a list where only some rows carry
          it the reader had to track back across empty space to find out which. The name shrinks
          to make room, so a long one truncates rather than pushing the badge off the row. */}
      <View style={styles.named}>
        <ThemedText type="detail" numberOfLines={1} style={styles.shrink}>
          {name}
        </ThemedText>
        {booked ? (
          <ThemedText type="micro" themeColor="muted" style={styles.firm}>
            BOOKED
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Only what stops today working, and only for today.
 *
 * `tripHealth` returns findings across the whole trip; a conflict on day 5 is not something to
 * act on this morning. Filtered to blocking findings on this day, so the section is empty far
 * more often than not — which is the point. A heading that is always there stops being read.
 */
function Attention({
  trip,
  dayIndex,
  cachedAt,
}: {
  trip: Trip;
  dayIndex: number;
  cachedAt: string | null;
}) {
  const findings = tripHealth(trip)
    .dimensions.flatMap((d) => d.findings)
    .filter((f) => isBlocking(f) && f.dayIndex === dayIndex);

  const rain = trip.itinerary.days[dayIndex]?.weatherDetail?.precipitationProbability ?? null;
  const wet = rain !== null && rain >= 50;
  if (findings.length === 0 && !wet) return null;

  return (
    <View style={styles.block}>
      <ThemedText type="label" themeColor="alert" style={styles.sectionLabel}>
        Needs attention
      </ThemedText>
      {findings.map((f, i) => (
        <ThemedText key={`${f.message}-${i}`} type="detail" themeColor="muted">
          {f.message}
        </ThemedText>
      ))}
      {/* **A cached forecast changes tense; a cached itinerary does not.** A 10:30 stop read
          from disk is still a 10:30 stop, so those lines stand as written. A forecast read from
          disk is a forecast that was true when it was taken, and weather is the one thing here
          that ages inside an afternoon. The banner above says the screen is a copy; this says
          what that means for the only claim on it that decays. */}
      {wet ? (
        <ThemedText type="detail" themeColor="muted">
          {cachedAt
            ? `Rain was forecast today — ${rain}%${clockAt(cachedAt) ? `, as of ${clockAt(cachedAt)}` : ''}.`
            : `Rain likely today — ${rain}% chance.`}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** The marker column. Wide enough for the dot and the air it needs, and nothing more. */
const RAIL_GUTTER = 22;
/**
 * Dot geometry, and the one offset that centres both sizes on the text beside them.
 *
 * **9.5 for each, and the arithmetic is why.** A past or future dot sits against a `Row`, whose
 * `minHeight` of 28 puts its text's optical centre at 14: `14 - 9/2 = 9.5`. The current dot sits
 * against the lead, a 30pt line whose centre is 15: `15 - 11/2 = 9.5`. The two dots are
 * different sizes against different type and land on the same number, so there is one constant
 * rather than a pair to keep in step.
 *
 * It is a marker, not a glyph, so it does not scale with Dynamic Type — at the accessibility
 * sizes the text grows past it and the dot rides high. Acceptable for a mark whose only job is
 * to say which of three states a row is in.
 */
const DOT = 9;
const DOT_NOW = 11;
const DOT_TOP = 9.5;

const styles = StyleSheet.create({
  /**
   * **Cadence, not one interval repeated.** Every block on this screen used to be separated by
   * `Spacing.rows` and joined internally by `Spacing.hair` — 12 against 4, a ratio too shallow to
   * group anything, so five blocks read as five equal rows. The satellites keep 12; the subject
   * is set apart by `Spacing.regular` and a rule, which is what makes the squint test resolve.
   */
  wrap: { gap: Spacing.rows },
  /**
   * The day as one line with positions on it.
   *
   * The screen's three groups — what is behind, what is now, what is next — used to be three
   * unrelated stacks, and nothing said they were one day. The rail is what says it, and it lets
   * the "After" opener go: a geometry that already means "these come next" does not need an
   * uppercase word repeating it.
   */
  spine: { position: 'relative' },
  /** Drawn once behind every node; see the note at its use for why not per row. */
  node: { flexDirection: 'row', paddingBottom: Spacing.regular },
  subjectRow: { flexDirection: 'row', gap: Spacing.rows, alignItems: 'flex-start' },
  subjectText: { flex: 1, gap: Spacing.hair },
  /** The verb and the figure on one line, wrapping together at accessibility sizes. */
  leadLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 },
  nodeLast: { paddingBottom: 0 },
  gutter: { width: RAIL_GUTTER, alignItems: 'center' },
  nodeBody: { flex: 1, gap: Spacing.hair },
  /**
   * The ring is the canvas, not a colour of its own, so the rail passes *behind* the dot instead
   * of through it. Without it the hairline cuts every node in half and the column reads as a
   * dotted line rather than as positions on a continuous one.
   */
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: Radius.pill,
    backgroundColor: Colors.canvas,
    borderWidth: 1.5,
    borderColor: Colors.cardBorder,
    marginTop: DOT_TOP,
  },
  dotNow: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
    width: DOT_NOW,
    height: DOT_NOW,
  },
  dotAlert: { backgroundColor: Colors.alert, borderColor: Colors.alert },
  /**
   * **Opaque, and that is the whole point.**
   *
   * This was filled with `cardBorder` — `#FFFFFF1F`, 12% white, the same token the rail uses.
   * A translucent fill does not occlude: the rail passed *through* it and the two alphas
   * composited, so the line read as a bright streak across the one dot it crossed. Every other
   * dot hid the rail correctly because `canvas`, `accent` and `alert` are all solid.
   *
   * `surfaceDeep` is the One Slate one step up from the ground, so a completed stop reads as a
   * filled node against the hollow ring of one still ahead, and the rail stops at its edge.
   */
  dotPast: { backgroundColor: Colors.surfaceDeep, borderColor: Colors.cardBorder },
  rowDim: { opacity: 0.55 },
  /**
   * A size the shared ramp does not carry, declared here on purpose.
   *
   * `title` (22) is the step below and does not read at arm's length in a street; `display` (28)
   * is the step above and is Melodrama, which bars its zero — every line this style sets contains
   * digits. So: the text face at 26, which puts a 1.5x step over the place name under it instead
   * of `title`'s 1.29x. `fontWeight` is safe here because Switzer ships real cuts; the comment on
   * `display` in themed-text.tsx applies only to the bundled single-cut families.
   */
  lead: { fontSize: 26, lineHeight: 30, letterSpacing: -0.4, fontWeight: '600' },
  place: { marginTop: 2 },
  /**
   * More room above a section opener than below it.
   *
   * Every group here sat 12 below the previous one and 4 above its own first row, which is the
   * ratio inverted — so two muted lists running back to back ("and 1 more saved for Kyoto"
   * directly over "AFTER") read as one continuous column. 20 above against 4 below is what tells
   * the eye a new group started.
   */
  sectionLabel: { marginTop: Spacing.tight },
  beneath: { marginTop: Spacing.hair },
  leadAction: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.compact,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceDeep,
    marginTop: Spacing.hair,
  },
  /** A row's own action. Text, because three capsules down a list is heavier than the list. */
  inlineAction: { minHeight: 28, justifyContent: 'center' },
  /**
   * The two screen-level actions, on one row at the foot rather than stacked into the reading
   * order as two more list items.
   *
   * `Spacing.tight` between them, not `regular`: they are capsules now, and a filled shape
   * carries its own separation — the generous gap was holding apart two lines of text that had
   * no edges of their own. `Spacing.read` above, so the row sits clear of the attention block
   * without the void that opened up when two text links floated in it.
   */
  actions: { flexDirection: 'row', gap: Spacing.tight, marginTop: Spacing.read, flexWrap: 'wrap' },
  /** Time and date on one baseline, the pair reading as a single "when it is now, there". */
  whenRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.rows, marginTop: 2 },
  /**
   * 22, against `moneyLarge`'s 15.
   *
   * The second most useful fact on an execution surface was set two steps below the place names
   * under it. It does not go higher: at 26 it would tie the lead, and the countdown has to win.
   */
  clock: { fontSize: 22, lineHeight: 26 },
  grow: { flex: 1 },
  block: { gap: Spacing.hair },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.rows, minHeight: 28 },
  // A fixed column so the names line up into something scannable rather than ragged.
  time: { width: 76 },
  named: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },
  shrink: { flexShrink: 1 },
  // The name yields, never the badge. Both default to shrinking, and a six-letter label clipped
  // to "BOOK" at an accessibility size says nothing — where a truncated place name still does.
  firm: { flexShrink: 0 },
  pressed: { opacity: 0.6 },
});
