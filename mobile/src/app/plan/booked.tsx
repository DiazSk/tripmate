import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { arrivalPoints } from '@/api/tripMateApi';
import type { ArrivalPoint } from '@/api/types';
import { PlanColors, Section, SheetScreen, TextRow, TimeRow } from '@/components/plan-ui';
import { usePlanDraft } from '@/lib/planDraft';
import { Text } from '@/components/themed-text';

/**
 * Anything fixed already: where you are staying, and when and where you arrive and leave. The
 * planning rules say an already-booked thing beats anything the model would recommend, and nothing
 * else in the app collects one.
 */
export default function BookedSheet() {
  const { draft, patch } = usePlanDraft();
  const { logistics } = draft;

  /**
   * The airports and stations near the destination, for the two "where" fields.
   *
   * **Fetched once and filtered locally**, not re-queried per keystroke: the list is a handful of
   * names for a whole city. The route behind it goes to Overpass, routinely too busy to answer, so
   * it degrades to `[]` and these fields stay what they always were, free text. Nothing waits on it.
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
    return query ? points.filter((point) => point.name.toLowerCase().includes(query)) : points;
  };
  const setLogistics = (next: Partial<typeof logistics>) => patch({ logistics: { ...logistics, ...next } });

  /** Closing on blur would unmount the row under the finger choosing it, so picking closes it. */
  const pick = (field: 'arrivalPoint' | 'departurePoint', name: string) => {
    setPicking(null);
    setLogistics({ [field]: name });
    Keyboard.dismiss();
  };

  return (
    <SheetScreen title="Already booked">
      <Section header="Staying" footer="Optional: a hotel name, or just the neighbourhood.">
        <TextRow
          label="Staying"
          value={logistics.stayBooked ?? ''}
          onFocus={() => setPicking(null)}
          onChangeText={(stayBooked) => setLogistics({ stayBooked })}
          placeholder="Hotel, or a neighbourhood"
        />
      </Section>
      <Section header="Arriving">
        <TimeRow label="Arrive" value={logistics.arrivalTime ?? ''} placeholder="14:00" onChange={(arrivalTime) => setLogistics({ arrivalTime })} />
        <TextRow
          label="At"
          value={logistics.arrivalPoint ?? ''}
          onFocus={() => setPicking('arrivalPoint')}
          onChangeText={(arrivalPoint) => setLogistics({ arrivalPoint })}
          placeholder="Airport, station"
        />
        {picking === 'arrivalPoint' ? <PointList points={matches(logistics.arrivalPoint)} onPick={(name) => pick('arrivalPoint', name)} /> : null}
      </Section>
      <Section header="Leaving" footer="The last day keeps time to get there, and a buffer once you do.">
        <TimeRow label="Leave" value={logistics.departureTime ?? ''} placeholder="18:30" onChange={(departureTime) => setLogistics({ departureTime })} />
        <TextRow
          label="From"
          value={logistics.departurePoint ?? ''}
          onFocus={() => setPicking('departurePoint')}
          onChangeText={(departurePoint) => setLogistics({ departurePoint })}
          placeholder="Airport, station"
        />
        {picking === 'departurePoint' ? <PointList points={matches(logistics.departurePoint)} onPick={(name) => pick('departurePoint', name)} /> : null}
      </Section>
    </SheetScreen>
  );
}

/**
 * The destination's airports and stations, as rows under the field asking for one — inside the
 * group, so a suggestion never covers the question below. The distance is shown because it is what
 * actually decides between two airports. An empty list says nothing: these were free text before.
 */
function PointList({ points, onPick }: { points: ArrivalPoint[]; onPick: (name: string) => void }) {
  if (points.length === 0) return null;
  return (
    <View>
      {points.slice(0, 6).map((point) => (
        <Pressable
          key={point.name}
          onPress={() => onPick(point.name)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.point, pressed && styles.pressed]}>
          <Text style={styles.pointName} numberOfLines={1}>
            {point.name}
          </Text>
          <Text style={styles.distance}>{Math.round(point.distanceKm)} km</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  point: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 16, backgroundColor: '#fff' },
  pressed: { backgroundColor: PlanColors.pressed },
  pointName: { flex: 1, fontSize: 16, color: PlanColors.ink },
  distance: { fontSize: 13, color: PlanColors.grey, fontVariant: ['tabular-nums'] },
});
