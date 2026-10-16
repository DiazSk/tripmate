import { router } from 'expo-router';

import { homeLine } from '@shared/travelCard';

import { SignalCapsule } from '@/components/glass-auth';
import { HomeCitySearch } from '@/components/home-city-search';
import { WelcomeFrame } from '@/components/welcome-frame';
import { useWelcome } from '@/lib/welcomeDraft';

export default function WelcomeHome() {
  const { answers, set, react, save, complete, busy, guard } = useWelcome();
  const finish = () =>
    guard(async () => {
      await save();
      await complete(false);
      router.push('/welcome/ready');
    });
  return (
    <WelcomeFrame step="home" title="Where's home?" cta={<SignalCapsule title={answers.home ? 'Finish my card' : 'Skip this one'} busy={busy} onPress={finish} />}>
      <HomeCitySearch
        tone="glass"
        value={answers.home}
        onPick={(home) => {
          set({ home });
          if (home) react(homeLine(home.name));
        }}
      />
    </WelcomeFrame>
  );
}
