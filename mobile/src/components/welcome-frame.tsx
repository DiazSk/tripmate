import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { STEP_LINES, readyLine, type WelcomeStep } from '@shared/travelCard';

import { Meridian } from '@/components/meridian';
import { TravelCard } from '@/components/travel-card';
import { Colors, Spacing } from '@/constants/theme';
import { useWelcome } from '@/lib/welcomeDraft';

const ORDER: WelcomeStep[] = ['welcome', 'you', 'who', 'rhythm', 'matters', 'home', 'ready'];

/**
 * Every welcome page's shell: Back, the five-segment progress, "Skip for now", the travel card strip,
 * your TripMate and its line, then the page and its button. Pages only supply the middle and the CTA.
 */
export function WelcomeFrame({ step, children, cta }: { step: WelcomeStep; children: React.ReactNode; cta: React.ReactNode }) {
  const { answers, image, issued, line: said, lineStep, cheer, save, complete, busy, guard } = useWelcome();
  // The hook, not `SafeAreaView`: inside this fullScreenModal's nested stack the native view measured a
  // top inset of 0 and the bar slid under the status bar. The hook reads the root provider (the window),
  // which is what `signin` already relies on for its bottom inset in the same modal.
  const insets = useSafeAreaInsets();
  const index = ORDER.indexOf(step);
  // A reaction belongs to the page it was said on; the next page opens on its own prompt.
  const line = lineStep === step ? said : null;
  // With the keyboard up the character's row is the first thing to give way, so the field and its results stay in view.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const chrome = step !== 'welcome' && step !== 'ready';

  const skip = () => guard(async () => {
    if (['who', 'rhythm', 'matters', 'home'].includes(step)) await save();
    await complete(true);
    router.push('/welcome/ready');
  });

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View
        style={[styles.top, !chrome && styles.hidden]}
        pointerEvents={chrome ? 'auto' : 'none'}
        accessibilityElementsHidden={!chrome}
        importantForAccessibility={chrome ? 'auto' : 'no-hide-descendants'}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={styles.back} hitSlop={8}>
          <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back' }} tintColor={Colors.foreground} size={15} fallback={<Text style={styles.fallback}>‹</Text>} />
        </Pressable>
        <View style={styles.progress} accessibilityElementsHidden>
          {[1, 2, 3, 4, 5].map((i) => <View key={i} style={[styles.segment, i <= index && styles.segmentDone]} />)}
        </View>
        <Pressable onPress={skip} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }} hitSlop={8}><Text style={styles.skip}>Skip for now</Text></Pressable>
      </View>
      <View style={styles.cardSlot}><TravelCard answers={answers} image={image} issued={issued} complete={step === 'ready'} /></View>
      {step !== 'welcome' && !typing && (
        <View style={styles.host}>
          <Meridian state={cheer ? 'success' : 'idle'} size={52} />
          <Text style={styles.line} accessibilityLiveRegion="polite">{line ?? (step === 'ready' ? readyLine(answers.name) : STEP_LINES[step as keyof typeof STEP_LINES])}</Text>
        </View>
      )}
      <KeyboardAvoidingView style={styles.avoid} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      <View style={styles.cta}>{cta}</View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.read, paddingTop: 6 },
  hidden: { opacity: 0 },
  back: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  fallback: { color: Colors.foreground, fontSize: 20 },
  progress: { flex: 1, flexDirection: 'row', gap: 5 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: Colors.cardBorder },
  segmentDone: { backgroundColor: Colors.accent },
  skip: { color: Colors.muted, fontSize: 13, fontWeight: '600' },
  cardSlot: { paddingHorizontal: Spacing.read, paddingTop: 12 },
  host: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.read, paddingTop: 16 },
  line: { flex: 1, color: Colors.muted, fontSize: 15, lineHeight: 21 },
  avoid: { flex: 1 },
  body: { flex: 1 },
  // Room above and to the sides so the 120pt welcome character's breath, bob and wobble never clip.
  bodyContent: { paddingHorizontal: Spacing.read, paddingTop: 18, paddingBottom: 24, gap: 14 },
  cta: { paddingHorizontal: Spacing.read, paddingBottom: 8, gap: 10 },
});
