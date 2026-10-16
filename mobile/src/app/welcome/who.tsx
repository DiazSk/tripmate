import { router } from 'expo-router';
import { View } from 'react-native';

import { GROUP_CHOICES } from '@shared/travelCard';

import { SignalCapsule } from '@/components/glass-auth';
import { GlassChoice, WelcomeFrame, welcomeGlass } from '@/components/welcome-frame';
import { useWelcome } from '@/lib/welcomeDraft';

export default function WelcomeWho() {
  const { answers, set, react, save, busy, guard } = useWelcome();
  const next = () =>
    guard(async () => {
      if (!answers.group) return;
      await save();
      router.push('/welcome/rhythm');
    });
  return (
    <WelcomeFrame step="who" title="Who's coming with you?" cta={<SignalCapsule title="Continue" busy={busy} disabled={!answers.group} onPress={next} />}>
      <View style={welcomeGlass.grid} accessibilityRole="radiogroup" accessibilityLabel="Who usually comes along">
        {GROUP_CHOICES.map((g) => (
          <GlassChoice
            key={g.id}
            title={g.title}
            hint={g.hint}
            on={answers.group === g.id}
            onPress={() => {
              set({ group: g.id });
              react(g.line);
            }}
          />
        ))}
      </View>
    </WelcomeFrame>
  );
}
