import { ScrollView, StyleSheet, View } from 'react-native';

import { CheckRow, Footer, Group, Header, Separator, SettingsColors } from '@/components/settings-list';
import { Polar } from '@/constants/polar';
import { DIETARY_TAGS, toggleTag } from '@/lib/planDraft';
import { useProfileStore } from '@/lib/profileStore';
import { TextInput } from '@/components/themed-text';

/** Dietary needs: applied to every food stop on every trip, so a check here is a hard rule. */
export default function Dietary() {
  const { profile, edit } = useProfileStore();
  if (!profile) return null;
  const { dietary } = profile;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Footer>Applied to every food stop on every trip. Leave it empty if nothing applies.</Footer>
      <Group>
        {DIETARY_TAGS.map((tag, i) => (
          <View key={tag}>
            {i ? <Separator inset={48} /> : null}
            <CheckRow label={tag} on={dietary.tags.includes(tag)} onPress={() => edit({ dietary: { ...dietary, tags: toggleTag(dietary.tags, tag) } })} />
          </View>
        ))}
      </Group>
      <Header>Anything else</Header>
      <Group>
        <TextInput
          value={dietary.note}
          onChangeText={(note) => edit({ dietary: { ...dietary, note } })}
          placeholder="An allergy, a dislike, a rule you keep"
          placeholderTextColor={SettingsColors.faint}
          selectionColor={Polar.ember}
          keyboardAppearance="light"
          returnKeyType="done"
          style={styles.input}
          accessibilityLabel="Anything else about food"
        />
      </Group>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 30, paddingBottom: 60 },
  input: { minHeight: 48, paddingHorizontal: 16, fontSize: 17, color: '#000' },
});
