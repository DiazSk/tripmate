import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Polar, PolarFonts } from '@/constants/polar';
import { METHOD } from '@/lib/method';

/** How TripMate plans, pushed from Home's widget of the same name (`lib/method.ts`). */
const GROUND = '#F2F2F7';

export default function HowItWorks() {
  return (
    <ScrollView style={styles.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: 'How It Works',
          headerBackTitle: 'Home',
          headerTintColor: Polar.ember,
          headerTitleStyle: { color: '#000' },
          headerStyle: { backgroundColor: GROUND },
          contentStyle: { backgroundColor: GROUND },
        }}
      />
      <View style={styles.group}>
        {METHOD.map((m, i) => (
          <View key={m.number} style={[styles.step, i > 0 && styles.ruled]}>
            <Text style={styles.number}>{m.number}</Text>
            <View style={styles.text}>
              <Text style={styles.title}>{m.title}</Text>
              <Text style={styles.prose}>{m.prose}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: GROUND },
  content: { padding: 16, paddingBottom: 60 },
  group: { overflow: 'hidden', borderRadius: 12, backgroundColor: '#fff' },
  step: { flexDirection: 'row', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(60,60,67,0.22)' },
  number: { fontFamily: PolarFonts.condensed, fontSize: 22, lineHeight: 26, color: Polar.ember, fontVariant: ['tabular-nums'] },
  text: { flex: 1, gap: 3 },
  title: { fontSize: 17, fontWeight: '600', color: '#000' },
  prose: { fontSize: 15, lineHeight: 21, color: 'rgba(60,60,67,0.6)' },
});
