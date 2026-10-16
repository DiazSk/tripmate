import { useRouter } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsColors } from '@/components/settings-list';
import { Polar, PolarFonts } from '@/constants/polar';
import { METHOD } from '@/lib/method';

/**
 * How TripMate plans, as the canvas design "Phone how it works · 1": Apple's "What's New" sheet,
 * risen over Home from its widget of the same name. Four rows, each with a glyph, the sources in a
 * line under them, and Plan a trip at the foot.
 *
 * **One ScrollView as the root, buttons at its foot.** A ScrollView beside a fixed footer drew nothing
 * inside a native form sheet here (the sheet sized it and its content never painted), which is why
 * `share-sheet.tsx` is a root ScrollView too. A growing spacer keeps the buttons at the foot when the
 * steps are short and at least 32pt below the last one when large text makes them long.
 */

/** One glyph per step, in `METHOD`'s order: the constraints, the data, the critique, the pins. */
const GLYPHS: { name: SymbolViewProps['name']; tint: string }[] = [
  { name: { ios: 'slider.horizontal.3', android: 'tune' }, tint: Polar.signal },
  { name: { ios: 'cloud.sun', android: 'partly_cloudy_day' }, tint: '#2F6BC2' },
  { name: { ios: 'pencil.and.list.clipboard', android: 'edit_note' }, tint: '#6E4FBF' },
  { name: { ios: 'mappin.and.ellipse', android: 'where_to_vote' }, tint: '#1F7A70' },
];

export default function HowItWorks() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.sheet}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) }]}
      showsVerticalScrollIndicator={false}>
      <Text style={styles.title} accessibilityRole="header">
        How TripMate plans
      </Text>
      <View style={styles.rows}>
        {METHOD.map((m, i) => (
          <Animated.View
            key={m.number}
            entering={FadeInDown.duration(420).delay(80 + i * 60)}
            style={styles.row}
            accessible
            accessibilityLabel={`Step ${i + 1}. ${m.title}. ${m.prose}`}>
            <View style={styles.glyph}>
              <SymbolView name={GLYPHS[i].name} size={30} tintColor={GLYPHS[i].tint} weight="medium" />
            </View>
            <View style={styles.text}>
              <Text style={styles.rowTitle}>{m.title}</Text>
              <Text style={styles.prose}>{m.prose}</Text>
            </View>
          </Animated.View>
        ))}
      </View>
      <Text style={styles.sources}>
        Forecasts from Open-Meteo, holidays from Nager.Date, places and hours from OpenStreetMap.
      </Text>
      <View style={styles.spacer} />
      <View style={styles.foot}>
        <Pressable
          onPress={() => router.replace('/plan/basics')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}>
          <Text style={styles.primaryText}>Plan a trip</Text>
        </Pressable>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}>
          <Text style={styles.quietText}>Not now</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: SettingsColors.ground },
  // flexGrow, so a short list leaves the buttons at the sheet's foot and a long one scrolls them in after.
  content: { flexGrow: 1, paddingTop: 44, paddingHorizontal: 32 },
  title: { fontFamily: PolarFonts.display, fontSize: 38, lineHeight: 40, textAlign: 'center', color: Polar.ink },
  rows: { gap: 26, marginTop: 32 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  glyph: { width: 40, alignItems: 'center', paddingTop: 2 },
  text: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#000' },
  prose: { fontSize: 15, lineHeight: 21, color: '#636366' },
  sources: { marginTop: 32, fontSize: 12, lineHeight: 17, textAlign: 'center', color: '#636366' },
  // The least room between the last step and the buttons, at any text size: this, then the gap above.
  spacer: { flexGrow: 1, minHeight: 32 },
  foot: { gap: 4, marginHorizontal: -8 },
  primary: {
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Polar.signal,
  },
  primaryPressed: { backgroundColor: Polar.signalPressed },
  primaryText: { fontSize: 17, fontWeight: '600', color: Polar.ink },
  quiet: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  quietText: { fontSize: 16, fontWeight: '600', color: Polar.ember },
  pressed: { opacity: 0.6 },
});
