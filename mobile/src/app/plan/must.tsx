import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { candidatePois } from '@/api/tripMateApi';
import type { CandidatePoi } from '@/api/types';
import { ChipsRow, PlanColors, Section, SheetScreen, TextRow } from '@/components/plan-ui';
import { usePlanDraft } from '@/lib/planDraft';

/**
 * Places to pin before the plan is written, and places to leave out.
 *
 * Three states for the suggestions, not two. "Couldn't reach" is a fact about the source; "nothing
 * here" is a fact about the destination, and saying the second when the first is true is a small
 * lie about the place somebody is about to visit.
 */
export default function MustSheet() {
  const { draft, patch } = usePlanDraft();
  const [state, setState] = useState<'loading' | 'unavailable' | 'ready'>('loading');
  const [pois, setPois] = useState<CandidatePoi[]>([]);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    let active = true;
    candidatePois(draft.destination, draft.startDate, draft.endDate).then((result) => {
      if (!active) return;
      setPois(result.pois);
      setState(result.available ? 'ready' : 'unavailable');
    });
    return () => {
      active = false;
    };
  }, [draft.destination, draft.startDate, draft.endDate]);

  const selectedNames = draft.selectedPois.map((p) => p.name);
  function addCustom() {
    const name = custom.trim();
    if (!name) return;
    patch({ customPois: [...draft.customPois, name] });
    setCustom('');
  }
  const city = draft.destination.split(',')[0].trim();

  return (
    <SheetScreen title="Must-sees">
      <Section header="Anywhere you already want to go" footer="Optional. Tap to pin; a pinned place is planned in.">
        {state === 'loading' ? (
          <View style={styles.state}>
            <ActivityIndicator color={PlanColors.tint} />
          </View>
        ) : state === 'unavailable' ? (
          <Text style={styles.stateText}>Couldn&rsquo;t load nearby places. You can still name your own below.</Text>
        ) : pois.length === 0 ? (
          <Text style={styles.stateText}>Nothing came back for this destination. Name your own below.</Text>
        ) : (
          <ChipsRow
            tags={pois.map((p) => p.name)}
            selected={selectedNames}
            onPress={(name) =>
              patch({
                selectedPois: selectedNames.includes(name)
                  ? draft.selectedPois.filter((p) => p.name !== name)
                  : [...draft.selectedPois, pois.find((p) => p.name === name)!],
              })
            }
          />
        )}
        {draft.customPois.length ? (
          <ChipsRow
            tags={draft.customPois}
            selected={draft.customPois}
            onPress={(name) => patch({ customPois: draft.customPois.filter((p) => p !== name) })}
          />
        ) : null}
        <TextRow
          label="Add"
          value={custom}
          onChangeText={setCustom}
          onSubmitEditing={addCustom}
          onBlur={addCustom}
          placeholder="A place by name"
          returnKeyType="done"
        />
      </Section>

      {/* A requirement, not a weight: the server-side check matches these against the plan. */}
      <Section header="Anything you must see" footer="Optional. Separate with commas.">
        <TextRow
          label="Must see"
          value={draft.mustInclude}
          onChangeText={(mustInclude) => patch({ mustInclude })}
          placeholder={city ? `Somewhere in ${city}` : 'Somewhere you must not miss'}
        />
      </Section>
      <Section header="Anything to leave out" footer="Optional.">
        <TextRow label="Skip" value={draft.avoid} onChangeText={(avoid) => patch({ avoid })} placeholder="Nightclubs, seafood" />
      </Section>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  state: { minHeight: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  stateText: { padding: 16, fontSize: 15, lineHeight: 20, color: PlanColors.grey, backgroundColor: '#fff' },
});
