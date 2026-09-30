import { travelLegBetween } from '@shared/travelTime';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Stop } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { leaveBy } from '@/lib/dayTravel';

/**
 * The hop between one stop and the next, in the gutter the discs run down.
 *
 * **A day reads as an order; this is what makes it read as a journey.** Two stops an hour apart
 * tell you nothing about whether the hour is generous or barely enough, and that is the single
 * most common thing a plan gets wrong. The arithmetic is `travelLegBetween` — the same function
 * the guardrails price a leg with, so a segment saying "about 24 min" can never disagree with a
 * conflict two rows down saying the leg does not fit.
 *
 * **"about" rather than an ESTIMATED badge, and that is a deliberate reading of the confidence
 * rule.** Every one of these is estimated — straight-line distance times a circuity factor, since
 * there is no free transit router — so a badge would repeat the same word six times down one day
 * until nobody reads any of them. The hedge belongs in the sentence, which is also the voice the
 * rest of this app already uses for computed figures ("about 9 hours", "takes about 28 min").
 *
 * No distance. Minutes are what somebody acts on, and printing kilometres next to them would
 * invite a units question the plan has no way to answer — a destination is free text, and nothing
 * here knows whether the traveler thinks in miles.
 *
 * **It opens to one more line: when to leave.** That is the other end of the sum this row
 * already does one half of, and it was nowhere in the app — a traveler reading "about 24 min"
 * still has to subtract it from the next stop's time themselves, standing in the place they are
 * about to leave. Closed by default because most legs never need it and a day of six expanded
 * rows is a day nobody can scan; the arrival is deliberately NOT restated, since a second
 * opinion about when you get there would either repeat the plan or duplicate the conflict the
 * guardrails already draw in coral.
 */
export function TravelSegment({ from, to }: { from: Stop; to: Stop }) {
  // An unplaced stop sits at 0,0. A leg measured to one is a leg measured to the Gulf of Guinea,
  // so the gutter simply stays empty rather than printing a four-hour flight across a city.
  if (!located(from) || !located(to)) return null;

  const leg = travelLegBetween(
    { lat: from.lat, lon: from.lng },
    { lat: to.lat, lon: to.lng }
  );
  // `leaveBy` works on a day's stop list; this row holds exactly the pair it needs.
  const go = leaveBy([from, to], 1);

  return <Segment mode={MODE[leg.mode]} minutes={leg.minutes} go={go} to={to.name} />;
}

function Segment({
  mode,
  minutes,
  go,
  to,
}: {
  mode: string;
  minutes: number;
  /** When to set off, or null when the sum cannot be done honestly. */
  go: string | null;
  to: string;
}) {
  const [open, setOpen] = useState(false);

  const line = (
    <View style={styles.segment}>
      <View style={styles.gutter} />
      <View>
        <ThemedText type="micro" themeColor="muted">
          {mode} · about {minutes} min
        </ThemedText>
        {open ? (
          <ThemedText type="micro" themeColor="foreground" style={styles.leave}>
            Leave by {go} to reach {to} on time
          </ThemedText>
        ) : null}
      </View>
    </View>
  );

  // A leg with nothing more to say stays exactly what it was — text, not a control that
  // rewards a press with nothing.
  if (!go) {
    return (
      <View accessibilityRole="text">{line}</View>
    );
  }

  return (
    <Pressable
      onPress={() => setOpen((was) => !was)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${mode}, about ${minutes} minutes. Leave by ${go}.`}>
      {line}
    </Pressable>
  );
}

const located = (stop: Stop) => !(stop.lat === 0 && stop.lng === 0);

/** `travelLegBetween` picks the mode; these are just its names in sentence case. */
const MODE: Record<string, string> = {
  walk: 'Walk',
  bike: 'Bike',
  transit: 'Transit',
  drive: 'Drive',
};

/**
 * The disc is 26 wide with a 13 gap. The gutter is an empty spacer of that width, so the leg's
 * text starts on the same column as the stop names it sits between.
 *
 * **It held a vertical rule, and the rule could not do its job.** A connector has to reach the
 * disc above and the disc below, and both of those live in `StopRow`, outside this component and
 * behind its `paddingVertical` — so the line stopped 11pt short at the top and 22pt short at the
 * bottom and read as a stray fragment rather than a thread. Drawing it properly means the two
 * stop rows rendering their own half, which is three components to say what the indent already
 * says. Same conclusion, and for the same reason, as the spine dropped from Today.
 */
const DISC = 26;

const styles = StyleSheet.create({
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: Spacing.read,
    paddingVertical: 2,
  },
  gutter: { width: DISC, alignItems: 'center' },
  leave: { marginTop: 1 },
});
