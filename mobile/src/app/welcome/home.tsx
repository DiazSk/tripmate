import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { homeLine } from '@shared/travelCard';
import { suggestDestinations, suggestionLabel, type GeoSuggestion } from '@shared/weather';

import { FieldTrough, PrimaryButton, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Colors } from '@/constants/theme';
import { useWelcome } from '@/lib/welcomeDraft';

export default function WelcomeHome() {
  const { answers, set, react, save, complete, busy, guard } = useWelcome();
  const [query, setQuery] = useState(answers.home?.name ?? '');
  const [results, setResults] = useState<GeoSuggestion[]>([]);
  const q = query.trim();
  const searching = q.length >= 2 && q !== answers.home?.name;

  useEffect(() => {
    if (!searching) return;
    // `cancelled` is what makes a slow answer to an older query harmless once the text has moved on.
    let cancelled = false;
    const timer = setTimeout(() => {
      suggestDestinations(q, 5).then((r) => { if (!cancelled) setResults(r); }).catch(() => { if (!cancelled) setResults([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, searching]);

  // Editing the text after a pick un-picks the city, so the card never shows a home port the field no longer says.
  function edit(text: string) {
    setQuery(text);
    if (answers.home && text.trim() !== answers.home.name) set({ home: null });
  }

  const finish = () => guard(async () => {
    await save();
    await complete(false);
    router.push('/welcome/ready');
  });
  return (
    <WelcomeFrame step="home" cta={<PrimaryButton title={answers.home ? 'Finish my card' : 'Skip this one'} busy={busy} onPress={finish} />}>
      <ThemedText type="display">Where&apos;s home?</ThemedText>
      <ThemedText type="detail" themeColor="muted">It helps with travel times and the best months to go.</ThemedText>
      <FieldTrough><TextField label="City" value={query} onChangeText={edit} placeholder="Search your city" autoCorrect={false} /></FieldTrough>
      <View>
        {(searching ? results : []).map((r) => (
          <Pressable key={`${r.lat},${r.lon}`} accessibilityRole="button" style={styles.result}
            onPress={() => { const home = { name: r.name, latitude: r.lat, longitude: r.lon }; setQuery(r.name); setResults([]); set({ home }); react(homeLine(r.name)); }}>
            <Text style={styles.city}>{r.name}</Text><Text style={styles.region}>{suggestionLabel(r).replace(`${r.name}, `, '')}</Text>
          </Pressable>
        ))}
      </View>
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  result: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.cardBorder },
  city: { color: Colors.foreground, fontSize: 16 },
  region: { color: Colors.muted, fontSize: 13 },
});
