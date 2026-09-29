import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
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
        <Pressable
          onPress={onAsk ? () => onAsk(dayIndex) : undefined}
          disabled={!onAsk}
          accessibilityRole="button"
          accessibilityState={{ disabled: !onAsk }}
          style={({ pressed }) => [styles.ask, pressed && styles.pressed]}>
          <ThemedText type="label" themeColor={onAsk ? 'accent' : 'muted'}>
            {onAsk ? 'Plans changed?' : 'Plans changed? — offline'}
          </ThemedText>
        </Pressable>
        {onPlanAnother ? (
          <Pressable
            onPress={onPlanAnother}
            accessibilityRole="button"
            style={({ pressed }) => [styles.ask, pressed && styles.pressed]}>
            <ThemedText type="label" themeColor="accent">
              Plan another trip
            </ThemedText>
          </Pressable>
        ) : null}
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
  return (
    <Pressable onPress={onOpenTrip} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedText type="label" themeColor="muted">
        {trip.destination.toUpperCase()}
      </ThemedText>
      <View style={styles.headRow}>
        <ThemedText type="display" style={styles.grow}>
          {phase === 'eve' ? 'Tomorrow' : 'Today'}
        </ThemedText>
        {/* Tabular figures, not the display face. The serif display cuts its zero with a bar, so
            "5:30 AM" renders as "5:3Ø AM" — fine in a headline, wrong in a clock, and wrong
            beside stop times set in this same tabular face. Paper rather than jade: it is the
            most factual thing on the screen, and jade in this product means press me. */}
        {clock ? <ThemedText type="moneyLarge">{clock}</ThemedText> : null}
      </View>
      {chip ? (
        <ThemedText type="label" themeColor="muted">
          {`${chip.weekday} ${chip.dayOfMonth}`}
        </ThemedText>
      ) : null}
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
      <View style={styles.subject}>
        <ThemedText type="title" themeColor="muted">
          {state.kind === 'empty' ? 'Nothing planned today' : 'Nothing left today'}
        </ThemedText>
      </View>
    );
  }

  const { index } = state;
  const stop = stops[index];
  const leg = dayLegs(stops).find((l) => l.toIndex === index);
  const after = stops.slice(index + 1);

  // The facts under the lead, in the order somebody asks for them: when it starts, how far off
  // that is, how long the hop takes. One line, never a stack — two muted 13pt lines under each
  // other is the list shape this whole pass removes, and the first-stop branch had exactly that
  // ("in 45 min" over "8:11 AM") until it was looked at on the device.
  //
  // `leaveBy` is deliberately absent: it is the lead in every state that has one, and repeating
  // it here is what made the old block read as four near-identical rows.
  const beneath = [
    stop.time,
    // Only where the lead is the place itself; every other lead already carries the wait.
    state.kind === 'upcoming' && !state.leaveBy ? `in ${describeGap(state.minutes)}` : null,
    leg ? `${leg.minutes} min by ${leg.mode}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <>
      <View style={styles.subject}>
        {/* **One subject, stated as a sentence.** This block used to be an uppercase opener above a
            place, a departure and a detail line — four rows of near-equal weight, which is the
            "reads like a list" the redesign was asked to fix. The lead is now a single phrase
            with its figure set in the tabular face, and the opener is gone: the screen's entire
            job is that this is the next thing, so a word saying so is furniture. */}
        {state.kind === 'free' ? (
          <>
            <Lead tone="foreground" text={`Free for about ${describeGap(state.minutes)}`} />
            <ThemedText type="detail" themeColor="muted">
              {`then ${stop.name}${stop.time ? ` at ${stop.time}` : ''}`}
            </ThemedText>
          </>
        ) : state.kind === 'imminent' ? (
          <>
            <Lead tone="alert" text={`Leave in ${describeGap(state.minutes)}`} />
            <ThemedText type="heading" style={styles.place} numberOfLines={2}>
              {stop.name}
            </ThemedText>
          </>
        ) : state.leaveBy ? (
          <>
            <Lead tone="foreground" text={`Leave by ${state.leaveBy}`} />
            <ThemedText type="heading" style={styles.place} numberOfLines={2}>
              {stop.name}
            </ThemedText>
          </>
        ) : (
          // The day's first stop has no origin, so there is no departure to lead with and the
          // place itself is the subject — at the lead size, because this state otherwise had no
          // glance-distance line at all. See `todayState` for why a departure is never invented.
          <ThemedText type="title" style={styles.lead} numberOfLines={2}>
            {stop.name}
          </ThemedText>
        )}

        {state.kind !== 'free' && beneath ? (
          <ThemedText type="detail" themeColor="muted" style={styles.beneath}>
            {beneath}
          </ThemedText>
        ) : null}

        {state.kind !== 'free' && (stop.lat !== 0 || stop.lng !== 0) ? (
          <Pressable
            onPress={() => Linking.openURL(directionsUrl(stop)).catch(() => {})}
            accessibilityRole="link"
            accessibilityLabel={`Directions to ${stop.name}`}
            hitSlop={8}
            style={({ pressed }) => [styles.leadAction, pressed && styles.pressed]}>
            <ThemedText type="label" themeColor="accent">
              Directions
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {state.kind === 'free' ? (
        <SavedNearby saved={saved} planned={stops} destination={destination} from={stops[index]} />
      ) : null}

      {after.length > 0 ? (
        <View style={styles.block}>
          <ThemedText type="label" themeColor="muted" style={styles.sectionLabel}>
            After
          </ThemedText>
          {after.map((s, i) => (
            <Row
              key={`${s.name}-${i}`}
              time={s.time}
              name={s.name}
              booked={s.timeFlexibility === 'FIXED'}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

/**
 * The screen's lead line — one phrase, one face, at glance distance.
 *
 * **A sentence, not a labelled metric.** "LEAVE IN" over a big "10 min" is the hero-metric
 * template, and it needs an uppercase opener to work: two things this system does not do.
 *
 * **And not a mixed-face one either, which is what this tried first.** Setting the figure in
 * Tabular a size up looked right in the editor and was wrong on the device twice over. It breaks
 * the Figure Rule — that face is for values compared *in a column*, and DESIGN.md names this
 * exact shape as the counter-example ("a stamp is not a column; `DAY 2 OF 5` has two numerals and
 * nothing to align them against"). And it shows: mono advances put a visible gap between "10" and
 * "min", so the phrase read as two fragments rather than one sentence.
 *
 * So the emphasis is size, which is what the craft floor asks for anyway. Switzer rather than the
 * display serif because every one of these lines carries digits, and Melodrama bars its zero —
 * "10:30" renders as "1Ø:3Ø", the same defect that moved the header clock off the serif.
 */
function Lead({ text, tone }: { text: string; tone: 'foreground' | 'alert' }) {
  return (
    <ThemedText type="title" themeColor={tone} style={styles.lead} numberOfLines={2}>
      {text}
    </ThemedText>
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
              <Pressable
                onPress={() =>
                  Linking.openURL(directionsUrl({ lat: place.lat!, lng: place.lng! })).catch(() => {})
                }
                accessibilityRole="link"
                accessibilityLabel={`Directions to ${place.name}`}
                hitSlop={8}
                style={({ pressed }) => [styles.firm, pressed && styles.pressed]}>
                <ThemedText type="label" themeColor="accent">
                  Go
                </ThemedText>
              </Pressable>
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

function Row({ time, name, booked }: { time?: string; name: string; booked?: boolean }) {
  return (
    <View style={styles.row}>
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

const styles = StyleSheet.create({
  /**
   * **Cadence, not one interval repeated.** Every block on this screen used to be separated by
   * `Spacing.rows` and joined internally by `Spacing.hair` — 12 against 4, a ratio too shallow to
   * group anything, so five blocks read as five equal rows. The satellites keep 12; the subject
   * is set apart by `Spacing.regular` and a rule, which is what makes the squint test resolve.
   */
  wrap: { gap: Spacing.rows },
  /** The one thing this screen exists to answer. Its own air, and a rule under it. */
  subject: {
    gap: Spacing.hair,
    // `Spacing.tight`, not `regular`: the Directions target below is 44pt tall against ~19pt of
    // text, so it contributes its own trailing air. Measured on the device, 24 on top of that
    // opened a void between the subject and its rule.
    paddingBottom: Spacing.tight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.cardBorder,
  },
  // A rule and space, never a card: "round what you touch, square what you read", and this is
  // read. A filled panel here would also be the second surface on a screen that has one.
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
  leadAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  /** The two screen-level actions, on one row at the foot instead of stacked into the reading
   *  order as two more list items. Separated generously so neither catches the other's press. */
  actions: { flexDirection: 'row', gap: Spacing.regular, marginTop: Spacing.tight, flexWrap: 'wrap' },
  headRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.tight },
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
  // The target is 44pt tall and only as wide as the words — a full-width tap zone on a screen
  // this dense catches presses meant for the day beneath it.
  ask: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  pressed: { opacity: 0.6 },
});
