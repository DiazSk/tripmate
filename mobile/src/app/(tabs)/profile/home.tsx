import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SymbolView } from '@/components/symbol';
import { HomeCitySearch } from '@/components/home-city-search';
import { Footer, Group, RowIcon } from '@/components/settings-list';
import { Polar } from '@/constants/polar';
import { useProfileStore } from '@/lib/profileStore';

/** Where you usually set off from. It goes on the passport, and it helps with travel times. */
export default function Home() {
  const { profile, edit } = useProfileStore();
  if (!profile) return null;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Footer>Where you usually set off from. It helps with travel times and the best months to go.</Footer>
      {profile.homeCity ? (
        <Group>
          <View style={styles.row}>
            <RowIcon name="mappin" tint={Polar.signal} />
            <Text style={styles.name} numberOfLines={1}>
              {profile.homeCity.name}
            </Text>
            <SymbolView name="checkmark" size={16} tintColor={Polar.ember} weight="semibold" />
          </View>
        </Group>
      ) : null}
      <View style={styles.search}>
        {/* Only a real pick saves. A null is the search saying the text moved off the picked city;
            that must not clear the saved one, or typing in the box would wipe it. */}
        <HomeCitySearch tone="paper" value={profile.homeCity ?? null} onPick={(homeCity) => homeCity && edit({ homeCity })} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 30, paddingBottom: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingLeft: 16, paddingRight: 14 },
  name: { flex: 1, fontSize: 17, color: '#000' },
  search: { marginHorizontal: 16 },
});
