import { useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { ChatTurn } from '@/api/types';
import { SheetDone } from '@/components/budget-sheet';
import { Meridian } from '@/components/meridian';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDayChip } from '@/lib/dayDisplay';
import { meriForChat } from '@/lib/meri';

/**
 * The whole conversation, read back.
 *
 * **Asking moved to the toolbar's own place (`AskBar`), and this is what stayed.** The bar shows
 * the latest answer in three lines because the day it describes is above it; this is where the
 * rest of that answer lives, and the turns before it. So it is read-only: one place to write,
 * and it is at the thumb.
 *
 * The body of the `trip/[id]/chat` form-sheet route, at the same detents as Budget and Add a stop
 * (see `lib/tripSheets.ts` for why the trip's sheets are routes rather than RN Modals).
 */
export function ChatSheet({
  onClose,
  turns,
  replying,
  failure,
  days,
}: {
  onClose: () => void;
  turns: ChatTurn[];
  replying: boolean;
  /** The last turn that did not happen, or null. Shown at the foot, where the reply would be. */
  failure: string | null;
  /** The trip's dates, for naming the day a narrowed turn was scoped to. */
  days: { date: string }[];
}) {
  const transcript = useRef<ScrollView>(null);
  return (
    <>
      {/* Two children, header then the ScrollView, and the header not flattened: that is the
          shape react-native-screens' form sheet sizes to the detent (`RNSScreenContentWrapper`
          coerces a ScrollView at index 0 or 1 and gives up past two siblings). A wrapping View,
          or a header flattened into its Text and Pressable, left the ScrollView at the sheet's
          top, over the title and over Done. */}
      <View collapsable={false} style={styles.bar}>
        <Meridian state={meriForChat({ replying, failure, justReplied: false })} size={36} />
        <View style={styles.grow}>
          <ThemedText type="headingSmall" numberOfLines={1}>
            Your TripMate
          </ThemedText>
          <ThemedText type="caption" themeColor="muted">
            {replying ? 'Replying' : `${turns.length} ${turns.length === 1 ? 'message' : 'messages'}`}
          </ThemedText>
        </View>
        <SheetDone onPress={onClose} />
      </View>

      <ScrollView
        ref={transcript}
        contentContainerStyle={styles.transcript}
        onContentSizeChange={() => transcript.current?.scrollToEnd({ animated: false })}>
        {turns.map((turn, i) => (
          <Turn key={i} turn={turn} days={days} />
        ))}
        {failure ? (
          <ThemedText type="detail" style={styles.failure}>
            {failure}
          </ThemedText>
        ) : null}
      </ScrollView>
    </>
  );
}

const dayName = (days: { date: string }[], index: number) => {
  const chip = formatDayChip(days[index]?.date ?? '');
  return chip ? `Day ${index + 1} · ${chip.weekday} ${chip.dayOfMonth}` : `Day ${index + 1}`;
};

function Turn({ turn, days }: { turn: ChatTurn; days: { date: string }[] }) {
  const mine = turn.role === 'user';
  return (
    <View style={[styles.turn, mine ? styles.mine : styles.theirs]}>
      {/* **The scope belongs to the turn, not to the control.** The toggle above says what the
          *next* message will carry; it is live, and widening it after a narrow ask left the
          refusal underneath reading as though the assistant had ignored a scope that was never
          in force. Stamping the request it answered is what makes "day 2 is outside my current
          scope" legible an hour later.

          Only a narrowed turn is stamped. Wide is this sheet's default and the case that needs
          no explanation, and a WHOLE TRIP label over every message is a line nobody reads twice.
          `undefined` — a turn saved before the transcript carried this — prints nothing either,
          because the honest thing to say about it is nothing. */}
      {mine && typeof turn.scope === 'number' ? (
        <ThemedText type="micro" themeColor="muted" style={styles.stamp}>
          {dayName(days, turn.scope).toUpperCase()}
        </ThemedText>
      ) : null}
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
  stamp: { marginBottom: Spacing.hair, marginRight: 2 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.read,
    paddingBottom: Spacing.tight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.cardBorder,
  },
  grow: { flex: 1 },
  transcript: { padding: Spacing.read, gap: Spacing.rows },
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
});
