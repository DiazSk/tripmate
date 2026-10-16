import { router } from 'expo-router';
import { View } from 'react-native';

import { dietLine, loveLine, MAX_LOVES } from '@shared/travelCard';

import { SignalCapsule } from '@/components/glass-auth';
import { GlassChip, GlassHeading, WelcomeFrame, welcomeGlass } from '@/components/welcome-frame';
import { DIETARY_TAGS, INTERESTS } from '@/lib/planDraft';
import { useWelcome } from '@/lib/welcomeDraft';

export default function WelcomeMatters() {
  const { answers, set, react, quiet, save, busy, guard } = useWelcome();
  const next = () =>
    guard(async () => {
      if (!answers.loves.length) return;
      await save();
      router.push('/welcome/home');
    });
  return (
    <WelcomeFrame step="matters" title="What matters most?" cta={<SignalCapsule title="Continue" busy={busy} disabled={!answers.loves.length} onPress={next} />}>
      <GlassHeading>{`Pick up to three · ${answers.loves.length} of ${MAX_LOVES}`}</GlassHeading>
      <View style={welcomeGlass.chips}>
        {INTERESTS.map((tag) => {
          const at = answers.loves.indexOf(tag);
          return (
            <GlassChip
              key={tag}
              title={tag}
              on={at >= 0}
              badge={at + 1}
              accessibilityLabel={`${tag}, ${at >= 0 ? `pick ${at + 1}` : 'not picked'}`}
              onPress={() => {
                if (at >= 0) return set({ loves: answers.loves.filter((l) => l !== tag) });
                if (answers.loves.length >= MAX_LOVES) return quiet('Three is the limit. Tap one to swap it out.');
                const loves = [...answers.loves, tag];
                set({ loves });
                react(loveLine(loves, tag));
              }}
            />
          );
        })}
      </View>
      <GlassHeading>How you eat</GlassHeading>
      <View style={welcomeGlass.chips}>
        {DIETARY_TAGS.map((tag) => {
          const on = answers.diet.includes(tag);
          return (
            <GlassChip
              key={tag}
              title={tag}
              on={on}
              tick
              accessibilityLabel={`${tag}, ${on ? 'picked' : 'not picked'}`}
              onPress={() => {
                set({ diet: on ? answers.diet.filter((d) => d !== tag) : [...answers.diet, tag] });
                if (!on) react(dietLine(tag));
              }}
            />
          );
        })}
      </View>
    </WelcomeFrame>
  );
}
