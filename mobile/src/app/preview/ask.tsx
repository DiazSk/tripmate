import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChatTurn, DayPlan, Itinerary, Stop } from '@/api/types';
import { AskBar } from '@/components/ask-bar';
import { ChatSheet } from '@/components/chat-sheet';
import { DayPage } from '@/components/day-page';
import { TripToolbar } from '@/components/trip-toolbar';
import { Colors, Spacing } from '@/constants/theme';
import { diffItineraries } from '@/lib/itineraryDiff';
import { proposalRows } from '@/lib/proposalRows';

/**
 * Asking for a change, with no planner behind it. **`__DEV__` only**, like `preview/writing.tsx`:
 * the real trip screen sends to `/api/trip-edit`, which is a model call and writes the turn to the
 * trip's transcript. `tripmate://preview/ask` plays it: Ask opens the toolbar into the box, any
 * message comes back after a beat with Nahargarh moved to Day 4 and the Hawa Mahal later, drawn on
 * the day, and Apply or Keep folds it back. The pill makes the next send fail.
 */
const stop = (name: string, time: string, note: string, fixed = false): Stop => ({
  name,
  lat: 26.92,
  lng: 75.82,
  cost: 12,
  note,
  time,
  durationLabel: '1 hour',
  category: 'entry',
  ...(fixed ? { timeFlexibility: 'FIXED' as const } : {}),
});
const day = (date: string, theme: string, stops: Stop[]): DayPlan => ({ date, weather: 'Clear, 17 to 29°', theme, stops });
const BEFORE: Itinerary = {
  days: [
    day('2026-11-06', 'Arrival and the old city', [stop('Johari Bazaar at dusk', '5:00 PM', 'Gem and textile lanes')]),
    day('2026-11-07', 'Forts above the city', [
      stop('Amber Fort', '9:00 AM', 'Ganesh Pol and the Sheesh Mahal', true),
      stop('Lunch at Peacock Rooftop', '12:30 PM', 'Thalis, a view of the Hawa Mahal'),
      stop('Hawa Mahal', '2:30 PM', 'Climb to the top screens'),
      stop('Nahargarh Fort at sunset', '4:45 PM', 'Sunset 5:34 PM'),
      stop('Dinner at Chokhi Dhani', '8:00 PM', 'Book ahead on Fridays', true),
    ]),
    day('2026-11-08', 'Stepwells and gardens', [stop('Jal Mahal', '10:00 AM', 'From the lake promenade'), stop('Sisodia Rani Garden', '1:00 PM', 'Terraced Mughal garden')]),
  ],
};
const AFTER: Itinerary = {
  days: [
    BEFORE.days[0],
    { ...BEFORE.days[1], stops: BEFORE.days[1].stops.filter((s) => !s.name.startsWith('Nahargarh')).map((s) => (s.name === 'Hawa Mahal' ? { ...s, time: '3:00 PM' } : s)) },
    { ...BEFORE.days[2], stops: [BEFORE.days[2].stops[0], { ...BEFORE.days[1].stops[3], time: '11:00 AM' }, BEFORE.days[2].stops[1]] },
  ],
};
const DIFF = diffItineraries(BEFORE, AFTER);
const REPLY =
  'Day 2 had you on your feet from Amber Fort to Nahargarh. I moved Nahargarh to Sunday morning, a short drive from Jal Mahal, and gave the Hawa Mahal the afternoon to itself, so you are back at the haveli by four.';
const dayName = (i: number) => `Day ${i + 1}`;

export default function AskPreview() {
  const [plan, setPlan] = useState(BEFORE);
  const [d, setD] = useState(1);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<number | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [openedAt, setOpenedAt] = useState(0);
  const [replying, setReplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [undo, setUndo] = useState(false);
  const [fail, setFail] = useState(false);
  const [history, setHistory] = useState(false);
  const [footer, setFooter] = useState(0);
  if (!__DEV__) return null;

  const since = turns.slice(openedAt);
  const reply = [...since].reverse().find((t) => t.role === 'assistant') ?? null;
  function send(text: string) {
    const body = text.trim();
    if (!body || replying) return;
    setTurns((t) => [...t, { role: 'user', content: body, scope }]);
    setDraft('');
    setReplying(true);
    setFailure(null);
    setUndo(false);
    setTimeout(() => {
      setReplying(false);
      if (fail) {
        setTurns((t) => t.slice(0, -1));
        setDraft(body);
        setFailure("That didn't reach the planner. Check your connection and try again.");
        return;
      }
      setTurns((t) => [...t, { role: 'assistant', content: REPLY, warnings: ['In the morning, Nahargarh trades the sunset for an empty fort.'] }]);
      setPending(true);
      setD(1);
    }, 2200);
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Jaipur', headerBackButtonDisplayMode: 'minimal' }} />
      <DayPage
        day={plan.days[d]}
        dayIndex={d}
        dayCount={plan.days.length}
        destination="Jaipur, India"
        emphasis={null}
        onEmphasise={() => {}}
        onFindNearby={() => {}}
        findings={[]}
        onSetCost={() => {}}
        onBudget={() => {}}
        footer={footer}
        offline={false}
        onAsk={() => {}}
        repairs={() => []}
        onRepair={() => {}}
        preview={pending && DIFF.days.includes(d) ? { rows: proposalRows(plan.days[d], AFTER.days[d], d, DIFF), dayName } : null}
      />
      <View style={styles.days}>
        {plan.days.map((_, i) => (
          <Pressable key={i} onPress={() => setD(i)} style={[styles.dayPill, i === d && styles.dayOn]}>
            <Text style={[styles.dayText, i === d && styles.dayTextOn]}>{`Day ${i + 1}${pending && DIFF.days.includes(i) ? ' •' : ''}`}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setFail(!fail)} style={[styles.dayPill, fail && styles.dayOn]}>
          <Text style={[styles.dayText, fail && styles.dayTextOn]}>Fail next</Text>
        </Pressable>
      </View>

      {open || pending ? (
        <AskBar
          mode={pending ? 'decide' : 'ask'}
          draft={draft}
          onDraft={setDraft}
          scope={scope}
          onScope={setScope}
          currentDay={d}
          days={plan.days}
          replying={replying}
          failure={failure}
          asked={replying ? (since.at(-1)?.content ?? null) : null}
          reply={reply}
          turns={turns.length}
          onHistory={() => setHistory(true)}
          pending={pending ? DIFF : null}
          applying={applying}
          onApply={() => {
            setApplying(true);
            setTimeout(() => {
              setPlan(AFTER);
              setPending(false);
              setApplying(false);
              setOpen(false);
              setUndo(true);
            }, 700);
          }}
          onKeep={() => {
            setPending(false);
            setOpen(false);
          }}
          onSend={send}
          onClose={() => setOpen(false)}
          onHeight={setFooter}
        />
      ) : (
        <>
          {undo ? (
            <Pressable onPress={() => { setPlan(BEFORE); setUndo(false); }} style={[styles.undo, { bottom: footer + Spacing.tight }]}>
              <Text style={styles.dayText}>Days 2 and 3 updated · Undo</Text>
            </Pressable>
          ) : null}
          <TripToolbar
            face="list"
            onFace={() => {}}
            canPlay
            onPlay={() => {}}
            offline={false}
            onAsk={() => {
              setOpenedAt(turns.length);
              setFailure(null);
              setOpen(true);
            }}
            onAdd={() => {}}
            spent={1240}
            budget={1800}
            onBudget={() => {}}
            onHeight={setFooter}
          />
        </>
      )}
      <ChatSheet visible={history} onClose={() => setHistory(false)} turns={turns} replying={replying} failure={failure} days={plan.days} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  days: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 4 },
  dayPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: '#0E1118CC' },
  dayOn: { backgroundColor: Colors.foreground },
  dayText: { color: Colors.foreground, fontSize: 12, fontWeight: '600' },
  dayTextOn: { color: Colors.canvas },
  undo: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: Colors.surfaceDeep },
});
