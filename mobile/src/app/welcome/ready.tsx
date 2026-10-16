import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { firstName, welcomeSummary } from '@shared/travelCard';

import { GlassButton, SignalCapsule } from '@/components/glass-auth';
import { TravelCard } from '@/components/travel-card';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Polar, PolarFonts } from '@/constants/polar';
import { useWelcome } from '@/lib/welcomeDraft';

/** The card, handed over whole: it rises into place with its stamps, then the two ways on. */
export default function WelcomeReady() {
  const { answers, image, issued, unsaved } = useWelcome();
  return (
    <WelcomeFrame
      step="ready"
      title={`All set, ${firstName(answers.name)}.`}
      cta={
        <>
          <SignalCapsule title="Plan a trip" onPress={() => router.replace('/plan/basics')} />
          <GlassButton title="I already have a plan" onPress={() => router.replace('/plan/own')} />
        </>
      }>
      <Animated.View entering={FadeInDown.duration(700).springify().damping(16).reduceMotion(ReduceMotion.System)}>
        <TravelCard answers={answers} image={image} issued={issued} complete />
      </Animated.View>
      <Text style={styles.summary}>{welcomeSummary(answers)}</Text>
      {unsaved ? (
        <Text accessibilityRole="alert" style={styles.alert}>
          Some answers didn&apos;t save. You can finish them on your Profile.
        </Text>
      ) : null}
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  summary: { fontFamily: PolarFonts.display, fontSize: 24, lineHeight: 30, color: Polar.ice },
  alert: { fontSize: 14, color: Polar.alertNight },
});
