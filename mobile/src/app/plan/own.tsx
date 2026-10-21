import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SymbolView } from '@/components/symbol';
import { completePlan, readPlan } from '@/api/tripMateApi';
import type { ImportedPlan, ImportItem } from '@/api/types';
import { ImportComposer } from '@/components/import-composer';
import { DateRow, PlanColors, Section, TextRow } from '@/components/plan-ui';
import { Polar, PolarFonts } from '@/constants/polar';
import { dayDate, forgetPlaces, isFound, looseAnchors, ownPlanGap, renameStop, sourceLines, suggestedStart } from '@/lib/ownPlan';
import { usePlanDraft } from '@/lib/planDraft';
import { summariseUnread } from '@/lib/unreadSummary';

type Status = 'found' | 'missing' | 'later';
const STATUS: Record<Status, string> = {
  found: 'On the map',
  missing: 'Not found on the map. Check the spelling',
  later: 'Looked up when you build',
};

/**
 * Bring your own itinerary, as the canvas design "Phone own plan · 1B Needs a look first" with
 * 1A's line tags. Two steps on one screen, compose then review, so the plan that was read never has
 * to travel between routes. A list of places rather than days goes to the wizard as anchors (the
 * screen shares the plan stack's draft), so nothing read is lost.
 *
 * **The review leads with what went wrong.** Reviewing an import is catching its misses, so a stop
 * that was not found on the map comes first, under "Needs a look", with the field to fix it; the
 * days that read cleanly fold into rows that say so ("3 stops, all on the map") and open on a tap.
 * A plan that read perfectly is a few rows long.
 *
 * **Every stop says which line of your note it came from** (`L9`), and the tag opens the note at
 * that line. The read does not report provenance, so `sourceLines` matches names back to the text,
 * once, at read time; a stop it cannot place, such as one read from a screenshot, has no tag.
 *
 * On the planner's grouped light, as the planner it hands lists to is.
 */
export default function OwnPlan() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { text } = useLocalSearchParams<{ text?: string }>();
  const { patch } = usePlanDraft();
  const [plan, setPlan] = useState<ImportedPlan | null>(null);
  /** The text that was read, for the note sheet, and where each stop sits in it. */
  const [source, setSource] = useState('');
  const [lines, setLines] = useState<(number | null)[][]>([]);
  const [renamed, setRenamed] = useState<ReadonlySet<string>>(new Set());
  // Set once "Where" changes: every stop is then looked up again near the corrected destination.
  const [relocated, setRelocated] = useState(false);
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [noteAt, setNoteAt] = useState<number | null>(null);

  async function read(items: ImportItem[], pasted: string): Promise<boolean> {
    setBusy(true);
    setProblems([]);
    const result = await readPlan(items);
    setBusy(false);
    if (result === undefined) {
      setProblems(["Couldn't read your plan right now."]);
      return false;
    }
    if (typeof result === 'string') {
      setProblems([result]);
      return false;
    }
    if (!result.isPlan) {
      patch({
        anchors: looseAnchors(result),
        ...(result.destinationGuess ? { destination: result.destinationGuess } : {}),
      });
      router.replace('/plan/basics');
      return true;
    }
    setPlan(result);
    setSource(pasted);
    setLines(sourceLines(pasted, result));
    setRenamed(new Set());
    setRelocated(false);
    setOpen(new Set());
    setDestination(result.destinationGuess ?? '');
    setStartDate(suggestedStart(result));
    // Said once each — four unreadable screenshots are one line with a count, not four lines.
    setProblems([...result.notes, ...summariseUnread(result.unread.map((u) => u.reason))]);
    return true;
  }

  function startOver() {
    setPlan(null);
    setProblems([]);
  }

  function changeDestination(value: string) {
    setDestination(value);
    if (plan && !relocated) {
      setPlan(forgetPlaces(plan));
      setRelocated(true);
    }
  }

  function rename(d: number, s: number, name: string) {
    if (!plan) return;
    setPlan(renameStop(plan, d, s, name));
    setRenamed((prev) => new Set(prev).add(`${d}-${s}`));
  }

  /**
   * **Nothing placed at all is the map lookup being down, not six misspellings.** The lookup runs
   * on a shared Overpass instance that turns busy callers away, and the read then hands back every
   * stop unplaced. Telling somebody to check the spelling of "Time Out Market" would be wrong, and
   * the build looks every unplaced stop up again anyway, so the whole plan reads as "looked up when
   * you build" instead.
   */
  const unchecked = !!plan && plan.days.some((day) => day.stops.length > 0) && plan.days.every((day) => day.stops.every((stop) => !isFound(stop)));

  function status(d: number, s: number): Status {
    if (relocated || unchecked || renamed.has(`${d}-${s}`)) return 'later';
    return plan && isFound(plan.days[d].stops[s]) ? 'found' : 'missing';
  }

  async function build() {
    if (!plan || busy) return;
    const gap = ownPlanGap(plan, destination, startDate);
    if (gap) {
      setProblems([gap]);
      return;
    }
    setBusy(true);
    setProblems([]);
    const amount = Number(budget);
    const result = await completePlan({
      plan,
      destination: destination.trim(),
      startDate,
      ...(amount > 0 ? { budget: amount } : {}),
    });
    setBusy(false);
    if (result === undefined) {
      setProblems(["Couldn't build your trip right now."]);
      return;
    }
    if (typeof result === 'string') {
      setProblems([result]);
      return;
    }
    router.replace(`/trip/${result.id}`);
  }

  const header = (
    <Stack.Screen
      options={{
        // No bar title: the page's own large heading names it, and two stacked titles read as one
        // said twice. The bar keeps only its controls.
        title: '',
        headerRight: plan
          ? () => (
              <Pressable onPress={startOver} accessibilityRole="button" hitSlop={10}>
                <Text style={styles.headerLink}>Start over</Text>
              </Pressable>
            )
          : undefined,
      }}
    />
  );

  if (plan === null) {
    return (
      <ScrollView
        style={styles.screen}
        // `flexGrow` so the docked Read my plan sits at the foot of a short page, at the thumb.
        contentContainerStyle={[styles.content, styles.compose, { paddingBottom: Math.max(insets.bottom, 12) }]}
        keyboardShouldPersistTaps="handled">
        {header}
        <Text style={styles.title}>Bring your plan</Text>
        <Text style={styles.sub}>Paste it, add screenshots of it, or both. TripMate keeps your days and your order.</Text>
        <ImportComposer
          light
          docked
          busy={busy}
          unread={problems}
          actionTitle="Read my plan"
          placeholder="Paste your plan, or links to it"
          initialText={text ?? ''}
          onSubmit={read}
          below={() => <Text style={styles.foot}>A list of places rather than days? It goes to the planner as places to fit in.</Text>}
        />
      </ScrollView>
    );
  }

  const stops = plan.days.flatMap((day, d) => day.stops.map((stop, s) => ({ stop, d, s })));
  const misses = stops.filter(({ d, s }) => status(d, s) === 'missing');
  const city = destination.split(',')[0].trim();
  const label = (d: number) => {
    const date = dayDate(plan.days[d], d, startDate);
    return date ? `Day ${d + 1} · ${date}` : `Day ${d + 1}`;
  };

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={[styles.review, { paddingBottom: 110 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text style={styles.title}>{city ? `${city}, ${plan.days.length} ${plan.days.length === 1 ? 'day' : 'days'}` : `${plan.days.length} days`}</Text>
          <Text style={styles.sub} accessibilityLiveRegion="polite">
            {`${stops.length} ${stops.length === 1 ? 'stop' : 'stops'} read in your order. `}
            {unchecked && !relocated
              ? "The map couldn't be checked just now. Every stop is looked up when you build."
              : misses.length === 0
                ? relocated
                  ? 'Every stop is looked up again near the new place when you build.'
                  : 'Everything is on the map.'
                : misses.length === 1
                  ? 'One needs a look before you build.'
                  : `${misses.length} need a look before you build.`}
          </Text>
        </View>

        {misses.length ? (
          <Section header="Needs a look">
            {misses.map(({ stop, d, s }) => (
              <View key={`${d}-${s}`} style={styles.fix}>
                <View style={styles.fixHead}>
                  <Text style={styles.fixWhen}>{[label(d), stop.time].filter(Boolean).join(' · ').toUpperCase()}</Text>
                  <LineTag line={lines[d]?.[s] ?? null} onPress={setNoteAt} />
                </View>
                <TextInput
                  value={stop.name}
                  onChangeText={(name) => rename(d, s, name)}
                  style={styles.fixInput}
                  keyboardAppearance="light"
                  selectionColor={Polar.ember}
                  maxFontSizeMultiplier={1.6}
                  accessibilityLabel={`${label(d)}: rename ${stop.name}`}
                />
                <Text style={styles.fixWhy}>Not found on the map. Check the spelling, or leave it and it stays as you wrote it.</Text>
              </View>
            ))}
          </Section>
        ) : null}

        <Section
          header="Trip"
          footer={`Not counting where you stay.${relocated ? ' Every stop will be looked up again near the new place.' : ''}`}>
          <TextRow label="Where" value={destination} onChangeText={changeDestination} placeholder="City, Country" autoCorrect={false} />
          <DateRow label="Starts" value={startDate} placeholder="Choose a date" onChange={setStartDate} />
          {/* Per person, because the fill estimates each stop for one visitor; a group total against
              per-visitor costs would report headroom that isn't there. Where they stay is unpriced. */}
          <TextRow label="Budget per person" prefix="$" value={budget} onChangeText={setBudget} keyboardType="number-pad" placeholder="Optional" />
        </Section>

        <Section header="Your days" footer={problems.length ? problems.join(' ') : undefined}>
          {plan.days.map((day, d) => {
            const isOpen = open.has(d);
            const missed = day.stops.filter((_, s) => status(d, s) === 'missing').length;
            return (
              <View key={d}>
                <Pressable
                  onPress={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(d)) next.delete(d);
                      else next.add(d);
                      return next;
                    })
                  }
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  style={({ pressed }) => [styles.day, pressed && styles.pressed]}>
                  <View style={styles.grow}>
                    <Text style={styles.dayTitle}>{label(d)}</Text>
                    <Text style={[styles.daySub, missed ? styles.alert : null]}>
                      {day.stops.length === 0
                        ? 'Nothing planned yet'
                        : `${day.stops.length} ${day.stops.length === 1 ? 'stop' : 'stops'}, ${
                            missed
                              ? `${missed} not on the map`
                              : day.stops.every((_, s) => status(d, s) === 'later')
                                ? 'looked up when you build'
                                : 'all on the map'
                          }`}
                    </Text>
                  </View>
                  <View style={isOpen ? styles.chevronOpen : undefined}>
                    <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right' }} size={13} tintColor={PlanColors.faint} weight="semibold" />
                  </View>
                </Pressable>
                {isOpen
                  ? day.stops.map((stop, s) => {
                      const st = status(d, s);
                      return (
                        <View key={s} style={styles.stop}>
                          <Badge status={st} />
                          <View style={styles.grow}>
                            <TextInput
                              value={stop.name}
                              onChangeText={(name) => rename(d, s, name)}
                              style={styles.stopName}
                              selectionColor={Polar.ember}
                              keyboardAppearance="light"
                              maxFontSizeMultiplier={1.6}
                              accessibilityLabel={`Stop ${s + 1}`}
                            />
                            <Text style={[styles.stopSub, st === 'missing' && styles.alert]}>{[stop.time, STATUS[st]].filter(Boolean).join(' · ')}</Text>
                          </View>
                          <LineTag line={lines[d]?.[s] ?? null} onPress={setNoteAt} />
                        </View>
                      );
                    })
                  : null}
              </View>
            );
          })}
        </Section>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          onPress={build}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ busy }}
          style={({ pressed }) => [styles.build, pressed && styles.buildPressed]}>
          {busy ? <ActivityIndicator color={Polar.ink} /> : <Text style={styles.buildText}>Build my trip</Text>}
        </Pressable>
      </View>

      <NoteSheet text={source} line={noteAt} lines={lines} status={status} onClose={() => setNoteAt(null)} />
    </View>
  );
}

function Badge({ status }: { status: Status }) {
  return (
    <View style={[styles.badge, status === 'missing' && styles.badgeMissing, status === 'later' && styles.badgeLater]}>
      {status === 'missing' ? (
        <Text style={styles.badgeMark}>!</Text>
      ) : status === 'later' ? (
        <Text style={styles.badgeMark}>·</Text>
      ) : (
        <SymbolView name={{ ios: 'location.fill', android: 'near_me' }} size={12} tintColor="#fff" />
      )}
    </View>
  );
}

/** `L9`: the line of your note a stop came from, and the way to see it. Nothing when unknown. */
function LineTag({ line, onPress }: { line: number | null; onPress: (line: number) => void }) {
  if (line === null) return null;
  return (
    <Pressable
      onPress={() => onPress(line)}
      accessibilityRole="button"
      accessibilityLabel={`Show line ${line + 1} of your note`}
      hitSlop={8}
      style={({ pressed }) => [styles.tag, pressed && styles.pressed]}>
      <Text style={styles.tagText}>{`L${line + 1}`}</Text>
    </Pressable>
  );
}

/**
 * Your note, numbered, with the asked-about line lit and scrolled to the middle. Lines that became
 * stops are underlined in their stop's colour, so the rest of the reading is checkable at a glance.
 */
function NoteSheet({
  text,
  line,
  lines,
  status,
  onClose,
}: {
  text: string;
  line: number | null;
  lines: (number | null)[][];
  status: (d: number, s: number) => Status;
  onClose: () => void;
}) {
  const scroller = useRef<ScrollView>(null);
  const [height, setHeight] = useState(0);
  const kinds = new Map<number, Status>();
  lines.forEach((day, d) =>
    day.forEach((l, s) => {
      if (l === null) return;
      const st = status(d, s);
      // A line with any miss on it reads as a miss; otherwise the first stop's state stands.
      if (kinds.get(l) !== 'missing') kinds.set(l, st);
    }),
  );
  return (
    <Modal visible={line !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
        <View style={styles.sheetBar}>
          <Text style={styles.sheetTitle}>Your notes</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}>
            <Text style={styles.headerLink}>Done</Text>
          </Pressable>
        </View>
        {line !== null ? <Text style={styles.sheetSub}>{`Line ${line + 1} is where this stop was read from.`}</Text> : null}
        <ScrollView ref={scroller} style={styles.note} contentContainerStyle={styles.noteContent}>
          {text.split('\n').map((row, i) => {
            const kind = kinds.get(i);
            return (
              <View
                key={i}
                style={[styles.noteRow, i === line && styles.noteLit]}
                onLayout={i === line ? (e) => scroller.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - height / 3), animated: false }) : undefined}>
                <Text style={styles.noteNumber}>{i + 1}</Text>
                <Text style={[styles.noteText, kind && styles.noteUnderlined, kind === 'found' && styles.noteFound, kind === 'missing' && styles.noteMissing]}>{row || ' '}</Text>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const OK = '#2F8F83';
const MISS = '#C2410C';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PlanColors.ground },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  compose: { flexGrow: 1 },
  review: { paddingTop: 8 },
  intro: { paddingHorizontal: 16, paddingBottom: 18, gap: 6 },
  title: { fontFamily: PolarFonts.display, fontSize: 34, lineHeight: 37, color: Polar.ink },
  sub: { fontSize: 15, lineHeight: 21, color: PlanColors.grey },
  foot: { marginHorizontal: 16, fontSize: 13, lineHeight: 18, color: PlanColors.grey },
  headerLink: { fontSize: 17, color: Polar.ember },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  alert: { color: MISS },

  fix: { gap: 6, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  fixHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  fixWhen: { flex: 1, fontSize: 12, fontWeight: '600', letterSpacing: 0.3, color: PlanColors.grey },
  fixInput: {
    height: 42,
    paddingHorizontal: 12,
    fontSize: 17,
    color: '#000',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${MISS}73`,
    backgroundColor: `${MISS}12`,
  },
  fixWhy: { fontSize: 13, lineHeight: 18, color: MISS },

  day: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff' },
  dayTitle: { fontSize: 17, color: '#000' },
  daySub: { marginTop: 1, fontSize: 13, color: PlanColors.grey },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingLeft: 28, paddingRight: 16, paddingVertical: 6, backgroundColor: '#FAFAFC' },
  stopName: { fontSize: 17, color: '#000', paddingVertical: 2 },
  stopSub: { fontSize: 13, color: PlanColors.grey },
  badge: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: OK },
  badgeMissing: { backgroundColor: MISS },
  badgeLater: { backgroundColor: '#8E8E93' },
  badgeMark: { fontSize: 14, fontWeight: '700', color: '#fff' },
  tag: { minWidth: 36, height: 26, paddingHorizontal: 7, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: `${Polar.ember}1A` },
  tagText: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'], color: Polar.ember },

  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 16, backgroundColor: `${PlanColors.ground}F2` },
  build: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.signal },
  buildPressed: { backgroundColor: Polar.signalPressed },
  buildText: { fontSize: 17, fontWeight: '600', color: Polar.ink },

  sheet: { flex: 1, backgroundColor: PlanColors.ground },
  sheetBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 4 },
  sheetTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  sheetSub: { marginHorizontal: 16, marginBottom: 10, fontSize: 13, color: PlanColors.grey },
  note: { flex: 1, marginHorizontal: 16, marginBottom: 24, borderRadius: 14, backgroundColor: '#FFFDF6' },
  noteContent: { paddingVertical: 8 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6, paddingLeft: 8, paddingRight: 14 },
  noteLit: { backgroundColor: `${Polar.signal}24` },
  noteNumber: { width: 22, paddingTop: 3, fontSize: 11, textAlign: 'right', fontVariant: ['tabular-nums'], color: PlanColors.faint },
  noteText: { flex: 1, fontSize: 16, lineHeight: 22, color: '#1C1C1E' },
  noteUnderlined: { textDecorationLine: 'underline', textDecorationColor: PlanColors.faint },
  noteFound: { textDecorationColor: OK },
  noteMissing: { textDecorationColor: MISS },
});
