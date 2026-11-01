import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { SymbolView } from '@/components/symbol';
import { importPlaces, listSavedPlaces } from '@/api/tripMateApi';
import type { Anchor, ImportItem, SavedPlace } from '@/api/types';
import { ImportComposer } from '@/components/import-composer';
import { PlanColors, Section, SheetScreen, TextRow } from '@/components/plan-ui';
import { Polar } from '@/constants/polar';
import { anchorKey, mergeAnchors } from '@/lib/anchors';
import { looksLikeDayPlan } from '@/lib/importItems';
import { usePlanDraft } from '@/lib/planDraft';
import { cityMatches, groupByCity, shouldPreselect, toAnchor } from '@/lib/savedPlaces';
import { useFocusedFetch } from '@/lib/useFocusedFetch';
import { Text } from '@/components/themed-text';

/**
 * Places you've saved, and a note to plan around — the two things the planner reads besides your
 * answers. Two labelled jobs, because the unlabelled box did one and looked like the other: it only
 * ever finds places, and a note typed there ("busy Thursday") was thrown away.
 */
export default function SavedSheet() {
  const { draft, patch } = usePlanDraft();
  const onAnchorsChange = (update: (prev: Anchor[]) => Anchor[]) => patch((prev) => ({ anchors: update(prev.anchors) }));
  return (
    <SheetScreen title="Saved places and notes">
      <SavedPlacesSection destination={draft.destination} anchors={draft.anchors} onAnchorsChange={onAnchorsChange} />
      <View style={styles.block}>
        <Text style={styles.header}>PLACES YOU&rsquo;VE SAVED</Text>
        <ImportSection
          destination={draft.destination}
          anchors={draft.anchors}
          onAnchorsChange={onAnchorsChange}
          onDestinationGuess={(guess) => patch((prev) => (prev.destination.trim() ? {} : { destination: guess }))}
        />
        <Text style={styles.footer}>Links, a list or screenshots. We&rsquo;ll find the places in them.</Text>
      </View>
      {/* The note the planner reads word for word. */}
      <Section header="Anything we should plan around?" footer="Optional. Booked tickets, times you're busy, places to skip.">
        <TextRow
          label="Note"
          value={draft.constraintsNote}
          onChangeText={(constraintsNote) => patch({ constraintsNote })}
          placeholder="Busy Thursday afternoon"
        />
      </Section>
    </SheetScreen>
  );
}

/**
 * Places the traveller shared into TripMate before planning, grouped by the city they were saved
 * under. Loading the destination's own city pre-selects them into `draft.anchors`, the same list
 * the chips toggle in and out of — here, then everywhere else, because the library is global and
 * the trip is not.
 */
function SavedPlacesSection({
  destination,
  anchors,
  onAnchorsChange,
}: {
  destination: string;
  anchors: Anchor[];
  onAnchorsChange: (update: (prev: Anchor[]) => Anchor[]) => void;
}) {
  const saved = useFocusedFetch(listSavedPlaces);
  const places = saved ?? [];
  /** The destination the pre-select last ran for, so a refocus cannot re-merge a chip the
   *  traveller had just deselected for the same destination. */
  const preselectedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!saved || !shouldPreselect(destination, preselectedFor.current)) return;
    preselectedFor.current = anchorKey(destination);
    const matches = places.filter((p) => p.source !== 'instagram' && cityMatches(p.city, destination));
    if (matches.length) onAnchorsChange((prev) => mergeAnchors(prev, matches.map(toAnchor)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per distinct destination, once the list has loaded
  }, [destination, saved]);
  if (places.length === 0) return null;
  const chosen = new Set(anchors.map((a) => anchorKey(a.name)));
  const reminders = places.filter((p) => p.source === 'instagram');
  const groups = groupByCity(places);
  const here = groups.filter((g) => cityMatches(g.city, destination));
  const elsewhere = groups.filter((g) => !cityMatches(g.city, destination));

  const City = ({ g }: { g: { city: string; places: SavedPlace[] } }) => (
    <View style={styles.city}>
      <Text style={styles.cityName}>{g.city}</Text>
      <View style={styles.chips}>
        {g.places.map((p) => {
          const on = chosen.has(anchorKey(p.name));
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${on ? 'Remove' : 'Add'} ${p.name}`}
              onPress={() =>
                onAnchorsChange((prev) =>
                  on ? prev.filter((a) => anchorKey(a.name) !== anchorKey(p.name)) : mergeAnchors(prev, [toAnchor(p)])
                )
              }
              style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.block}>
      <Text style={styles.header}>{`YOUR SAVED PLACES (${places.length - reminders.length})`}</Text>
      <View style={styles.card}>
        {here.map((g) => (
          <City key={g.city} g={g} />
        ))}
        {/* Only when there is a "here" to be elsewhere from. */}
        {here.length > 0 && elsewhere.length > 0 ? <Text style={styles.elsewhere}>Saved elsewhere</Text> : null}
        {elsewhere.map((g) => (
          <City key={g.city} g={g} />
        ))}
        {/* A link only where there is somewhere to go: `SavedPlace.url` is nullable. */}
        {reminders.map((r) =>
          r.url ? (
            <Pressable key={r.id} accessibilityRole="link" onPress={() => Linking.openURL(r.url!)}>
              <Text style={styles.link}>Instagram post: screenshot it to add places</Text>
            </Pressable>
          ) : (
            <Text key={r.id} style={styles.cityName}>
              Instagram post: screenshot it to add places
            </Text>
          )
        )}
      </View>
    </View>
  );
}

/**
 * "Chaos in, trip out": paste what you already saved (screenshots, links, notes) and get the places
 * back as starrable chips. Holds its own pending state — the draft only ever wants the finished
 * `Anchor[]`, and `onAnchorsChange` goes through the draft's functional `patch`, so a star tapped
 * mid-import merges against the latest anchors.
 */
function ImportSection({
  destination,
  anchors,
  onAnchorsChange,
  onDestinationGuess,
}: {
  destination: string;
  anchors: Anchor[];
  onAnchorsChange: (update: (prev: Anchor[]) => Anchor[]) => void;
  onDestinationGuess: (guess: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [unread, setUnread] = useState<string[]>([]);

  async function findPlaces(items: ImportItem[]): Promise<boolean> {
    setBusy(true);
    setUnread([]);
    const result = await importPlaces(items, destination.trim() || undefined);
    setBusy(false);
    if (result === undefined) {
      setUnread(["Couldn't read these right now."]);
      return false;
    }
    if (typeof result === 'string') {
      setUnread([result]);
      return false;
    }
    onAnchorsChange((prev) => mergeAnchors(prev, result.places));
    if (result.destinationGuess) onDestinationGuess(result.destinationGuess);
    setUnread(result.unread.map((u) => u.reason));
    return true;
  }

  const toggleMust = (name: string) =>
    onAnchorsChange((prev) => prev.map((a) => (a.name === name ? { ...a, priority: a.priority === 'must' ? 'want' : 'must' } : a)));
  const remove = (name: string) => onAnchorsChange((prev) => prev.filter((a) => a.name !== name));

  return (
    <View style={styles.import}>
      <ImportComposer
        light
        busy={busy}
        unread={unread}
        actionTitle="Find the places"
        placeholder="Paste links or a list of places"
        onSubmit={findPlaces}
        below={(text) =>
          looksLikeDayPlan(text) ? (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/plan/own', params: { text } })}>
              <Text style={styles.link}>This looks like a full plan. Use it as your trip</Text>
            </Pressable>
          ) : null
        }
      />

      {anchors.length > 0 ? (
        <View style={[styles.card, styles.chips]}>
          {anchors.map((a) => (
            <View key={a.name} style={styles.chip}>
              <Pressable
                onPress={() => toggleMust(a.name)}
                accessibilityRole="button"
                accessibilityState={{ selected: a.priority === 'must' }}
                accessibilityLabel={`Must-see: ${a.name}`}
                hitSlop={8}>
                <SymbolView name={{ ios: a.priority === 'must' ? 'star.fill' : 'star', android: 'star' }} size={13} tintColor={Polar.ember} />
              </Pressable>
              <Text style={styles.chipText} numberOfLines={1}>
                {a.name}
                {a.lat === null ? ' · couldn’t place it' : ''}
              </Text>
              <Pressable onPress={() => remove(a.name)} accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`} hitSlop={8}>
                <SymbolView name={{ ios: 'xmark', android: 'close' }} size={11} weight="semibold" tintColor={PlanColors.grey} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginHorizontal: 16, marginBottom: 22, gap: 7 },
  header: { marginHorizontal: 16, fontSize: 13, color: PlanColors.grey },
  footer: { marginHorizontal: 16, fontSize: 13, lineHeight: 18, color: PlanColors.grey },
  card: { padding: 14, gap: 10, borderRadius: 12, backgroundColor: '#fff' },
  city: { gap: 6 },
  cityName: { fontSize: 15, color: PlanColors.grey },
  elsewhere: { fontSize: 13, color: PlanColors.grey, textTransform: 'uppercase' },
  link: { fontSize: 15, color: Polar.ember, paddingVertical: 6 },
  import: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: PlanColors.fill,
  },
  chipOn: { backgroundColor: Polar.ink },
  chipText: { flexShrink: 1, fontSize: 15, color: PlanColors.ink },
  chipTextOn: { color: '#fff' },
});
