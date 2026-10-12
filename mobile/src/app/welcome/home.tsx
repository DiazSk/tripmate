import { router } from 'expo-router';

import { homeLine } from '@shared/travelCard';

import { PrimaryButton } from '@/components/form';
import { HomeCitySearch } from '@/components/home-city-search';
import { ThemedText } from '@/components/themed-text';
import { WelcomeFrame } from '@/components/welcome-frame';
import { useWelcome } from '@/lib/welcomeDraft';

export default function WelcomeHome() {
  const { answers, set, react, save, complete, busy, guard } = useWelcome();
  const finish = () => guard(async () => {
    await save();
    await complete(false);
    router.push('/welcome/ready');
  });
  return (
    <WelcomeFrame step="home" cta={<PrimaryButton title={answers.home ? 'Finish my card' : 'Skip this one'} busy={busy} onPress={finish} />}>
      <ThemedText type="display">Where&apos;s home?</ThemedText>
      <ThemedText type="detail" themeColor="muted">It helps with travel times and the best months to go.</ThemedText>
      <HomeCitySearch value={answers.home} onPick={(home) => { set({ home }); if (home) react(homeLine(home.name)); }} />
    </WelcomeFrame>
  );
}
