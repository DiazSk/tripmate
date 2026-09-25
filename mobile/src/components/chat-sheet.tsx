import { useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

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
}: {
  visible: boolean;
  onClose: () => void;
  turns: ChatTurn[];
  replying: boolean;
  /** The last turn that did not happen, or null. Shown at the foot, where the reply would be. */
  failure: string | null;
  /** Resolves false when the turn failed, which is what keeps the draft. */
  onSend: (text: string) => Promise<boolean>;
  /** Seeds the composer on open — e.g. "Fit it anyway" from the anchor receipt. Never auto-sent:
   *  the traveler still has to press Send. **The caller must remount this component (a `key` that
   *  changes per open) for a new seed to take** — a plain `useState(initialDraft ?? '')` default
   *  only runs once, so without a remount a second "Fit it anyway" for a different place would
   *  leave the first place's text sitting in the composer. */
  initialDraft?: string;
}) {
  const [draft, setDraft] = useState(initialDraft ?? '');
  const transcript = useRef<ScrollView>(null);

  // Any content change, not just a new turn: the keyboard appearing and the composer growing to a
  // third line both push the last bubble above the fold, and neither is a turn.
  const toEnd = () => transcript.current?.scrollToEnd({ animated: true });

  async function send() {
    const body = draft.trim();
    if (!body || replying) return;
    if (await onSend(body)) setDraft('');
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheet}
        // Height on Android, where the window resizes itself and padding would double-count it.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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

        <ScrollView
          ref={transcript}
          contentContainerStyle={styles.transcript}
          onContentSizeChange={toEnd}
          keyboardShouldPersistTaps="handled">
          {turns.length === 0 ? <Invitation /> : null}
          {turns.map((turn, i) => (
            <Turn key={i} turn={turn} />
          ))}
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
    </Modal>
  );
}

/** Says what this can do, since an empty chat box asks a question it does not answer. */
function Invitation() {
  return (
    <View style={styles.invitation}>
      <ThemedText type="detail" themeColor="muted">
        Ask for as many changes as you like in one go — swap a stop, move one to another day, make
        a day quieter, add a day. The whole plan is in scope.
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
