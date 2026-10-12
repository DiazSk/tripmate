import { router } from 'expo-router';
import { Text } from 'react-native';

import { firstName, welcomeSummary } from '@shared/travelCard';

import { PillButton, PrimaryButton } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Colors, Fonts } from '@/constants/theme';
import { useWelcome } from '@/lib/welcomeDraft';

export default function WelcomeReady() {
  const { answers, unsaved } = useWelcome();
  return (
    <WelcomeFrame step="ready" cta={<>
      <PrimaryButton title="Plan a trip" onPress={() => router.replace('/plan/basics')} />
      <PillButton title="I already have a plan" block onPress={() => router.replace('/plan/own')} />
    </>}>
      <ThemedText type="display">All set, {firstName(answers.name)}.</ThemedText>
      <Text style={{ fontFamily: Fonts.display, fontSize: 22, lineHeight: 30, color: Colors.foreground }}>{welcomeSummary(answers)}</Text>
      {unsaved ? <Text accessibilityRole="alert" style={{ color: Colors.alert, fontSize: 14 }}>Some answers didn&apos;t save. You can finish them on your Profile.</Text> : null}
    </WelcomeFrame>
  );
}
