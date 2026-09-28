import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { arrivalPoints } from '@/api/tripMateApi';
import type { ArrivalPoint } from '@/api/types';
import {
  CountRow,
  FieldTrough,
  PrimaryButton,
  Question,
  ChoiceRow,
  TextField,
  TimeField,
} from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { GROUPS, partyForGroup, usePlanDraft } from '@/lib/planDraft';

export default function GroupStep() {
  const router = useRouter();
  const { draft, patch } = usePlanDraft();
  const { party, logistics } = draft;

  /**
   * The airports and stations near the destination, for the two "where did you land" fields.
   *
   * **Fetched once on mount and filtered locally**, not re-queried per keystroke: the list is a
   * handful of names for a whole city and it does not change as somebody types. The route behind
   * it goes to Overpass, which is the one source here that is routinely too busy to answer — so it
   * already degrades to `[]`, and these fields stay exactly what they were before, free text.
   *
   * Nothing waits on it. A traveller who gets here before the lookup lands, or whose destination
   * never resolved to a point, types the name the way they always did.
   */
  const [points, setPoints] = useState<ArrivalPoint[]>([]);
  /** Which field's list is open, or null. One at a time — both draw from the same list. */
  const [picking, setPicking] = useState<'arrivalPoint' | 'departurePoint' | null>(null);

  const { destinationLat, destinationLng } = draft;
  useEffect(() => {
    if (destinationLat === undefined || destinationLng === undefined) return;
    let live = true;
    arrivalPoints(destinationLat, destinationLng).then((found) => live && setPoints(found));
    return () => {
      live = false;
    };
  }, [destinationLat, destinationLng]);

  /** Typing narrows the list rather than dismissing it, so the field is a combo box either way. */
  const matches = (typed: string | undefined) => {
    const query = (typed ?? '').trim().toLowerCase();
    if (!query) return points;
    return points.filter((point) => point.name.toLowerCase().includes(query));
  };

  const setLogistics = (next: Partial<typeof logistics>) => {
    patch({ logistics: { ...logistics, ...next } });
  };

  /** Same reasoning as the destination list in `basics.tsx`: closing on blur unmounts the row
   *  under the finger choosing it, so the *next* field closes it instead. */
  const pick = (field: 'arrivalPoint' | 'departurePoint', name: string) => {
    setPicking(null);
    setLogistics({ [field]: name });
    // Picking one is the end of that field's job, so the keyboard goes with it.
    //
    // `ponytail:` it does NOT fix the display of a very long name. A value wider than the row
    // spills off the *left* under `textAlign: 'right'`, and RN keeps the input's scroll offset
    // through a blur — so "Chhatrapati Shivaji Maharaj International Airport (BOM)" reads as
    // "…ivaji Maharaj International Airport (BOM)". The stored value is whole and the planner
    // gets all of it; only these few ceremonial names are affected, and somebody who just tapped
    // the row knows what they tapped. Fix by left-aligning a value that overflows its row, which
    // means measuring it — see `prefixedWidth` in `form.tsx` for why that is not free.
    Keyboard.dismiss();
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: "Who's going" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="display" style={styles.headline}>
          {draft.destination ? `Who's going to ${draft.destination.split(',')[0]}?` : "Who's going?"}
        </ThemedText>

        {/* A shortcut into the counters below, not a second question about the same thing —
            see `partyForGroup`. The counters stay editable, so a preset is a starting point
            rather than an assertion. */}
        <Question title="Who's travelling">
          <ChoiceRow
            options={GROUPS}
            value={draft.group}
            onChange={(group) => {
              const seeded = partyForGroup(group);
              patch(seeded ? { group, party: seeded } : { group });
            }}
          />
        </Question>

        {draft.group === 'other' ? (
          <FieldTrough>
            <TextField
              label="Who"
              value={draft.groupOther}
              onChangeText={(groupOther) => patch({ groupOther })}
              placeholder="five college friends"
              autoCapitalize="none"
            />
          </FieldTrough>
        ) : null}

        {/* Age bands rather than exact ages: the bands are what map onto a planning rule —
            strollers, nap windows, what counts as a late night. */}
        <Question title="Party" caption="Children are 2–11; infants are under 2.">
          <FieldTrough>
            <CountRow
              label="Adults"
              value={party.adults}
              min={1}
              max={12}
              onChange={(adults) => patch({ party: { ...party, adults } })}
            />
            <CountRow
              label="Children"
              value={party.children}
              max={12}
              onChange={(children) => patch({ party: { ...party, children } })}
            />
            <CountRow
              label="Infants"
              value={party.infants}
              max={6}
              onChange={(infants) => patch({ party: { ...party, infants } })}
            />
          </FieldTrough>
        </Question>

        {/* The planning rules say an already-booked thing beats anything the model would
            recommend, and nothing else in the app collects one. */}
        <Question title="Already booked" caption="Optional — anything fixed already.">
          <FieldTrough>
            <TextField
              label="Staying"
              value={logistics.stayBooked ?? ''}
              onFocus={() => setPicking(null)}
              onChangeText={(stayBooked) => setLogistics({ stayBooked })}
              placeholder="Hotel name, or a neighbourhood"
            />
            <TimeField
              label="Arrive"
              value={logistics.arrivalTime ?? ''}
              placeholder="14:00"
              onChange={(arrivalTime) => {
                setPicking(null);
                setLogistics({ arrivalTime });
              }}
            />
            <TextField
              label="At"
              value={logistics.arrivalPoint ?? ''}
              onFocus={() => setPicking('arrivalPoint')}
              onChangeText={(arrivalPoint) => setLogistics({ arrivalPoint })}
              placeholder="Airport, station"
            />
            {picking === 'arrivalPoint' ? (
              <PointList
                points={matches(logistics.arrivalPoint)}
                onPick={(name) => pick('arrivalPoint', name)}
              />
            ) : null}
            <TimeField
              label="Leave"
              value={logistics.departureTime ?? ''}
              placeholder="18:30"
              onChange={(departureTime) => {
                setPicking(null);
                setLogistics({ departureTime });
              }}
            />
            <TextField
              label="From"
              value={logistics.departurePoint ?? ''}
              onFocus={() => setPicking('departurePoint')}
              onChangeText={(departurePoint) => setLogistics({ departurePoint })}
              placeholder="Airport, station"
            />
            {picking === 'departurePoint' ? (
              <PointList
                points={matches(logistics.departurePoint)}
                onPick={(name) => pick('departurePoint', name)}
              />
            ) : null}
          </FieldTrough>
        </Question>

        <View style={styles.action}>
          <PrimaryButton title="Next" onPress={() => router.push('/plan/preferences')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * The destination's airports and stations, as rows under the field asking for one.
 *
 * Inside the trough and above the next hairline, matching the destination list in `basics.tsx` —
 * an overlay would cover the question below, and a suggestion that hides the next question is how
 * you fill one field and lose another.
 *
 * The distance is shown because it is the thing that actually decides between two airports, and
 * the list is already sorted by it within a tier. Nothing is said when the list is empty: these
 * fields were free text before and still are, so an unreachable Overpass reads as no dropdown
 * rather than as a failure on an optional question.
 */
function PointList({
  points,
  onPick,
}: {
  points: ArrivalPoint[];
  onPick: (name: string) => void;
}) {
  if (points.length === 0) return null;
  return (
    <View>
      {points.slice(0, 6).map((point) => (
        <Pressable
          key={point.name}
          onPress={() => onPick(point.name)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.point, pressed && styles.pointPressed]}>
          <ThemedText type="detail" themeColor="muted" numberOfLines={1} style={styles.pointName}>
            {point.name}
          </ThemedText>
          <ThemedText type="micro" themeColor="muted">
            {Math.round(point.distanceKm)} km
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // 44 is the tap-target floor, and the row is the target rather than the words in it.
  point: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.rows,
    minHeight: 44,
    paddingHorizontal: Spacing.read,
  },
  pointPressed: { backgroundColor: Colors.pressed },
  pointName: { flexShrink: 1 },
  screen: { flex: 1, backgroundColor: Colors.canvas },
  content: { padding: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.regular },
  headline: { marginBottom: Spacing.tight },
  action: { marginTop: Spacing.tight },
});
