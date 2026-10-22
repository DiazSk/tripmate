import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { IDEA_MAX_CHARS } from '@shared/ideaRead';

import { Meridian } from '@/components/meridian';
import { SettingsColors } from '@/components/settings-list';
import { SymbolView } from '@/components/symbol';
import { Polar, PolarFonts } from '@/constants/polar';
import { QUICK_PROMPTS, TYPEWRITER_IDEAS, typewriterTick, type Typewriter } from '@/lib/homeIdeas';

const START: Typewriter = { line: 0, chars: 0, phase: 'typing' };
/** Reduce Motion: whole lines, swapped on this beat, never typed. */
const LINE_MS = 3000;
/** The field's line height, before Dynamic Type. */
const LINE = 24;

/**
 * Ask Meri for a trip: the one input on Home (design D, from concept A). A sentence goes to
 * `onSend`; the quick chips only *fill* the field, so a tap never spends a read on words the
 * traveller has not looked at, and Bring my plan is a way out to the importer rather than a prompt.
 *
 * **The placeholder is a `Text` over the field, not `placeholder`.** A native placeholder cannot be
 * animated or carry a caret, and re-setting it 45ms at a time re-lays the input. The overlay is
 * hidden from VoiceOver and TalkBack, which hear the field's own label instead of a sentence that
 * changes under them. It types only while it is the only thing in the box: focus or a character
 * stops it, holding where it was.
 */
export function MeriSearch({
  offline,
  onSend,
  onPlanStepByStep,
  onBringPlan,
  onFocusChange,
}: {
  offline: boolean;
  onSend: (idea: string) => void;
  onPlanStepByStep: () => void;
  onBringPlan: () => void;
  /** For the host to lift the card above the keyboard: the field sits mid-page. */
  onFocusChange?: (focused: boolean) => void;
}) {
  const reduce = useReducedMotion();
  // Three lines at the text size in force (capped as the field's own type is), so the typed example
  // never spills from the box onto the chips at the accessibility sizes.
  const { fontScale } = useWindowDimensions();
  const box = { minHeight: Math.ceil(3 * LINE * Math.min(fontScale, 1.6)) };
  const input = useRef<TextInput>(null);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  // From a send until the screen it opened takes over: cleared when Home loses focus, so coming back
  // finds the box ready rather than still "reading".
  const [sending, setSending] = useState(false);
  // Tab screens stay mounted, so without this the typewriter (and its caret's loop) would keep
  // re-rendering Home every 20-45ms behind Trips, Profile or a pushed trip.
  const [onScreen, setOnScreen] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setOnScreen(true);
      return () => {
        setOnScreen(false);
        setSending(false);
      };
    }, []),
  );

  const [tw, setTw] = useState({ s: START, delay: 500 });
  const running = onScreen && !focused && !text && !sending;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(
      () =>
        setTw(({ s }) => {
          if (reduce) return { s: { ...s, line: (s.line + 1) % TYPEWRITER_IDEAS.length }, delay: LINE_MS };
          const { next, delayMs } = typewriterTick(s, TYPEWRITER_IDEAS);
          return { s: next, delay: delayMs };
        }),
      reduce ? LINE_MS : tw.delay,
    );
    return () => clearTimeout(t);
  }, [running, tw, reduce]);
  const line = TYPEWRITER_IDEAS[tw.s.line];
  // A focused, empty box shows the whole example it stopped on, as a still hint.
  const shown = reduce || focused || sending ? line : line.slice(0, tw.s.chars);
  const caretOn = running && !reduce;

  const idea = text.trim();
  const canSend = idea.length > 0 && !sending;
  const send = () => {
    if (!canSend) return;
    Keyboard.dismiss();
    setSending(true);
    onSend(idea);
  };
  const fill = (prompt: string) => {
    setText(prompt);
    input.current?.focus();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.top}>
          <Meridian state={offline ? 'offline' : sending ? 'thinking' : 'idle'} size={36} />
          <View style={styles.field}>
            <Text maxFontSizeMultiplier={1.6} style={styles.label} accessibilityLiveRegion="polite">
              {sending ? 'Meri is reading your idea…' : 'Ask Meri for a trip'}
            </Text>
            <View>
              <TextInput
                ref={input}
                value={text}
                onChangeText={setText}
                onFocus={() => {
                  setFocused(true);
                  onFocusChange?.(true);
                }}
                onBlur={() => {
                  setFocused(false);
                  onFocusChange?.(false);
                }}
                onSubmitEditing={send}
                submitBehavior="submit"
                returnKeyType="send"
                multiline
                maxLength={IDEA_MAX_CHARS}
                editable={!sending}
                maxFontSizeMultiplier={1.6}
                accessibilityLabel="Ask Meri for a trip"
                accessibilityHint="Describe the trip in your own words, then send"
                selectionColor={Polar.signal}
                style={[styles.input, box]}
              />
              {text ? null : (
                <Text
                  pointerEvents="none"
                  maxFontSizeMultiplier={1.6}
                  style={styles.placeholder}
                  numberOfLines={3}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants">
                  {shown}
                  {caretOn ? <Caret /> : null}
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.chipsScroll} contentContainerStyle={styles.chips}>
            {/* First: Home's only way to the importer, so it must never start off-screen. */}
            <Pressable onPress={onBringPlan} accessibilityRole="button" accessibilityLabel="Bring my plan" style={({ pressed }) => [styles.chip, styles.chipRow, pressed && styles.chipPressed]}>
              <SymbolView name="doc.text" size={13} tintColor={Polar.ember} weight="semibold" />
              <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, styles.chipEmber]}>Bring my plan</Text>
            </Pressable>
            {QUICK_PROMPTS.map((q) => (
              <Pressable
                key={q.label}
                onPress={() => fill(q.text)}
                disabled={sending}
                accessibilityRole="button"
                accessibilityLabel={q.label}
                accessibilityHint="Fills the box with an example you can change"
                style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}>
                <Text maxFontSizeMultiplier={1.3} style={styles.chipText}>{q.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            onPress={send}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send to Meri"
            accessibilityState={{ disabled: !canSend }}
            hitSlop={4}
            style={({ pressed }) => [styles.send, canSend ? styles.sendOn : styles.sendOff, pressed && canSend && styles.sendPressed]}>
            <SymbolView name={{ ios: 'arrow.up', android: 'arrow_upward' }} size={18} tintColor={canSend ? Polar.night : '#8E8E93'} weight="bold" />
          </Pressable>
        </View>
      </View>
      <Pressable onPress={onPlanStepByStep} accessibilityRole="button" hitSlop={4} style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}>
        <Text maxFontSizeMultiplier={1.6} style={styles.stepText}>Plan step by step</Text>
      </Pressable>
    </View>
  );
}

/** The typewriter's caret: on half a second, off half a second, as a text cursor blinks. */
function Caret() {
  const on = useSharedValue(1);
  useEffect(() => {
    on.value = withRepeat(withSequence(withDelay(530, withTiming(0, { duration: 0 })), withDelay(530, withTiming(1, { duration: 0 }))), -1);
    return () => cancelAnimation(on);
  }, [on]);
  const style = useAnimatedStyle(() => ({ opacity: on.value }));
  return <Animated.View style={[styles.caret, style]} />;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16 },
  card: {
    padding: 16,
    borderRadius: 24,
    backgroundColor: Polar.ice,
    shadowColor: Polar.ink,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 3,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  field: { flex: 1, minWidth: 0 },
  label: { paddingTop: 2, fontFamily: PolarFonts.sansSemi, fontSize: 13, lineHeight: 18, color: Polar.ink },
  // Three lines tall, as the design's box: room to write a sentence without the card jumping.
  input: { marginTop: 4, padding: 0, fontFamily: PolarFonts.sansRegular, fontSize: 17, lineHeight: LINE, color: Polar.ink, textAlignVertical: 'top' },
  placeholder: { position: 'absolute', top: 4, left: 0, right: 0, fontFamily: PolarFonts.sansRegular, fontSize: 17, lineHeight: LINE, color: Polar.secondary },
  caret: { width: 2, height: 19, marginLeft: 1, borderRadius: 1, backgroundColor: Polar.signal, transform: [{ translateY: 3 }] },

  actions: { marginTop: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  chipsScroll: { flex: 1, marginLeft: -4 },
  chips: { gap: 6, paddingLeft: 4, paddingRight: 4 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: '#F2F2F7' },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipPressed: { backgroundColor: SettingsColors.pressed },
  chipText: { fontFamily: PolarFonts.sans, fontSize: 13, color: Polar.ink },
  chipEmber: { color: Polar.ember },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendOn: { backgroundColor: Polar.signal },
  sendOff: { backgroundColor: '#ECECF1' },
  sendPressed: { backgroundColor: Polar.signalPressed },

  // QuietLink's look, with the body cap it does not set.
  step: { minHeight: 44, marginTop: 2, marginLeft: 4, justifyContent: 'center', alignSelf: 'flex-start' },
  stepPressed: { opacity: 0.55 },
  stepText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink, textDecorationLine: 'underline' },
});
