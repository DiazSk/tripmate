import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { dietLine, loveLine, MAX_LOVES } from '@shared/travelCard';

import { PillButton, PrimaryButton, Question } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Colors } from '@/constants/theme';
import { DIETARY_TAGS, INTERESTS } from '@/lib/planDraft';
import { useWelcome } from '@/lib/welcomeDraft';

export default function WelcomeMatters() {
  const { answers, set, react, quiet, save, busy, guard } = useWelcome();
  const next = () => guard(async () => { await save(); router.push('/welcome/home'); });
  return (
    <WelcomeFrame step="matters" cta={<PrimaryButton title="Continue" disabled={!answers.loves.length} busy={busy} onPress={next} />}>
      <ThemedText type="display">What matters most?</ThemedText>
      <Question title={`Pick up to three · ${answers.loves.length} of ${MAX_LOVES}`}>
        <View style={styles.chips}>
          {INTERESTS.map((tag) => {
            const at = answers.loves.indexOf(tag);
            return (
              <PillButton key={tag} compact tone={at >= 0 ? 'accent' : 'muted'} accessibilityLabel={`${tag}, ${at >= 0 ? 'picked' : 'not picked'}`} style={at >= 0 ? styles.on : undefined} title={at >= 0 ? `${at + 1}  ${tag}` : tag}
                onPress={() => {
                  if (at >= 0) return set({ loves: answers.loves.filter((l) => l !== tag) });
                  if (answers.loves.length >= MAX_LOVES) return quiet('Three is the limit. Tap one to swap it out.');
                  const loves = [...answers.loves, tag];
                  set({ loves });
                  react(loveLine(loves, tag));
                }} />
            );
          })}
        </View>
      </Question>
      <Question title="How you eat">
        <View style={styles.chips}>
          {DIETARY_TAGS.map((tag) => {
            const on = answers.diet.includes(tag);
            return <PillButton key={tag} compact tone={on ? 'accent' : 'muted'} accessibilityLabel={`${tag}, ${on ? 'picked' : 'not picked'}`} style={on ? styles.on : undefined} title={tag} onPress={() => { set({ diet: on ? answers.diet.filter((d) => d !== tag) : [...answers.diet, tag] }); if (!on) react(dietLine(tag)); }} />;
          })}
        </View>
      </Question>
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  on: { borderColor: Colors.accent },
});
