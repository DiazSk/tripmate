import { groupStopsByTimeOfDay } from '@shared/timeOfDay';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { DayPlan, Stop } from '@/api/types';
import { PlacePhoto } from '@/components/place-photo';
import { TravelSegment } from '@/components/travel-segment';
import { SpendBreakdown } from '@/components/spend-breakdown';
import { StopDisc } from '@/components/stop-disc';
import { ThemedText } from '@/components/themed-text';
import { Colors, PhotoScrim, Radius, Spacing, dayCore } from '@/constants/theme';
import { formatDateline } from '@/lib/dayDisplay';
import { directionsUrl } from '@/lib/directions';
import { fixMessage, isBlocking, type Guardrail } from '@/lib/health';
import { daySpend, formatMoney } from '@/lib/spend';

/**
 * One day of a trip, read as a page.
 *
 * **A day owns its own scroll.** The screen pages horizontally between days, so each day is a
 * column of its own rather than a section of one long list. A plain `ScrollView` over `.map()`
 * rather than a list: a day is four to eight stops, virtualising that is ceremony, and it keeps a
 * vertical scroller from nesting inside the horizontal pager on the same axis.
 */
export function DayPage({
  day,
  dayIndex,
  dayCount,
  destination,
  emphasis,
  onEmphasise,
  onFindNearby,
  findings,
  onToggleLock,
  onAsk,
}: {
  day: DayPlan;
  dayIndex: number;
  dayCount: number;
  /** Names the masthead photograph — see DayMasthead for why it is not the day's own stop. */
  destination: string;
  /** Index of the emphasised stop within this day, or null. */
  emphasis: number | null;
  onEmphasise: (index: number | null) => void;
  /** "What else is near this stop" — the anchored replacement for pressing open map. */
  onFindNearby: (stop: Stop) => void;
  /**
   * This day's guardrail findings, in `stops`-array indices.
   *
   * Passed in rather than computed here, and that is the point: the trip screen evaluates the
   * whole plan once and hands each day its slice, so the coral line on a row and the figure in the
   * health panel above it are literally the same object. Two surfaces computing the same verdict
   * separately is how they start disagreeing.
   */
  findings: Guardrail[];
  /** Flip a stop between booked and ordinary. Booked is §0 rank 1 — the plan is re-planned around
   *  it and the server's applier refuses to move it. */
  onToggleLock: (stopIndex: number) => void;
  /** Opens the chat composer seeded with text. Never sends it. */
  onAsk: (message: string) => void;
}) {
  const stops = day.stops ?? [];
  /**
   * The day, cut into Morning / Afternoon / Evening.
   *
   * The grouping is imported rather than written here: it never reorders the day, an untimed stop
   * joins the group in progress, and — the part that matters most — each entry keeps its **index
   * in the day's own `stops` array**, which is the currency `emphasis`, `onEmphasise` and the map
   * camera all speak in. Regrouping with fresh indices would light up the wrong row.
   */
  const groups = groupStopsByTimeOfDay(stops);
  /**
   * A day with one heading is a heading that says nothing — it labels the whole list it sits on.
   * Both the web and the Swift app suppress it on the same test, and a day whose stops carry no
   * readable clock time comes back as a single unlabelled group, so it reads exactly as before.
   */
  const showHeadings = groups.length > 1;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <DayMasthead day={day} dayIndex={dayIndex} dayCount={dayCount} destination={destination} />

      {groups.map((group, groupIndex) => (
        <View key={group.label ?? `group-${groupIndex}`}>
          {showHeadings && group.label ? (
            <View style={styles.slot}>
              <SectionRule label={group.label} />
            </View>
          ) : null}
          {group.stops.map((entry, indexInGroup) => (
            <View key={`${entry.stop.name}-${entry.index}`}>
              {/* Only WITHIN a group, never across a heading. A leg spanning Morning to Afternoon
                  is the day's long gap, where the minutes say least, and a segment drawn under a
                  fresh heading reads as belonging to the heading rather than to the two stops. */}
              {indexInGroup > 0 ? (
                <TravelSegment from={group.stops[indexInGroup - 1].stop} to={entry.stop} />
              ) : null}
              <StopRow
                stop={entry.stop}
                // The day's own numbering, not the group's — the stops stay 1..n down the page and
                // keep agreeing with the numbered discs on the map.
                ordinal={entry.index + 1}
                dayIndex={dayIndex}
                // First *in its group*, not in the day: `first` suppresses the row's top hairline,
                // and without this every heading would be followed immediately by a second rule.
                first={indexInGroup === 0}
                expanded={emphasis === entry.index}
                findings={findings.filter((f) => f.stopIndex === entry.index)}
                onPress={() => onEmphasise(emphasis === entry.index ? null : entry.index)}
                onFindNearby={() => onFindNearby(entry.stop)}
                onToggleLock={() => onToggleLock(entry.index)}
                onAsk={onAsk}
              />
            </View>
          ))}
        </View>
      ))}

      {day.lodging ? (
        <View style={styles.lodging}>
          <SectionRule label="Stay" />
          <View style={styles.lodgingRow}>
            <View style={styles.grow}>
              <ThemedText type="heading">{day.lodging.name}</ThemedText>
              {day.lodging.note ? (
                <ThemedText type="detail" themeColor="muted">
                  {day.lodging.note}
                </ThemedText>
              ) : null}
            </View>
            <Cost amount={day.lodging.cost} />
          </View>
        </View>
      ) : null}

      <SpendBreakdown day={day} dayIndex={dayIndex} />
    </ScrollView>
  );
}

/**
 * The day's masthead: a photograph with the measured scrim, the dateline set into it.
 *
 * Only large type and tracked caps ride the picture — the Photograph-Is-Not-A-Surface rule. The
 * weather badge is a slate pill rather than bare text for the same reason: small type over a
 * photograph is only apparently safe.
 *
 * **The photograph is the destination's, and a per-day one was tried and measured away.** Paging
 * days made the repeated picture look inert — swipe, and the largest thing on screen does not
 * move — so the masthead was switched to the day's first stop. Then the hit rate was measured
 * across every saved trip: **2 of 14 days**. Not close, and not random. The model names stops the
 * way a person would say them rather than the way an encyclopaedia titles them ("Fushimi Inari"
 * against "Fushimi Inari-taisha"), and a day's first stop is very often transit or a meal — "Tram
 * 15E to Belém", "Breakfast at Manteigaria" — which will never have an article. Widening to *any*
 * stop in the day scored identically: 12 of 14 days have no photograph for any stop they name.
 *
 * So the destination photograph stays, because it is the one that actually resolves. What changes
 * on a swipe is the dateline, the overline, the day chip, the summary and every row beneath.
 */
function DayMasthead({
  day,
  dayIndex,
  dayCount,
  destination,
}: {
  day: DayPlan;
  dayIndex: number;
  dayCount: number;
  destination: string;
}) {
  const weather = weatherLine(day);
  return (
    <View style={styles.masthead}>
      <PlacePhoto
        name={destination}
        aspectRatio={16 / 9}
        radius={Radius.read}
        scrim={PhotoScrim}
        style={styles.mastheadPhoto}>
        {weather ? (
          <View style={styles.weatherBadge}>
            <ThemedText type="label" themeColor="foreground" numberOfLines={1}>
              {weather}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.dateline}>
          <ThemedText type="label" themeColor="foreground" style={styles.datelineOverline}>
            {`Day ${dayIndex + 1} of ${dayCount}`}
          </ThemedText>
          <ThemedText type="display" numberOfLines={2}>
            {formatDateline(day.date)}
          </ThemedText>
          {day.title ? (
            <ThemedText type="detail" style={styles.datelineTitle}>
              {day.title}
            </ThemedText>
          ) : null}
        </View>
      </PlacePhoto>

      {day.theme ? (
        <ThemedText type="heading" style={styles.theme}>
          {day.theme}
        </ThemedText>
      ) : null}

      {day.summary ? (
        <ThemedText type="detail" themeColor="muted" style={styles.summary}>
          {day.summary}
        </ThemedText>
      ) : null}

      <SectionRule label="The day" trailing={dayTotal(day)} />
    </View>
  );
}

/** A stop is a row, never a card. The system draws rules rather than boxing things. */
function StopRow({
  stop,
  ordinal,
  dayIndex,
  first,
  expanded,
  findings,
  onPress,
  onFindNearby,
  onToggleLock,
  onAsk,
}: {
  stop: Stop;
  ordinal: number;
  dayIndex: number;
  first: boolean;
  expanded: boolean;
  /** This stop's own findings — already filtered to `stopIndex`. */
  findings: Guardrail[];
  onPress: () => void;
  onFindNearby: () => void;
  onToggleLock: () => void;
  onAsk: (message: string) => void;
}) {
  const booked = stop.timeFlexibility === 'FIXED';
  const particulars = [stop.time, stop.durationLabel, stop.category]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('  ·  ');
  const blocked = findings.some(isBlocking);

  return (
    <Pressable
      onPress={onPress}
      // Blocked last, so it wins over the emphasis wash. Expanding a row is something you did;
      // the day not working is something that is true whether or not you are looking at it.
      style={[
        styles.stop,
        !first && styles.stopRuled,
        expanded && styles.stopExpanded,
        blocked && styles.stopBlocked,
      ]}
      android_ripple={{ color: Colors.pressed }}>
      <StopDisc ordinal={ordinal} color={dayCore(dayIndex)} />

      <View style={styles.grow}>
        <View style={styles.stopHead}>
          <ThemedText type="heading" style={styles.grow}>
            {stop.name}
          </ThemedText>
          <Cost amount={stop.cost} />
        </View>

        <View style={styles.particularsRow}>
          {particulars ? (
            <ThemedText type="label" themeColor="muted">
              {particulars}
            </ThemedText>
          ) : null}
          {/* A word, not a glyph. `plan/_layout.tsx` records that a bare SF symbol name renders
              nothing at all on Android, and a padlock drawn two ways is a second thing to keep in
              step for no gain — "Booked" also scales with Dynamic Type and reads to a screen
              reader without a label of its own. */}
          {booked ? (
            <ThemedText type="label" themeColor="foreground">
              Booked
            </ThemedText>
          ) : null}
        </View>

        {/* Where it occurs, not only in the panel above. A conflict read beside the stop it
            concerns is a decision; the same sentence in a list elsewhere is a chore. Shown
            collapsed as well as expanded — a problem nobody has tapped into is still a problem. */}
        {findings.map((finding, i) => (
          <View key={`${finding.message}-${i}`} style={styles.finding}>
            <ThemedText
              type="detail"
              themeColor={isBlocking(finding) ? 'alert' : 'muted'}
              style={styles.grow}>
              {finding.message}
            </ThemedText>
            <Pressable
              onPress={() => onAsk(fixMessage(finding))}
              accessibilityRole="button"
              accessibilityLabel={`Ask TripMate to fix: ${finding.message}`}
              hitSlop={8}>
              <ThemedText type="label" themeColor="accent">
                Fix this
              </ThemedText>
            </Pressable>
          </View>
        ))}

        {expanded ? (
          <View style={styles.expanded}>
            {stop.why ? <ThemedText type="detail">{stop.why}</ThemedText> : null}
            {stop.note ? (
              <ThemedText type="detail" themeColor="muted">
                {stop.note}
              </ThemedText>
            ) : null}

            {/* What you can do about a stop, on the stop. "Near here" lives here rather than on
                the map because a tap on open map points at nothing — a stop is a referent you
                chose, and it carries the day and the arrival time with it. */}
            <View style={styles.actions}>
              <Pressable
                onPress={() => Linking.openURL(directionsUrl(stop)).catch(() => {})}
                accessibilityRole="link"
                hitSlop={8}>
                <ThemedText type="label" themeColor="accent">
                  Directions
                </ThemedText>
              </Pressable>
              <Pressable onPress={onFindNearby} accessibilityRole="button" hitSlop={8}>
                <ThemedText type="label" themeColor="accent">
                  Find nearby
                </ThemedText>
              </Pressable>
              {/* The traveler's own §0 rank 1. Marking a stop booked is what stops the planner
                  moving it on the next edit, and unlocking is deliberately only available here:
                  a patch op that could clear the flag could clear it and move the stop in the
                  same turn, which is the lock not existing. */}
              <Pressable onPress={onToggleLock} accessibilityRole="button" hitSlop={8}>
                <ThemedText type="label" themeColor="accent">
                  {booked ? 'Unlock' : 'Mark booked'}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A label against a rule, which is how this system opens a section. */
function SectionRule({ label, trailing }: { label: string; trailing?: string }) {
  return (
    <View style={styles.sectionRule}>
      <ThemedText type="label" themeColor="muted">
        {label}
      </ThemedText>
      <View style={styles.rule} />
      {trailing ? (
        <ThemedText type="money" themeColor="money">
          {trailing}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Gold counts. A zero is not a money fact, so it goes muted rather than borrowing the colour. */
function Cost({ amount }: { amount: number }) {
  if (!amount) return null;
  return (
    <ThemedText type="moneyLarge" themeColor="money">
      {formatMoney(amount)}
    </ThemedText>
  );
}

/**
 * The day's figure for the section rule.
 *
 * **The summation is `daySpend`, not a local reduce, and that is a fix rather than tidying.** This
 * used to add up `stop.cost` and `lodging.cost` itself and never look at `actualCost` — so a real
 * spend entered on the web moved that app's totals and left this one quietly showing the estimate.
 * Nothing noticed while this was the only money on the page; the budget bar and the breakdown now
 * beside it are both drawn from `daySpend`, and three figures disagreeing on one screen is exactly
 * what the shared money module was written to stop.
 *
 * Still a string-or-`undefined`, because `SectionRule` omits its trailing figure on `undefined`
 * and a day nobody has priced should carry no figure rather than a `$0`.
 */
function dayTotal(day: DayPlan): string | undefined {
  const total = daySpend(day);
  return total > 0 ? formatMoney(total) : undefined;
}

/**
 * The forecast, short enough to stay a badge.
 *
 * **`day.weather` is prose, not a label** — the model writes things like "Pleasant autumn day,
 * 18.9-23.5°C, mostly sunny", which wrapped to two lines and covered the photograph it sits on.
 * So the structured figures win whenever they exist, and the prose is used only as a fallback,
 * cut at its first clause. `historical` says the numbers are last year's same-date weather rather
 * than a forecast, which is cheap to say and worth saying.
 */
function weatherLine(day: DayPlan): string | undefined {
  const detail = day.weatherDetail;
  if (detail) {
    const temps = `${Math.round(detail.tempMaxC)}° / ${Math.round(detail.tempMinC)}°`;
    return detail.historical ? `${temps}  ·  typical` : temps;
  }
  const prose = day.weather?.trim();
  if (!prose) return undefined;
  return prose.split(',')[0].trim();
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.regular * 2 },

  masthead: { paddingHorizontal: Spacing.read, paddingTop: Spacing.tight },
  mastheadPhoto: { justifyContent: 'flex-end' },
  weatherBadge: {
    position: 'absolute',
    top: Spacing.rows,
    right: Spacing.rows,
    backgroundColor: Colors.bar,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    paddingHorizontal: 10,
    paddingVertical: 5,
    // The badge stays a badge: a long fallback truncates rather than wrapping across the photo.
    maxWidth: '60%',
  },
  dateline: { padding: Spacing.rows, gap: Spacing.hair },
  datelineOverline: { opacity: 0.72 },
  datelineTitle: { opacity: 0.8 },
  theme: { marginTop: Spacing.rows },
  summary: { marginTop: Spacing.rows },

  sectionRule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    marginTop: Spacing.compact,
    marginBottom: Spacing.hair,
  },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.cardBorder },

  /** `SectionRule` carries no inset of its own — it inherits one from whichever block holds it
   *  (the masthead, the stay). A time-of-day heading sits at the page's top level, so it brings
   *  its own. */
  slot: { paddingHorizontal: Spacing.read },

  stop: {
    flexDirection: 'row',
    gap: 13,
    paddingVertical: Spacing.rows,
    paddingHorizontal: Spacing.read,
    alignItems: 'flex-start',
  },
  stopRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  stopExpanded: { backgroundColor: Colors.accentWash },
  stopBlocked: { backgroundColor: Colors.alertSoft },
  particularsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: Spacing.tight,
    marginTop: 3,
  },
  finding: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.tight,
    marginTop: Spacing.hair,
  },
  stopHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.tight },
  grow: { flex: 1 },
  expanded: { marginTop: Spacing.tight, gap: Spacing.hair },
  actions: { flexDirection: 'row', gap: Spacing.read, marginTop: Spacing.tight },

  lodging: { paddingHorizontal: Spacing.read },
  lodgingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.tight,
    paddingVertical: Spacing.rows,
  },
});
