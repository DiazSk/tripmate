import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HomeCity } from '@shared/travelerProfile';
import { suggestDestinations, suggestionLabel, type GeoSuggestion } from '@shared/weather';

import { FieldTrough, TextField } from '@/components/form';
import { Glass, GlassField } from '@/components/glass-auth';
import { PaperInput } from '@/components/polar-ui';
import { Polar, PolarFonts } from '@/constants/polar';
import { Colors } from '@/constants/theme';

/**
 * A city search that resolves to a `HomeCity`. Used by the welcome (as glass over its photograph,
 * `tone="glass"`, sign-in's capsule field) and by the Profile tab (on Polar paper, `tone="paper"`).
 *
 * `onPick(null)` means the text was edited after a pick, so the picked city no longer matches what
 * the field says. The welcome clears its answer on that; Profile ignores it and keeps the saved city.
 */
export function HomeCitySearch({ value, onPick, tone = 'app' }: { value: HomeCity | null; onPick: (home: HomeCity | null) => void; tone?: 'app' | 'paper' | 'glass' }) {
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

  if (tone === 'glass') {
    const hits = searching ? results : [];
    return (
      <>
        <GlassField icon="magnifyingglass" value={query} onChangeText={edit} placeholder="Search your city" autoCorrect={false} returnKeyType="search" accessibilityLabel="Home city" />
        {hits.length ? (
          <Glass style={styles.glassList}>
            {hits.map((r, i) => (
              <Pressable
                key={`${r.lat},${r.lon}`}
                accessibilityRole="button"
                accessibilityLabel={suggestionLabel(r)}
                style={({ pressed }) => [styles.glassResult, i > 0 && styles.glassRule, pressed && styles.glassPressed]}
                onPress={() => {
                  setQuery(r.name);
                  setResults([]);
                  onPick({ name: r.name, latitude: r.lat, longitude: r.lon });
                }}>
                <Text style={styles.glassCity}>{r.name}</Text>
                <Text style={styles.glassRegion} numberOfLines={1}>
                  {suggestionLabel(r).replace(`${r.name}, `, '')}
                </Text>
              </Pressable>
            ))}
          </Glass>
        ) : null}
      </>
    );
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
  glassList: { borderRadius: 20, overflow: 'hidden' },
  glassResult: { minHeight: 50, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  glassRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.18)' },
  glassPressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  glassCity: { fontSize: 16, fontWeight: '600', color: Polar.ice },
  glassRegion: { flexShrink: 1, fontSize: 13, color: Polar.frost68 },
});
