import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { DayPlan, Stop } from '@/api/types';
import { PlacePhoto } from '@/components/place-photo';
import { ThemedText } from '@/components/themed-text';
import { Colors, DiscInk, PhotoScrim, Radius, Spacing, dayCore } from '@/constants/theme';
import { formatDateline } from '@/lib/dayDisplay';

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
}: {
  day: DayPlan;
  dayIndex: number;
  dayCount: number;
  /** Names the masthead photograph — see DayMasthead for why it is not the day's own stop. */
  destination: string;
  /** Index of the emphasised stop within this day, or null. */
  emphasis: number | null;
  onEmphasise: (index: number | null) => void;
}) {
  const stops = day.stops ?? [];

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <DayMasthead day={day} dayIndex={dayIndex} dayCount={dayCount} destination={destination} />

      {stops.map((stop, index) => (
        <StopRow
          key={`${stop.name}-${index}`}
          stop={stop}
          ordinal={index + 1}
          dayIndex={dayIndex}
          first={index === 0}
          expanded={emphasis === index}
          onPress={() => onEmphasise(emphasis === index ? null : index)}
        />
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
  onPress,
}: {
  stop: Stop;
  ordinal: number;
  dayIndex: number;
  first: boolean;
  expanded: boolean;
  onPress: () => void;
}) {
  const particulars = [stop.time, stop.durationLabel, stop.category]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('  ·  ');

  return (
    <Pressable
      onPress={onPress}
      style={[styles.stop, !first && styles.stopRuled, expanded && styles.stopExpanded]}
      android_ripple={{ color: Colors.pressed }}>
      <View style={[styles.disc, { backgroundColor: dayCore(dayIndex) }]}>
        <ThemedText type="money" style={styles.discOrdinal}>
          {ordinal}
        </ThemedText>
      </View>

      <View style={styles.grow}>
        <View style={styles.stopHead}>
          <ThemedText type="heading" style={styles.grow}>
            {stop.name}
          </ThemedText>
          <Cost amount={stop.cost} />
        </View>

        {particulars ? (
          <ThemedText type="label" themeColor="muted" style={styles.particulars}>
            {particulars}
          </ThemedText>
        ) : null}

        {expanded ? (
          <View style={styles.expanded}>
            {stop.why ? <ThemedText type="detail">{stop.why}</ThemedText> : null}
            {stop.note ? (
              <ThemedText type="detail" themeColor="muted">
                {stop.note}
              </ThemedText>
            ) : null}
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
      {`$${Math.round(amount).toLocaleString('en-US')}`}
    </ThemedText>
  );
}

function dayTotal(day: DayPlan): string | undefined {
  const stops = (day.stops ?? []).reduce((sum, stop) => sum + (stop.cost ?? 0), 0);
  const total = stops + (day.lodging?.cost ?? 0);
  return total > 0 ? `$${Math.round(total).toLocaleString('en-US')}` : undefined;
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
  summary: { marginTop: Spacing.rows },

  sectionRule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    marginTop: Spacing.compact,
    marginBottom: Spacing.hair,
  },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.cardBorder },

  stop: {
    flexDirection: 'row',
    gap: 13,
    paddingVertical: Spacing.rows,
    paddingHorizontal: Spacing.read,
    alignItems: 'flex-start',
  },
  stopRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  stopExpanded: { backgroundColor: Colors.accentWash },
  disc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  discOrdinal: { color: DiscInk, lineHeight: 15 },
  stopHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.tight },
  grow: { flex: 1 },
  particulars: { marginTop: 3 },
  expanded: { marginTop: Spacing.tight, gap: Spacing.hair },

  lodging: { paddingHorizontal: Spacing.read },
  lodgingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.tight,
    paddingVertical: Spacing.rows,
  },
});
