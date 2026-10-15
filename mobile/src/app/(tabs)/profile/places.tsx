import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Footer, Group, RowIcon, Separator, SettingsColors } from '@/components/settings-list';
import { Polar } from '@/constants/polar';
import { useProfileStore } from '@/lib/profileStore';

/** The places you saved from the map, for a trip you have not planned yet. */
export default function Places() {
  const { places } = useProfileStore();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Group>
        {places.map((p, i) => (
          <View key={p.id}>
            {i ? <Separator /> : null}
            <View style={styles.row}>
              <RowIcon name="mappin" tint={Polar.signal} />
              <View style={styles.text}>
                <Text style={styles.name}>{p.name}</Text>
                {p.city ? <Text style={styles.city}>{p.city}</Text> : null}
              </View>
            </View>
          </View>
        ))}
      </Group>
      <Footer>Places you saved from the map, for a trip you haven’t planned yet.</Footer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 8 },
  text: { flex: 1, gap: 1 },
  name: { fontSize: 16, fontWeight: '500', color: '#000' },
  city: { fontSize: 13, color: SettingsColors.grey },
});
