import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';

import { discardTrip, getTrip, promoteTrip } from '@/api/tripMateApi';
import type { DayPlan, Stop, Trip } from '@/api/types';
import { PrimaryButton } from '@/components/form';
import { PlacePhoto } from '@/components/place-photo';
import { Invitation, Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, DiscInk, PhotoScrim, Radius, Spacing, dayCore } from '@/constants/theme';
import { formatDateline, formatRange } from '@/lib/dayDisplay';

export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);
  /** `dayIndex:stopIndex` of the one expanded stop, or null. One at a time, like the Swift app. */
  const [emphasis, setEmphasis] = useState<string | null>(null);

  useEffect(() => {
    getTrip(id).then((result) => setTrip(result ?? null));
  }, [id]);

  if (trip === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
        <Loading />
      </View>
    );
  }

  if (trip === null) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
        <View style={styles.stateWrap}>
          <Notice>Couldn&rsquo;t reach TripMate. Check your connection.</Notice>
        </View>
      </View>
    );
  }

  const days = trip.itinerary?.days ?? [];

  return (
    <View style={styles.screen}>
      {/* Chevron only. The back label defaults to the previous screen's title, which for a route
          group is the literal string "(tabs)" — and naming one tab would be wrong anyway, since
          a trip opens from both Home and Memories. */}
      <Stack.Screen
        options={{ title: trip.destination, headerBackButtonDisplayMode: 'minimal' }}
      />
      <SectionList
        sections={days.map((day, index) => ({ day, index, data: day.stops ?? [] }))}
        keyExtractor={(stop, index) => `${stop.name}-${index}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.tripHeader}>
            <ThemedText type="label" themeColor="muted">
              {formatRange(trip.startDate, trip.endDate)}
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          <Invitation title="No days in this plan yet" body="This trip was kept before its days were written." />
        }
        renderSectionHeader={({ section }) => (
          <DayMasthead
            day={section.day}
            dayIndex={section.index}
            dayCount={days.length}
            destination={trip.destination}
          />
        )}
        renderItem={({ item, index, section }) => {
          const key = `${section.index}:${index}`;
          return (
            <StopRow
              stop={item}
              ordinal={index + 1}
              dayIndex={section.index}
              first={index === 0}
              expanded={emphasis === key}
              onPress={() => setEmphasis(emphasis === key ? null : key)}
            />
          );
        }}
        renderSectionFooter={({ section }) =>
          section.day.lodging ? (
            <View style={styles.lodging}>
              <SectionRule label="Stay" />
              <View style={styles.lodgingRow}>
                <View style={styles.grow}>
                  <ThemedText type="heading">{section.day.lodging.name}</ThemedText>
                  {section.day.lodging.note ? (
                    <ThemedText type="detail" themeColor="muted">
                      {section.day.lodging.note}
                    </ThemedText>
                  ) : null}
                </View>
                <Cost amount={section.day.lodging.cost} />
              </View>
            </View>
          ) : null
        }
      />

      {trip.status === 'draft' ? (
        <KeepShelf
          trip={trip}
          onKept={(endDate) => setTrip({ ...trip, status: 'saved', endDate })}
        />
      ) : null}
    </View>
  );
}

/**
 * An unkept plan's shelf.
 *
 * A generated trip is a `draft` row from the moment it exists, so nothing is lost on a back
 * press — but a draft is invisible on the memories wall (`listTrips` defaults to saved), so
 * without this it could only be reached by going back through generation. Keeping promotes the
 * same row rather than inserting a second one, which is what keeps its `runId` link intact.
 */
function KeepShelf({ trip, onKept }: { trip: Trip; onKept: (endDate: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'keep' | 'discard' | null>(null);
  const [failed, setFailed] = useState(false);

  async function keep() {
    setBusy('keep');
    setFailed(false);
    const update = await promoteTrip(trip.id, trip.itinerary);
    setBusy(null);
    // The returned endDate is recomputed from the itinerary server-side, so it is the one to
    // keep — not whatever was sent.
    if (update) onKept(update.endDate);
    else setFailed(true);
  }

  async function discard() {
    setBusy('discard');
    setFailed(false);
    const ok = await discardTrip(trip.id);
    if (ok) router.replace('/(tabs)/memories');
    else {
      setBusy(null);
      setFailed(true);
    }
  }

  return (
    <View style={styles.shelf}>
      {failed ? (
        <ThemedText type="detail" themeColor="alert" style={styles.shelfError}>
          That didn&rsquo;t go through. Try again.
        </ThemedText>
      ) : (
        <ThemedText type="detail" themeColor="muted" style={styles.shelfError}>
          Not kept yet — it won&rsquo;t appear under Memories until you do.
        </ThemedText>
      )}
      <PrimaryButton title="Keep this trip" onPress={keep} busy={busy === 'keep'} disabled={!!busy} />
      <Pressable onPress={discard} disabled={!!busy} style={styles.discard}>
        <ThemedText type="detail" themeColor="muted">
          {busy === 'discard' ? 'Discarding…' : 'Discard'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

/**
 * The day's masthead: a photograph with the measured scrim, the dateline set into it.
 *
 * Only large type and tracked caps ride the picture — the Photograph-Is-Not-A-Surface rule. The
 * weather badge is a slate pill rather than bare text for the same reason: small type over a
 * photograph is only apparently safe.
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
            <ThemedText type="label" themeColor="foreground">
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
 * The forecast in one line. `historical` says the figures are last year's same-date weather
 * rather than a forecast, and saying so is cheap and honest.
 */
function weatherLine(day: DayPlan): string | undefined {
  const detail = day.weatherDetail;
  const parts: string[] = [];
  if (day.weather?.trim()) parts.push(day.weather.trim());
  if (detail) parts.push(`${Math.round(detail.tempMaxC)}° / ${Math.round(detail.tempMinC)}°`);
  if (detail?.historical) parts.push('typical');
  return parts.length ? parts.join('  ·  ') : undefined;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  content: { paddingBottom: Spacing.regular * 2 },
  stateWrap: { paddingTop: Spacing.regular },
  tripHeader: { paddingHorizontal: Spacing.read, paddingBottom: Spacing.rows },

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

  shelf: {
    backgroundColor: Colors.bar,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.cardBorder,
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.rows,
    paddingBottom: Spacing.regular,
    gap: Spacing.rows,
  },
  shelfError: { textAlign: 'center' },
  discard: { alignItems: 'center', paddingVertical: Spacing.tight },
});
