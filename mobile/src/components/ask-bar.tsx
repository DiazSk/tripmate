import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActionSheetIOS,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { BlurView } from '@/components/blur';
import { SymbolView } from '@/components/symbol';
import type { ChatTurn } from '@/api/types';
import { Meridian } from '@/components/meridian';
import { ThemedText, TextInput } from '@/components/themed-text';
import { Colors, ControlShadow, FontScale, Motion, Radius, Spacing } from '@/constants/theme';
import { formatDayChip } from '@/lib/dayDisplay';
import type { ItineraryDiff } from '@/lib/itineraryDiff';
import { meriForChat } from '@/lib/meri';
import { formatMoney } from '@/lib/spend';

/**
 * Ask for a change, in the toolbar's own place.
 *
 * **One slot at the thumb, three faces.** The trip's toolbar already owns the foot of the screen,
 * so asking does not add a second bar under it or a sheet over the day: Ask opens the toolbar into
 * this box, a proposal turns the box into the decision, and Apply or Keep folds it back into the
 * toolbar. What the proposal would do is drawn on the day above (`proposalRows`), not listed here,
 * so the one thing this bar has to say about it is a sentence and two buttons.
 *
 * **The box changes shape at the second line rather than squeezing the text.** One line keeps the
 * scope inside the field; past it the text takes the full width and the controls drop beneath it,
 * and at five lines it stops growing and scrolls inside itself so the day it is about stays in
 * view. Expand opens the long-form writer for anything bigger. Return is a line break: Send is
 * the button, because a request with several clauses wants line breaks more than a keystroke.
 */
export function AskBar({
  mode,
  draft,
  onDraft,
  scope,
  onScope,
  currentDay,
  days,
  replying,
  failure,
  asked,
  reply,
  turns,
  onHistory,
  pending,
  applying,
  onApply,
  onKeep,
  onSend,
  onClose,
  onHeight,
}: {
  mode: 'ask' | 'decide';
  draft: string;
  onDraft: (text: string) => void;
  /** A day index, or null for the whole trip — what the next message may change. */
  scope: number | null;
  onScope: (scope: number | null) => void;
  /** The day on screen: what the narrow half of the scope names. */
  currentDay: number;
  days: { date: string }[];
  replying: boolean;
  failure: string | null;
  /** The message in flight, for "Working on". */
  asked: string | null;
  /** The planner's latest answer since the box opened, or null. */
  reply: ChatTurn | null;
  turns: number;
  onHistory: () => void;
  pending: ItineraryDiff | null;
  applying: boolean;
  onApply: () => void;
  onKeep: () => void;
  onSend: (text: string) => void;
  onClose: () => void;
  onHeight: (height: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const rest = Math.max(insets.bottom - 6, Spacing.tight);
  const lift = useKeyboardLift(rest);
  const dock = useAnimatedStyle(() => ({ bottom: lift.value }));
  const [writing, setWriting] = useState(false);
  const ready = draft.trim().length > 0 && !replying;

  function chooseScope() {
    const narrow = dayName(days, currentDay);
    const pick = (i: number) => onScope(i === 0 ? null : currentDay);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'What this can change',
          options: ['Whole trip', narrow, 'Cancel'],
          cancelButtonIndex: 2,
        },
        (i) => i < 2 && pick(i),
      );
    } else {
      Alert.alert('What this can change', undefined, [
        { text: 'Whole trip', onPress: () => pick(0) },
        { text: narrow, onPress: () => pick(1) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }
  const scopeLabel = scope === null ? 'Whole trip' : `Day ${scope + 1}`;
  const scopePill = (
    <Pressable
      onPress={chooseScope}
      accessibilityRole="button"
      accessibilityLabel={`Changing: ${scope === null ? 'the whole trip' : dayName(days, scope)}. Choose what this can change.`}
      style={({ pressed }) => [styles.scope, pressed && styles.pressed]}>
      <ThemedText type="detail" maxFontSizeMultiplier={FontScale.chrome} style={styles.scopeText}>
        {scopeLabel}
      </ThemedText>
      <SymbolView name={{ ios: 'chevron.down', android: 'expand_more' }} tintColor={Colors.muted} size={10} />
    </Pressable>
  );

  const showReply = !replying && (failure || reply);
  const ideas = mode === 'ask' && !draft && !replying && !showReply;

  // `accessibilityLiveRegion` is Android's; VoiceOver has to be told.
  useEffect(() => {
    if (replying && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility('Working on your change');
  }, [replying]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.dock, dock]}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height + rest)}>
      {showReply ? (
        <Glass solid style={styles.reply}>
          <Meridian state={meriForChat({ replying, failure, justReplied: false })} size={28} />
          <View style={styles.grow}>
            {failure ? (
              <ThemedText type="detail" themeColor="alert">
                {failure}
              </ThemedText>
            ) : reply ? (
              <>
                {/* Three lines: the whole answer is a tap away, and a reply that covers the day it
                    describes has defeated the point of drawing the change on the day. */}
                <ThemedText type="detail" numberOfLines={3}>
                  {reply.content}
                </ThemedText>
                {reply.warnings?.map((warning, i) => (
                  <ThemedText key={i} type="caption" themeColor="alert" numberOfLines={2}>
                    {warning}
                  </ThemedText>
                ))}
                {reply.rejected?.map((reason, i) => (
                  <ThemedText key={i} type="caption" themeColor="muted" numberOfLines={2}>
                    Not applied: {reason}
                  </ThemedText>
                ))}
              </>
            ) : null}
            {pending ? <Summary diff={pending} /> : null}
            {turns > 1 ? (
              <Pressable onPress={onHistory} accessibilityRole="button" hitSlop={8} style={styles.history}>
                <ThemedText type="caption" themeColor="muted" style={styles.strong}>
                  {`${turns} messages`}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </Glass>
      ) : null}

      {ideas ? <Ideas ideas={ideasFor(currentDay)} onSend={onSend} /> : null}

      {replying ? (
        /* **In flight, the box and the status are one object.** It was a status card floating over
           the composer — two shadows, two radii, an 8pt gap the day showed through, and the whole
           request quoted into a two-line ellipsis — above a field that could not be typed in anyway
           while the reply was out. Now the composer itself turns into the status, at the field's own
           height and radius: Meri where the scope sat, a short line of what is happening, the
           request on one line under it, and the same way out the × always offered. */
        <Animated.View entering={FadeIn.duration(Motion.respond)}>
          <Glass solid style={styles.working}>
            <Meridian state={meriForChat({ replying, failure: null, justReplied: false })} size={28} />
            <View
              style={styles.grow}
              accessible
              accessibilityRole="text"
              accessibilityLiveRegion="polite"
              accessibilityLabel={asked ? `Working on your change: ${asked}` : 'Working on your change'}>
              <ThemedText type="detail" style={styles.strong} numberOfLines={2}>
                Working on your change…
              </ThemedText>
              {asked ? (
                <ThemedText type="caption" themeColor="muted" numberOfLines={1}>
                  {`“${asked.replace(/\s+/g, ' ').trim()}”`}
                </ThemedText>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Hide. Your change keeps working"
              hitSlop={6}
              style={({ pressed }) => [styles.workingClose, pressed && styles.pressed]}>
              <SymbolView name={{ ios: 'xmark', android: 'close' }} tintColor={Colors.foreground} size={13} />
            </Pressable>
          </Glass>
        </Animated.View>
      ) : mode === 'decide' && pending ? (
        <Animated.View entering={FadeIn.duration(Motion.respond)}>
          <Glass style={styles.decide}>
            <Pressable
              onPress={onKeep}
              disabled={applying}
              accessibilityRole="button"
              accessibilityLabel="Keep the current plan"
              style={({ pressed }) => [styles.keep, pressed && styles.pressed]}>
              <ThemedText type="headingSmall">Keep</ThemedText>
            </Pressable>
            <Pressable
              onPress={onApply}
              disabled={applying}
              accessibilityRole="button"
              style={({ pressed }) => [styles.apply, (pressed || applying) && styles.pressed]}>
              <ThemedText type="headingSmall" themeColor="accentForeground">
                {applying ? 'Applying…' : 'Apply changes'}
              </ThemedText>
            </Pressable>
          </Glass>
        </Animated.View>
      ) : (
        <Animated.View entering={FadeIn.duration(Motion.respond)} style={styles.askRow}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close, back to the toolbar">
            <Glass solid style={styles.close}>
              <SymbolView name={{ ios: 'xmark', android: 'close' }} tintColor={Colors.foreground} size={15} />
            </Glass>
          </Pressable>
          <Field
            draft={draft}
            onDraft={onDraft}
            ready={ready}
            disabled={replying}
            scopePill={scopePill}
            onSend={() => onSend(draft)}
            onExpand={() => {
              Keyboard.dismiss();
              setWriting(true);
            }}
          />
        </Animated.View>
      )}

      <Writer
        visible={writing}
        draft={draft}
        onDraft={onDraft}
        scope={scope}
        onScope={onScope}
        currentDay={currentDay}
        days={days}
        ready={ready}
        onCancel={() => setWriting(false)}
        onSend={() => {
          setWriting(false);
          onSend(draft);
        }}
      />
    </Animated.View>
  );
}

/** "2 changes · spend unchanged · nothing booked moves", and the one line that is never quiet. */
function Summary({ diff }: { diff: ItineraryDiff }) {
  const count = diff.stops.length;
  const spend = diff.spendBefore === diff.spendAfter ? 'spend unchanged' : `${formatMoney(diff.spendAfter)} in all`;
  return (
    <>
      <ThemedText type="caption" themeColor="muted">
        {[
          count ? `${count} ${count === 1 ? 'change' : 'changes'}` : 'Only what things cost',
          spend,
          diff.lockedTouched.length ? null : 'nothing booked moves',
        ]
          .filter(Boolean)
          .join(' · ')}
      </ThemedText>
      {/* The booked promise broken is the one consequence on this card, so it is coral and a
          sentence of its own rather than a clause that reads past. */}
      {diff.lockedTouched.length ? (
        <ThemedText type="caption" themeColor="alert">
          {`${diff.lockedTouched.join(', ')} ${diff.lockedTouched.length === 1 ? 'is' : 'are'} booked and would move`}
        </ThemedText>
      ) : null}
    </>
  );
}

function Field({
  draft,
  onDraft,
  ready,
  disabled,
  scopePill,
  onSend,
  onExpand,
}: {
  draft: string;
  onDraft: (text: string) => void;
  ready: boolean;
  disabled: boolean;
  scopePill: React.ReactNode;
  onSend: () => void;
  onExpand: () => void;
}) {
  /** Held until the box is empty again, so the layout cannot flip back and forth at the wrap. */
  const [tall, tallen] = useState(false);
  const big = tall && draft.length > 0;

  const send = (
    <Pressable
      onPress={onSend}
      disabled={!ready}
      accessibilityRole="button"
      accessibilityLabel="Send"
      style={({ pressed }) => [styles.send, !ready && styles.sendOff, pressed && styles.pressed]}>
      <SymbolView
        name={{ ios: 'arrow.up', android: 'arrow_upward' }}
        tintColor={ready ? Colors.accentForeground : Colors.muted}
        size={15}
        weight="bold"
      />
    </Pressable>
  );

  return (
    <Glass solid style={[styles.field, big && styles.fieldTall]}>
      {big ? null : scopePill}
      <TextInput
        value={draft}
        onChangeText={(text) => {
          onDraft(text);
          if (!text) tallen(false);
        }}
        onContentSizeChange={(event) => {
          if (!tall && event.nativeEvent.contentSize.height > LINE * 1.5) tallen(true);
        }}
        autoFocus
        multiline
        editable={!disabled}
        // Short and fixed. Beside the scope it has about eighteen characters before it wraps, and
        // the range of what to ask is what the ideas above the box are for.
        placeholder="Ask for a change"
        placeholderTextColor={Colors.muted}
        selectionColor={Colors.accent}
        maxFontSizeMultiplier={1.6}
        accessibilityLabel="What would you like changed?"
        style={[styles.input, big && styles.inputTall]}
      />
      {big ? (
        <View style={styles.foot}>
          {scopePill}
          <View style={styles.grow} />
          <Pressable
            onPress={onExpand}
            accessibilityRole="button"
            accessibilityLabel="Write it full screen"
            style={({ pressed }) => [styles.expand, pressed && styles.pressed]}>
            <SymbolView
              name={{
                ios: 'arrow.up.left.and.arrow.down.right',
                android: 'open_in_full',
              }}
              tintColor={Colors.foreground}
              size={14}
            />
          </Pressable>
          {send}
        </View>
      ) : (
        send
      )}
    </Glass>
  );
}

/**
 * The long-form writer, for a request that outgrows five lines.
 *
 * A page sheet, as the add-place and cost sheets are, so it arrives the way every sheet here does.
 * The words are the box's own `draft` — Cancel is not a discard, it puts them back at the thumb.
 *
 * **Padded by the keyboard's own height, not a `KeyboardAvoidingView`.** The sheet opens with the
 * field focused, and the avoiding view measured itself before the sheet had finished arriving, so
 * it lifted nothing and the foot sat behind the keyboard. A page sheet's foot is the screen's, so
 * the keyboard's height is exactly the room to give back — the same signal the bar lifts on.
 */
function Writer({
  visible,
  draft,
  onDraft,
  scope,
  onScope,
  currentDay,
  days,
  ready,
  onCancel,
  onSend,
}: {
  visible: boolean;
  draft: string;
  onDraft: (text: string) => void;
  scope: number | null;
  onScope: (scope: number | null) => void;
  currentDay: number;
  days: { date: string }[];
  ready: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    // Android resizes the window for the keyboard itself.
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={[styles.sheet, { paddingBottom: keyboard }]}>
        <View style={styles.writerHead}>
          <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={10} style={styles.writerSide}>
            <ThemedText type="body" themeColor="muted">
              Cancel
            </ThemedText>
          </Pressable>
          <ThemedText type="headingSmall">Ask your TripMate</ThemedText>
          <View style={[styles.writerSide, styles.writerRight]}>
            <Pressable
              onPress={onSend}
              disabled={!ready}
              accessibilityRole="button"
              style={({ pressed }) => [styles.writerSend, !ready && styles.sendOff, pressed && styles.pressed]}>
              <ThemedText type="headingSmall" themeColor={ready ? 'accentForeground' : 'muted'}>
                Send
              </ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={styles.writerScope}>
          <View style={styles.toggle} accessibilityRole="radiogroup">
            {[currentDay, null].map((value) => {
              const on = scope === value;
              return (
                <Pressable
                  key={String(value)}
                  onPress={() => onScope(value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={[styles.half, on && styles.halfOn]}>
                  <ThemedText
                    type="detail"
                    numberOfLines={1}
                    style={[
                      styles.strong,
                      {
                        color: on ? Colors.accentForeground : Colors.foreground,
                      },
                    ]}>
                    {value === null ? 'Whole trip' : dayName(days, value)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <ThemedText type="caption" themeColor="muted">
            {scope === null ? 'Any day can change.' : `Only ${dayName(days, scope)} can change.`}
          </ThemedText>
        </View>

        <TextInput
          value={draft}
          onChangeText={onDraft}
          autoFocus
          multiline
          placeholder="Everything you would like changed, in as many words as it takes."
          placeholderTextColor={Colors.muted}
          selectionColor={Colors.accent}
          maxFontSizeMultiplier={1.6}
          accessibilityLabel="What would you like changed?"
          style={styles.writerInput}
        />

        <View style={styles.writerFoot}>
          <ThemedText type="caption" themeColor="muted" style={styles.grow}>
            Nothing changes until you have seen what would and said yes.
          </ThemedText>
          {words ? (
            <ThemedText type="caption" themeColor="muted">
              {`${words} ${words === 1 ? 'word' : 'words'}`}
            </ThemedText>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/**
 * The toolbar's material: Liquid Glass where the system has it, the chrome blur where not.
 *
 * `solid` for what sits over the day's own text — the reply, the box, the × beside it and the
 * ideas. Over a list of other
 * sentences, glass let the stops behind read straight through the words, and a tint laid over it
 * did not help: the glass draws its lensing above its siblings. The controls stay glass, as the
 * toolbar's do; what you read and write sits on the slate.
 */
function Glass({
  style,
  solid,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  solid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.glass, ControlShadow, solid && styles.solid, style]}>
      {solid ? null : isLiquidGlassAvailable() ? (
        <GlassView glassEffectStyle="regular" colorScheme="dark" isInteractive style={StyleSheet.absoluteFill} />
      ) : (
        <BlurView intensity={80} tint="systemChromeMaterialDark" style={StyleSheet.absoluteFill} />
      )}
      {children}
    </View>
  );
}

/**
 * How far the bar sits off the bottom: the toolbar's own rest, or the keyboard's top.
 *
 * iOS only, on the keyboard's own timing. Android resizes the window for the keyboard itself
 * (`softwareKeyboardLayoutMode` is `resize`), so lifting there as well would count it twice.
 */
function useKeyboardLift(rest: number) {
  const lift = useSharedValue(rest);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      lift.value = withTiming(e.endCoordinates.height + Spacing.tight, {
        duration: e.duration || Motion.respond,
      });
    });
    const hide = Keyboard.addListener('keyboardWillHide', (e) => {
      lift.value = withTiming(rest, { duration: e.duration || Motion.respond });
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [lift, rest]);
  return lift;
}

const dayName = (days: { date: string }[], index: number) => {
  const chip = formatDayChip(days[index]?.date ?? '');
  return chip ? `Day ${index + 1} · ${chip.weekday} ${chip.dayOfMonth}` : `Day ${index + 1}`;
};

/** Sent as they are on a tap — each is a whole request, and each exercises a different thing the
 *  planner already does: pace, a gap, a what-if, a shift. */
const ideasFor = (day: number) => [
  `Day ${day + 1} has too much walking`,
  'Find dinner near the last stop',
  'What if it rains?',
  'Push everything an hour later',
];

const LINE = 22;

/**
 * The suggestions, a row that runs off the right edge — with a fade there while more is to the
 * right, so the clipped chip reads as "scroll" rather than as a chip cut in half. The fade goes
 * when the row reaches its end, which is the cue that there is nothing more.
 */
function Ideas({ ideas, onSend }: { ideas: string[]; onSend: (text: string) => void }) {
  const [width, setWidth] = useState(0);
  const [content, setContent] = useState(0);
  const [x, setX] = useState(0);
  const more = content > width && x + width < content - 4;
  return (
    <View style={styles.ideasScroll}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onContentSizeChange={(w) => setContent(w)}
        onScroll={(e) => setX(e.nativeEvent.contentOffset.x)}
        contentContainerStyle={styles.ideas}>
        {ideas.map((idea) => (
          <Pressable
            key={idea}
            onPress={() => onSend(idea)}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}>
            <Glass solid style={styles.idea}>
              <ThemedText type="detail" maxFontSizeMultiplier={FontScale.chrome}>
                {idea}
              </ThemedText>
            </Glass>
          </Pressable>
        ))}
      </ScrollView>
      {more ? (
        <Svg pointerEvents="none" width={IDEAS_FADE} height="100%" style={styles.ideasFade}>
          <Defs>
            <LinearGradient id="ideas-fade" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={Colors.canvas} stopOpacity={0} />
              <Stop offset="1" stopColor={Colors.canvas} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#ideas-fade)" />
        </Svg>
      ) : null}
    </View>
  );
}

const IDEAS_FADE = 40;

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: Spacing.read,
    right: Spacing.read,
    gap: Spacing.tight,
  },
  glass: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  solid: { backgroundColor: Colors.surfaceDeep },
  grow: { flex: 1 },
  strong: { fontWeight: '600' },
  pressed: { opacity: 0.7 },

  reply: {
    flexDirection: 'row',
    gap: Spacing.tight + 2,
    padding: Spacing.rows,
    borderRadius: 22,
  },
  history: { alignSelf: 'flex-start', marginTop: 2 },
  // The field's own geometry — `minHeight` 50, radius 25 — so the box reads as the same object
  // changing state. Meri's 28pt mark and the 36pt × sit centred in the end caps.
  working: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight + 2,
    minHeight: 50,
    paddingVertical: Spacing.tight,
    paddingLeft: 11,
    paddingRight: 7,
    borderRadius: 25,
  },
  workingClose: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${Colors.foreground}1F`,
  },

  // Out to the screen's edges, so a chip scrolls off the side rather than stopping at the gutter.
  ideasScroll: { marginHorizontal: -Spacing.read },
  ideas: { gap: Spacing.tight, paddingHorizontal: Spacing.read },
  ideasFade: { position: 'absolute', right: 0, top: 0, bottom: 0 },
  idea: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.pill,
  },

  askRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.tight },
  close: {
    width: 50,
    height: 50,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    minHeight: 50,
    paddingVertical: 3,
    paddingLeft: 6,
    paddingRight: 6,
    borderRadius: 25,
  },
  fieldTall: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
    paddingTop: 10,
    paddingBottom: 6,
    paddingLeft: Spacing.read,
    borderRadius: 24,
  },
  input: {
    flex: 1,
    color: Colors.foreground,
    fontSize: 16,
    lineHeight: LINE,
    paddingTop: 11,
    paddingBottom: 11,
    // Five lines, then it scrolls inside itself.
    maxHeight: LINE * 5 + 22,
  },
  inputTall: {
    flex: 0,
    paddingTop: 0,
    paddingBottom: 2,
    paddingRight: Spacing.tight,
    maxHeight: LINE * 5,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    marginLeft: -10,
  },
  scope: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingVertical: 6,
    paddingHorizontal: Spacing.rows,
    borderRadius: Radius.pill,
    backgroundColor: `${Colors.foreground}1F`,
  },
  scopeText: { fontWeight: '600', color: Colors.foreground },
  expand: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${Colors.foreground}1F`,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
  },
  sendOff: { backgroundColor: `${Colors.foreground}1F` },

  decide: {
    flexDirection: 'row',
    gap: 6,
    padding: 6,
    borderRadius: Radius.pill,
  },
  keep: {
    minHeight: 44,
    paddingVertical: 6,
    paddingHorizontal: Spacing.regular,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${Colors.foreground}1F`,
  },
  apply: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
  },

  sheet: { flex: 1, backgroundColor: Colors.surfaceDeep },
  writerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.read,
    paddingBottom: Spacing.rows,
  },
  writerSide: { flex: 1 },
  writerRight: { alignItems: 'flex-end' },
  writerSend: {
    minHeight: 34,
    paddingVertical: 6,
    paddingHorizontal: Spacing.read,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    backgroundColor: Colors.accent,
  },
  writerScope: {
    gap: 6,
    paddingHorizontal: Spacing.read,
    paddingBottom: Spacing.rows,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.cardBorder,
  },
  toggle: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
  },
  half: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: Spacing.tight,
    borderRadius: Radius.pill,
  },
  halfOn: { backgroundColor: Colors.foreground },
  writerInput: {
    flex: 1,
    padding: Spacing.read,
    color: Colors.foreground,
    fontSize: 18,
    lineHeight: 26,
    textAlignVertical: 'top',
  },
  writerFoot: {
    flexDirection: 'row',
    gap: Spacing.rows,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.cardBorder,
  },
});
