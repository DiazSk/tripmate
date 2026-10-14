import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HomeCity } from '@shared/travelerProfile';
import { suggestDestinations, suggestionLabel, type GeoSuggestion } from '@shared/weather';

import { FieldTrough, TextField } from '@/components/form';
import { PaperInput } from '@/components/polar-ui';
import { Polar, PolarFonts } from '@/constants/polar';
import { Colors } from '@/constants/theme';

/**
 * A city search that resolves to a `HomeCity`. Used by the welcome (on the app's own ground) and by
 * the Profile tab (on Polar paper, `tone="paper"`).
 *
 * `onPick(null)` means the text was edited after a pick, so the picked city no longer matches what
 * the field says. The welcome clears its answer on that; Profile ignores it and keeps the saved city.
 */
export function HomeCitySearch({ value, onPick, tone = 'app' }: { value: HomeCity | null; onPick: (home: HomeCity | null) => void; tone?: 'app' | 'paper' }) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [results, setResults] = useState<GeoSuggestion[]>([]);
  const q = query.trim();
  const searching = q.length >= 2 && q !== value?.name;
  const paper = tone === 'paper';

  useEffect(() => {
    if (!searching) return;
    // `cancelled` is what makes a slow answer to an older query harmless once the text has moved on.
    let cancelled = false;
    const timer = setTimeout(() => {
      suggestDestinations(q, 5).then((r) => { if (!cancelled) setResults(r); }).catch(() => { if (!cancelled) setResults([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, searching]);

  function edit(text: string) {
    setQuery(text);
    if (value && text.trim() !== value.name) onPick(null);
  }

  return (
    <>
      {paper ? (
        <PaperInput label="City" value={query} onChangeText={edit} placeholder="Search your city" autoCorrect={false} />
      ) : (
        <FieldTrough><TextField label="City" value={query} onChangeText={edit} placeholder="Search your city" autoCorrect={false} /></FieldTrough>
      )}
      <View>
        {(searching ? results : []).map((r) => (
          <Pressable key={`${r.lat},${r.lon}`} accessibilityRole="button" accessibilityLabel={suggestionLabel(r)} style={[styles.result, paper && styles.paperResult]}
            onPress={() => { setQuery(r.name); setResults([]); onPick({ name: r.name, latitude: r.lat, longitude: r.lon }); }}>
            <Text style={paper ? styles.paperCity : styles.city}>{r.name}</Text><Text style={paper ? styles.paperRegion : styles.region}>{suggestionLabel(r).replace(`${r.name}, `, '')}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  result: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.cardBorder },
  city: { color: Colors.foreground, fontSize: 16 },
  region: { color: Colors.muted, fontSize: 13 },
  paperResult: { minHeight: 44, alignItems: 'center', borderBottomColor: Polar.rule },
  paperCity: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ink },
  paperRegion: { fontFamily: PolarFonts.sans, fontSize: 13, color: Polar.charcoal },
});
