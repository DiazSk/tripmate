import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import type { ChatTurn } from '@/api/types';
import { ChangePreview } from '@/components/change-preview';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDayChip } from '@/lib/dayDisplay';
import type { ItineraryDiff } from '@/lib/itineraryDiff';

/**
 * Ask the planner for a change.
 *
 * **The sheet holds the text; the screen holds the conversation.** Everything here is a prop
 * except `draft`, which is the one piece of state whose lifetime is this surface — and clearing it
 * is the one thing that has to wait for the send to succeed, so a failed turn does not make
 * somebody retype what they said.
 *
 * `presentationStyle="pageSheet"` and `animationType="slide"` match `add-place-sheet.tsx` and
 * `field-sheet.tsx`, so all three sheets in this app arrive the same way. It does not reuse
 * `FieldSheet` because that shell scrolls everything it is given, and a composer has to stay put
 * under the keyboard while the transcript scrolls behind it.
 */
export function ChatSheet({
  visible,
  onClose,
  turns,
  replying,
  failure,
  onSend,
  initialDraft,
  days,
  initialScope,
  pending,
  applying,
  onApply,
  onDiscard,
}: {
  visible: boolean;
  onClose: () => void;
  turns: ChatTurn[];
  replying: boolean;
  /** The last turn that did not happen, or null. Shown at the foot, where the reply would be. */
  failure: string | null;
  /** Resolves false when the turn failed, which is what keeps the draft. */
  onSend: (text: string, dayIndex?: number) => Promise<boolean>;
  /** Seeds the composer on open — e.g. "Fit it anyway" from the anchor receipt. Never auto-sent:
   *  the traveler still has to press Send. **The caller must remount this component (a `key` that
   *  changes per open) for a new seed to take** — a plain `useState(initialDraft ?? '')` default
   *  only runs once, so without a remount a second "Fit it anyway" for a different place would
   *  leave the first place's text sitting in the composer. */
  initialDraft?: string;
  /** The trip's dates, for naming a day in the scope control. */
  days: { date: string }[];
  /** The scope to open on: a day index, or null for the whole trip. Seeded openings that name a
   *  day — a leg that does not fit, a stop somebody pressed "Fix this" on — arrive with theirs. */
  initialScope?: number | null;
  /** What the last reply would do to the plan, or null when there is nothing to approve.
   *  The plan itself does not move until `onApply` — see `useChat.send`. */
  pending: ItineraryDiff | null;
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const [draft, setDraft] = useState(initialDraft ?? '');
  /**
   * What this turn is allowed to change: one day, or the whole trip.
   *
   * **Whole trip is the default, and that is a decision rather than an omission.** The Swift app
   * scope-locked every conversation to whatever day was on screen, so "move the market to day 3"
   * came back refused with nothing having said it would be; this app then sent no scope at all
   * for the same reason. What was missing was never the lock — it was saying which one you were
   * getting. So the scope is stated before you ask, it starts wide, and narrowing it is a thing
   * you do rather than a side effect of where you were standing.
   *
   * Per turn, not per conversation: the prompt carries the scope on every message, so widening
   * it after a narrow answer costs nothing and needs no new session.
   */
  const [scope, setScope] = useState<number | null>(initialScope ?? null);
  const transcript = useRef<ScrollView>(null);

  /**
   * How far down the screen this sheet starts — and without it the composer sits **behind the
   * keyboard**, which made this screen unusable by touch: you could not see what you were
   * typing and Send could not be pressed.
   *
   * `KeyboardAvoidingView` lifts by `frame.y + frame.height - keyboardScreenY`, and its frame
   * comes from its own `onLayout` — which is relative to this modal, not the screen. A
   * `pageSheet` is inset from the top, so its height is short by that inset and every lift is
   * short by the same amount. The keyboard's `screenY`, meanwhile, is in screen coordinates.
   * Handing the inset back as `keyboardVerticalOffset` puts the two in the same frame again.
   *
   * Measured rather than hardcoded: the inset differs per device, and it is zero for a
   * full-screen presentation, where this correctly becomes a no-op.
   */
  const [sheetHeight, setSheetHeight] = useState(0);
  const inset = sheetHeight ? Math.max(0, Dimensions.get('screen').height - sheetHeight) : 0;

  // Any content change, not just a new turn: the keyboard appearing and the composer growing to a
  // third line both push the last bubble above the fold, and neither is a turn.
  const toEnd = () => transcript.current?.scrollToEnd({ animated: true });

  async function send() {
    const body = draft.trim();
    if (!body || replying) return;
    if (await onSend(body, scope ?? undefined)) setDraft('');
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      {/* The measurement lives on a wrapper, not on the KeyboardAvoidingView: that component
          reads its own `onLayout`, and passing one through would replace the handler it
          depends on. */}
      <View style={styles.sheet} onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}>
      <KeyboardAvoidingView
        style={styles.sheet}
        // Height on Android, where the window resizes itself and padding would double-count it.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={inset}>
        <View style={styles.bar}>
          <ThemedText type="title" numberOfLines={1} style={styles.grow}>
            Ask for a change
          </ThemedText>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <ThemedText type="label" themeColor="muted">
              Done
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.scopeRow}>
          <ThemedText type="label" themeColor="muted">
            Change
          </ThemedText>
          <View style={styles.toggle}>
            <ScopeHalf
              label={dayName(days, dayOf(initialScope, scope))}
              on={scope !== null}
              onPress={() => setScope(dayOf(initialScope, scope))}
            />
            <ScopeHalf label="Whole trip" on={scope === null} onPress={() => setScope(null)} />
          </View>
        </View>

        <ScrollView
          ref={transcript}
          contentContainerStyle={styles.transcript}
          onContentSizeChange={toEnd}
          keyboardShouldPersistTaps="handled">
          {turns.length === 0 ? <Invitation /> : null}
          {turns.map((turn, i) => (
            <Turn key={i} turn={turn} />
          ))}
          {/* Under the last turn, which is always the reply it belongs to: there is only
              ever one parked proposal, and a newer ask replaces it. */}
          {pending ? (
            <ChangePreview diff={pending} onApply={onApply} onDiscard={onDiscard} busy={applying} />
          ) : null}
          {replying ? (
            <View style={styles.thinking}>
              {/* A spinner with no denominator, next to the word, because the wait is a model
                  thinking and nothing here knows how long that is. */}
              <ActivityIndicator color={Colors.muted} />
              <ThemedText type="detail" themeColor="muted">
                Thinking…
              </ThemedText>
            </View>
          ) : null}
          {failure ? (
            <ThemedText type="detail" style={styles.failure}>
              {failure}
            </ThemedText>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Move the market to day 3, and drop the museum"
            placeholderTextColor={Colors.muted}
            selectionColor={Colors.accent}
            // The cap every `ThemedText` gets, which a bare TextInput does not inherit.
            maxFontSizeMultiplier={1.6}
            multiline
            // Send is a button, not the return key: a multi-clause request wants line breaks more
            // than it wants one keystroke saved.
            style={styles.input}
            editable={!replying}
            accessibilityLabel="What would you like changed?"
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim() || replying}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => [
              styles.send,
              (!draft.trim() || replying) && styles.sendOff,
              pressed && styles.sendPressed,
            ]}>
            <ThemedText type="label" themeColor="accentForeground">
              Send
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/**
 * Which day the narrow half means.
 *
 * The current scope while there is one, else the day the sheet was opened about, else the first
 * — so the half always names a real day and pressing it never has to ask which.
 */
const dayOf = (initial: number | null | undefined, scope: number | null) => scope ?? initial ?? 0;

const dayName = (days: { date: string }[], index: number) => {
  const chip = formatDayChip(days[index]?.date ?? '');
  return chip ? `Day ${index + 1} · ${chip.weekday} ${chip.dayOfMonth}` : `Day ${index + 1}`;
};

/**
 * **The chosen half has to be obvious, and a darker slate on a slate is not.** This borrowed the
 * List/Map toggle's look, where the active half is `surfaceDeep` on a `control` track — two
 * alphas of the same colour, which reads as one flat bar with a faint seam and leaves somebody
 * about to change their trip unsure what they are about to change.
 *
 * So it takes the wizard's answer instead: `accentWash` and a jade tick are what every
 * single-select in this app already means by "this one". Jade at 9% rather than filled keeps
 * the One Meaning Rule intact — the strong colour still belongs to Send.
 */
function ScopeHalf({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.toggleHalf, on && styles.toggleHalfActive]}>
      {on ? (
        <ThemedText type="label" themeColor="accent">
          ✓
        </ThemedText>
      ) : null}
      <ThemedText type="label" themeColor={on ? 'foreground' : 'muted'} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Says what this can do, since an empty chat box asks a question it does not answer. */
function Invitation() {
  return (
    <View style={styles.invitation}>
      <ThemedText type="detail" themeColor="muted">
        Ask for as many changes as you like in one go — swap a stop, move one to another day, make
        a day quieter, add a day. Nothing changes until you have seen what would change and said
        yes, and whatever is not in scope above cannot be touched at all.
      </ThemedText>
    </View>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  const mine = turn.role === 'user';
  return (
    <View style={[styles.turn, mine ? styles.mine : styles.theirs]}>
      <View style={[styles.bubble, mine && styles.bubbleMine]}>
        <ThemedText type="body" themeColor={mine ? 'accentForeground' : 'foreground'}>
          {turn.content}
        </ThemedText>
      </View>
      {/* Held out of the reply rather than folded into it: these are the model flagging what the
          change it just made costs, and a caveat that reads as conversation gets skimmed. */}
      {turn.warnings?.map((warning, i) => (
        <ThemedText key={i} type="detail" style={styles.warning}>
          {warning}
        </ThemedText>
      ))}
      {/* Silence here would read as "done" for a turn that partly wasn't. */}
      {turn.rejected?.map((reason, i) => (
        <ThemedText key={i} type="detail" themeColor="muted">
          Not applied: {reason}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.canvas },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.read,
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.read,
    paddingBottom: Spacing.tight,
  },
  grow: { flex: 1 },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.rows,
    paddingHorizontal: Spacing.read,
    paddingBottom: Spacing.tight,
  },
  // The two-up pill the trip screen's List/Map toggle uses, so the two read as one control type.
  toggle: {
    flexDirection: 'row',
    flex: 1,
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
    padding: 3,
    gap: 2,
  },
  toggleHalf: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.hair,
    paddingVertical: 7,
    paddingHorizontal: Spacing.tight,
    borderRadius: Radius.pill,
  },
  toggleHalfActive: { backgroundColor: Colors.accentWash },

  transcript: { padding: Spacing.read, gap: Spacing.rows },
  invitation: { paddingVertical: Spacing.compact },
  turn: { gap: Spacing.hair, maxWidth: '88%' },
  mine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  bubble: {
    backgroundColor: Colors.surfaceDeep,
    borderColor: Colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.surface,
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.tight,
  },
  bubbleMine: { backgroundColor: Colors.accent, borderColor: 'transparent' },
  warning: { color: Colors.alert },
  failure: { color: Colors.alert },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.tight,
    padding: Spacing.read,
    borderTopColor: Colors.cardBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    color: Colors.foreground,
    fontSize: 16,
    lineHeight: 22,
    backgroundColor: Colors.surfaceDeep,
    borderColor: Colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.surface,
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.tight,
    // A composer that grows to about four lines and then scrolls, rather than one that eats the
    // transcript on a long request.
    maxHeight: 120,
  },
  send: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.rows,
  },
  sendOff: { opacity: 0.4 },
  sendPressed: { opacity: 0.8 },
});
