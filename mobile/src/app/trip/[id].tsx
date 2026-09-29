import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import {
  chatTurns,
  discardTrip,
  editTrip,
  getTrip,
  promoteTrip,
  updateTripItinerary,
} from '@/api/tripMateApi';
import type { ChatTurn, DayPlan, Itinerary, Stop, Trip } from '@/api/types';
import { AddPlaceSheet } from '@/components/add-place-sheet';
import { AnchorReceipt } from '@/components/anchor-receipt';
import { BudgetBar } from '@/components/budget-bar';
import { ChatSheet } from '@/components/chat-sheet';
import { DayMap } from '@/components/day-map';
import { DayPage } from '@/components/day-page';
import { PlanHealth } from '@/components/plan-health';
import { PrimaryButton } from '@/components/form';
import { Invitation, Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { fitMessage } from '@/lib/anchors';
import { type Repair, repairsFor } from '@shared/guardrailFixes';

import { formatDayChip, formatRange } from '@/lib/dayDisplay';
import { type ItineraryDiff, daysUpdatedLabel, diffItineraries } from '@/lib/itineraryDiff';
import { tripHealth, type Guardrail } from '@/lib/health';
import { regionForStops } from '@/lib/mapRegion';

export default function TripDetail() {
  const { id, ask } = useLocalSearchParams<{ id: string; ask?: string }>();

  /**
   * `?ask=<dayIndex>` arrives from Today's "Plans changed?" — the on-trip screen has no composer
   * of its own and should not grow one.
   *
   * Read as the *initial* scope rather than reacted to in an effect. Today pushes this route, so
   * the screen is a fresh mount whenever the param is present, and seeding state is both simpler
   * and the only shape that does not call `setState` synchronously inside an effect — which
   * cascades a render and which this project's lint rule rejects.
   *
   * No seed text: Today does not know what changed, and a composer pre-filled with a guess is
   * worse than an empty one, being a sentence somebody has to delete before writing theirs.
   */
  const askedDay = Number(ask);
  const opensOnAsk = ask !== undefined && Number.isInteger(askedDay) && askedDay >= 0;

  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);
  /** `dayIndex:stopIndex` of the one expanded stop, or null. One at a time, like the Swift app. */
  const [emphasis, setEmphasis] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  /**
   * Which face you are reading, for the whole trip rather than per day.
   *
   * Trip-level on purpose: you are *in map mode*, and changing day should not silently drop you
   * back to a list. It is also what lets one map serve every day instead of one per day.
   */
  const [face, setFace] = useState<'list' | 'map'>('list');
  /**
   * One-way: false until the map is first asked for, true forever after.
   *
   * The map is never unmounted once built — the same latch the web app's map background uses.
   * Tearing down a warmed native map and its decoded tiles every time someone glances at the
   * list would make the second look as slow as the first.
   */
  const [mapBuilt, setMapBuilt] = useState(false);
  if (face === 'map' && !mapBuilt) setMapBuilt(true);
  const [adding, setAdding] = useState(false);
  /**
   * The stop being asked "what else is near this?", or null when the sheet was opened by +.
   *
   * One piece of state rather than a second sheet: the two ask the same question of the same
   * endpoint and end in the same day-and-slot card, and the only difference is where they search
   * and how tightly. Cleared alongside `adding` on every close, or the next + press would silently
   * inherit the last stop asked about.
   */
  const [probe, setProbe] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const chat = useChat(id, trip, setTrip, opensOnAsk);
  /** What "Fit it anyway" seeds the chat composer with, or undefined for a plain "Ask". Cleared on
   *  the plain path so an earlier fit request doesn't linger into an unrelated question. */
  const [chatSeed, setChatSeed] = useState<string | undefined>(undefined);
  /** The scope a seeded opening arrives with: a day index, or null for the whole trip. */
  const [chatScope, setChatScope] = useState<number | null>(opensOnAsk ? askedDay : null);
  /** Bumped on every open, and fed to `ChatSheet` as its `key` — `initialDraft` only seeds a fresh
   *  mount, so without this a second "Fit it anyway" for a different place would leave the first
   *  place's text sitting in the composer. */
  const [chatOpenId, setChatOpenId] = useState(0);
  /**
   * The whole plan checked once, above the early returns so the hook order never depends on
   * whether the trip has loaded.
   *
   * One evaluation for the screen: the panel scores it, and the rows draw their own slice of the
   * same findings. Two surfaces computing the same verdict separately is how a row ends up coral
   * while the figure above it still reads 100.
   */
  const health = useMemo(() => (trip ? tripHealth(trip) : null), [trip]);
  /**
   * Whether the traveller has changed this plan — the thing that decides if the health panel is
   * theirs to read or ours to fix.
   *
   * **A freshly generated plan's problems are not news the traveller wants.** Handing somebody a
   * trip and a scorecard saying "84, eight things to look at" in the same breath is marking our
   * own homework in public: if the plan we just wrote has eight problems, that is a bug report for
   * us, not a disclosure for them. Those problems belong to generation, which now verifies its own
   * review pass and carries its corrections all the way to this screen.
   *
   * Once they have moved something, it is a shared document and the panel earns its place — that
   * is the moment "what did that do to the rest of the week?" is a question they are actually
   * asking, and no model call runs on a drag to answer it.
   *
   * **The inline conflicts are deliberately not gated on this.** A panel is a verdict on the plan;
   * a coral line on a stop is a fact about a specific afternoon, and the alternative to saying it
   * is the traveller finding out at the tram stop.
   */
  const [touched, setTouched] = useState(false);
  const findings = useMemo(
    () => health?.dimensions.flatMap((dimension) => dimension.findings) ?? [],
    [health]
  );

  /**
   * Open the chat composer pre-filled. Never sends — every caller here is offering words, not
   * taking an action, and the traveler still presses Send.
   *
   * `scope` is the sheet's starting scope, and the two seeded openings genuinely differ. A leg
   * that does not fit, or a stop somebody pressed "Fix this" on, is a problem inside one day and
   * opens narrowed to it. An unplaced must-see has no day yet — finding it one is the whole
   * request — so it opens on the whole trip. Either can be changed before sending.
   */
  function askWith(message: string, scope: number | null = null) {
    setChatSeed(message);
    setChatScope(scope);
    setChatOpenId((n) => n + 1);
    chat.open();
  }



  /**
   * The computed ways out of one conflict, and applying one.
   *
   * Deterministic, so there is no model call and no preview step: `repairsFor` only offers a
   * repair whose label says exactly what it does, that closes the leg it was raised for, that
   * leaves every other leg of the day no tighter, and that moves nothing booked. What is left
   * to decide is which of the two, and the bar above carries Undo if it was the wrong one.
   */
  const repairs = useCallback(
    (finding: Guardrail): Repair[] => (trip ? repairsFor(trip.itinerary, finding) : []),
    [trip]
  );

  async function applyRepair(days: DayPlan[], label: string) {
    if (!trip) return;
    const previous = trip.itinerary;
    const next = { ...previous, days };
    setTouched(true);
    setTrip({ ...trip, itinerary: next });
    chat.remember(previous, diffItineraries(previous, next).days);
    const saved = await updateTripItinerary(trip.id, next);
    if (!saved) {
      setTrip({ ...trip, itinerary: previous });
      console.warn(`"${label}" did not save`);
    }
  }

  /**
   * Mark a stop booked, or release it.
   *
   * Optimistic then rolled back, the same bargain `onAdd` strikes below and for the same reason:
   * the write is a whole-itinerary overwrite with no server-side undo, so the only honest recovery
   * is to put back the object we replaced. This is also the ONLY way the flag is ever cleared —
   * `applyPatch` refuses an op that would, because a planner able to unlock a stop could unlock it
   * and move it in one turn.
   */
  async function toggleLock(dayIndex: number, stopIndex: number) {
    if (!trip) return;
    const previous = trip;
    const next: Itinerary = {
      ...trip.itinerary,
      days: trip.itinerary.days.map((plan, di) =>
        di !== dayIndex
          ? plan
          : {
              ...plan,
              stops: plan.stops.map((stop, si) =>
                si !== stopIndex
                  ? stop
                  : {
                      ...stop,
                      // Written out rather than deleted. Absent already reads as PREFERRED, but a
                      // present value says somebody decided, which is what a later reader needs.
                      timeFlexibility:
                        stop.timeFlexibility === 'FIXED' ? ('PREFERRED' as const) : ('FIXED' as const),
                    }
              ),
            }
      ),
    };
    setTouched(true);
    setTrip({ ...trip, itinerary: next });
    if (!(await updateTripItinerary(trip.id, next))) setTrip(previous);
  }

  function closeSheet() {
    setAdding(false);
    setProbe(null);
  }

  function findNearby(stop: { name: string; lat: number; lng: number }) {
    setProbe({ lat: stop.lat, lng: stop.lng, name: stop.name });
    setAdding(true);
  }

  useEffect(() => {
    getTrip(id).then((result) => setTrip(result ?? null));
  }, [id]);

  if (trip === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
        <Loading />
      </View>
    );
  }

  if (trip === null) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
        <View style={styles.stateWrap}>
          <Notice>Couldn&rsquo;t reach TripMate. Check your connection.</Notice>
        </View>
      </View>
    );
  }

  const days = trip.itinerary?.days ?? [];

  return (
    <View style={styles.screen}>
      {/* Chevron only. The back label defaults to the previous screen's title, which for a route
          group is the literal string "(tabs)" — and naming one tab would be wrong anyway, since
          a trip opens from both Home and Trips. The title stays the destination rather than
          the day: a nav title that changes on every swipe is noise, and it re-renders the native
          header each time. */}
      <Stack.Screen
        options={{ title: trip.destination, headerBackButtonDisplayMode: 'minimal' }}
      />

      {days.length === 0 ? (
        <View style={styles.stateWrap}>
          <Invitation
            title="No days in this plan yet"
            body="This trip was kept before its days were written."
          />
        </View>
      ) : (
        <>
          <View style={styles.chrome}>
            <ThemedText type="label" themeColor="muted">
              {formatRange(trip.startDate, trip.endDate)}
            </ThemedText>
            {/* Two rows, because these are two kinds of thing. Which day you are reading is
                navigation; List/Map and Ask/+ act on the day you landed on. Sharing one row made
                them one group of controls of equal weight, and it also capped the strip at
                whatever width the other three left — which is the wrong constraint on a
                fourteen-day trip, where the strip is the control that needs the room. */}
            <DayStrip days={days} current={day} onSelect={setDay} />
            <View style={styles.chromeRow}>
              <FaceToggle face={face} onChange={setFace} />
              <View style={styles.spacer} />
              {/* Beside + for the reason + is here: the trailing end of this row is the toolbar,
                  and both act on the plan below it — the same pairing `TripHeaderRow` makes in the
                  Swift app. Muted rather than jade, also copied from there: two filled jade
                  targets side by side read as two primary actions, and adding one stop is the
                  ordinary one. Not the nav bar's `headerRight`, which is where this started: Expo
                  Go parks its own floating dev button exactly there and swallows every tap. */}
              <Pressable
                onPress={() => {
                  setChatSeed(undefined);
                  // The plain Ask button is not about the day you happen to be reading — see
                  // the scope note in `chat-sheet.tsx`.
                  setChatScope(null);
                  setChatOpenId((n) => n + 1);
                  chat.open();
                }}
                accessibilityRole="button"
                accessibilityLabel="Ask for a change"
                style={({ pressed }) => [styles.ask, pressed && styles.askPressed]}>
                <ThemedText type="label" themeColor="foreground">
                  Ask
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setAdding(true)}
                accessibilityRole="button"
                accessibilityLabel="Add a stop"
                style={styles.add}>
                <ThemedText type="heading" themeColor="accentForeground">
                  +
                </ThemedText>
              </Pressable>
            </View>
          </View>

          {/* A parked proposal is invisible behind a closed sheet, and an approved one is easy
              to regret once you see it in the plan rather than in a list. One bar answers both,
              because they are the same question — "something just happened to this plan, and
              here is the way back" — and two bars competing for the same slot would be a state
              machine nobody asked for. */}
          <EditBar
            pending={chat.pending !== null && !chat.visible}
            onReview={chat.open}
            undoable={chat.undoable}
            onUndo={chat.undo}
          />

          {/* Below the chrome and outside it, so the bar spans the width rather than sitting in
              the row with the controls. Shown on the map face too: it is a fact about the trip,
              not about the list, and hiding it there would make the face swap jump. */}
          <BudgetBar days={days} budget={trip.budget} activeDayIndex={day} />

          {health && (touched || chat.turns.length > 0) ? <PlanHealth health={health} /> : null}

          <AnchorReceipt
            itinerary={trip.itinerary}
            kept={trip.status !== 'draft'}
            onFitAnchor={(name) => askWith(fitMessage(name))}
          />

          <View style={styles.faces}>
            <DayPager
              trip={trip}
              day={day}
              onDayChange={setDay}
              emphasis={emphasis}
              onEmphasise={setEmphasis}
              onFindNearby={findNearby}
              findings={findings}
              onToggleLock={toggleLock}
              onAsk={(message: string) => askWith(message, day)}
              repairs={repairs}
              onRepair={applyRepair}
            />

            {mapBuilt ? (
              <MapFace visible={face === 'map'}>
                <DayMap
                  stops={days[day]?.stops ?? []}
                  dayIndex={day}
                  emphasis={stopIndexFor(emphasis, day)}
                  onEmphasise={(stop) => setEmphasis(stop === null ? null : `${day}:${stop}`)}
                />
              </MapFace>
            ) : null}
          </View>
        </>
      )}

      <AddPlaceSheet
        visible={adding}
        onClose={closeSheet}
        itinerary={trip.itinerary}
        dayIndex={day}
        // Search around the day you are reading. A day with no stops has no middle to search
        // from, and the sheet says so rather than defaulting to somewhere arbitrary.
        centre={centreOf(days[day]?.stops ?? [])}
        at={probe}
        onAdd={async (next, name) => {
          const previous = trip;
          setTouched(true);
          // Optimistic, then rolled back on failure. The write is a whole-itinerary overwrite
          // with no server-side transaction to undo, so the only honest recovery is to put the
          // object we replaced back exactly as it was.
          setTrip({ ...trip, itinerary: next });
          const saved = await updateTripItinerary(trip.id, next);
          if (saved) {
            // Nothing in this app removes a stop, so before this an add was permanent short of
            // asking the planner to undo it in words. The day is read off the diff rather than
            // passed down: the sheet may add to a day other than the one being read, and the
            // comparison already knows which one it was.
            chat.remember(previous.itinerary, diffItineraries(previous.itinerary, next).days);
            return true;
          }
          setTrip(previous);
          console.warn(`Adding ${name} did not save`);
          return false;
        }}
      />

      <ChatSheet
        key={chatOpenId}
        visible={chat.visible}
        onClose={chat.close}
        turns={chat.turns}
        replying={chat.replying}
        failure={chat.failure}
        onSend={chat.send}
        initialDraft={chatSeed}
        days={days}
        initialScope={chatScope}
        pending={chat.pending?.diff ?? null}
        applying={chat.applying}
        onApply={chat.apply}
        onDiscard={chat.discard}
      />

      {trip.status === 'draft' ? (
        <KeepShelf
          trip={trip}
          onKept={(endDate) => setTrip({ ...trip, status: 'saved', endDate })}
        />
      ) : null}
    </View>
  );
}

/**
 * The edit conversation for the open trip.
 *
 * A hook rather than state in the screen because the screen is already holding six pieces of view
 * state, and none of the seven here is one: this is a conversation, its two opaque continuation
 * tokens, and the plan they produce.
 *
 * **`sessionId` is what makes a follow-up a follow-up.** It seeds from `trip.chatSessionId` — the
 * session the itinerary was *generated* in — so the first question inherits the planner's own
 * reasoning about this trip rather than a fresh reading of its output. `syncedHash` starts null on
 * purpose: this device has not been told what the model believes, so the first turn must resync.
 *
 * Neither token is ever inspected. A null `syncedHash` coming back means the applier rejected
 * something and the model's picture is now wrong, and echoing that null is precisely what forces
 * the correction next turn.
 */
function useChat(
  id: string,
  trip: Trip | null | undefined,
  setTrip: React.Dispatch<React.SetStateAction<Trip | null | undefined>>,
  /** Open straight away — the screen was entered from Today's "Plans changed?". */
  openOnMount = false
) {
  const [visible, setVisible] = useState(openOnMount);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [replying, setReplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** A change the model has proposed and nobody has approved. At most one: see `send`. */
  const [pending, setPending] = useState<Pending | null>(null);
  const [applying, setApplying] = useState(false);
  /** The plan as it was before the last approval, for as long as undoing it is still the
   *  obvious thing to want. Cleared by the next proposal rather than by a timer — a window that
   *  closes on its own is one somebody watches instead of reading their plan. */
  const [undoable, setUndoable] = useState<{ itinerary: Itinerary; days: number[] } | null>(null);
  const session = useRef<{ id: string | null; hash: string | null }>({ id: null, hash: null });
  const restored = useRef(false);

  /**
   * The transcript lives on the server, so a reopened trip has a conversation this device has
   * never seen. Once per mount: after that, `turns` is the live copy and re-reading would
   * duplicate the turn that is still in flight.
   *
   * **An effect rather than a line inside `open`**, because the sheet can now be open before the
   * trip has loaded — `openOnMount` is set from a route param that arrives well ahead of the
   * fetch. Doing it here means the restore waits for the trip instead of being skipped by it,
   * and the state lands in the promise callback where it belongs.
   */
  useEffect(() => {
    if (!visible || restored.current || !trip) return;
    restored.current = true;
    session.current.id = trip.chatSessionId;
    chatTurns(id).then((saved) => saved.length && setTurns(saved));
  }, [visible, trip, id]);

  function open() {
    setVisible(true);
  }

  async function send(text: string, dayIndex?: number): Promise<boolean> {
    if (!trip) return false;
    // Stamped with the scope it goes out under, matching what `/api/trip-edit` writes to the
    // transcript — so a live turn and a restored one carry the same label and the sheet never
    // shows the stamp appearing on reload.
    setTurns((prior) => [...prior, { role: 'user', content: text, scope: dayIndex ?? null }]);
    setReplying(true);
    setFailure(null);
    // Undoing the *previous* approval once a newer ask is in flight would restore a plan two
    // edits old, which is not what the word means.
    setUndoable(null);
    try {
      const edit = await editTrip({
        trip: {
          id: trip.id,
          destination: trip.destination,
          startDate: trip.startDate,
          endDate: trip.endDate,
          budget: trip.budget,
          status: trip.status,
        },
        itinerary: trip.itinerary,
        // The whole conversation, because a turn only makes sense after the one before it — and
        // the route falls back to rebuilding the full prompt from these when the session is gone.
        messages: [
          ...turns.map(({ role, content }) => ({ role, content })),
          { role: 'user' as const, content: text },
        ],
        tripId: trip.id,
        userAnswers: trip.userAnswers,
        sessionId: session.current.id,
        syncedHash: session.current.hash,
        // Absent for the whole trip. The applier enforces it, so an op that lands on another
        // day comes back as a rejection the traveler reads rather than a change they discover.
        dayIndex,
      });
      if (!edit) {
        // Dropped, not left greyed out: this array mirrors the conversation the *server* has, and
        // after a failure it has nothing. The sheet keeps the text so nothing is retyped.
        setTurns((prior) => prior.slice(0, -1));
        setFailure("That didn't reach the planner. Check your connection and try again.");
        return false;
      }
      session.current = { id: edit.sessionId, hash: edit.syncedHash };
      setTurns((prior) => [
        ...prior,
        {
          role: 'assistant',
          content: edit.reply ?? '',
          warnings: edit.warnings,
          rejected: edit.rejected,
        },
      ]);

      /**
       * **The plan does not change here.** It used to: the itinerary was swapped in
       * unconditionally and the only account of what had happened was the model's own prose
       * about its own work — with nothing to compare against and no way back, since
       * `updateTripItinerary` overwrites and this database keeps no earlier version.
       *
       * What gets parked instead is the proposal plus a diff computed from the two plans, which
       * the sheet renders for approval. A second question while one is parked replaces it: the
       * base plan has not moved, so the newer ask is the one that was made about what is on
       * screen.
       */
      const diff = diffItineraries(trip.itinerary, edit.itinerary);
      if (diff.empty) {
        // Nothing to approve — a question answered, a refusal, or a reply that only rewrote a
        // note. Applied quietly rather than shown as a change that is not one.
        setTrip({ ...trip, itinerary: edit.itinerary });
        await updateTripItinerary(trip.id, edit.itinerary, edit.sessionId);
        return true;
      }
      setPending({ itinerary: edit.itinerary, sessionId: edit.sessionId, diff });
      return true;
    } finally {
      setReplying(false);
    }
  }

  /**
   * Record a plan as the one to go back to.
   *
   * Exported because an edit is not only ever a conversation: adding a stop changes the plan
   * too, and the traveler wanting the previous one back is the same wish either way. The undo
   * itself stays in here because putting a plan back is also a statement about the session —
   * see `undo`.
   */
  function remember(previous: Itinerary, days: number[]) {
    setUndoable({ itinerary: previous, days });
  }

  async function apply() {
    const proposal = pending;
    if (!proposal || !trip) return;
    setApplying(true);
    const previous = trip.itinerary;
    try {
      setTrip({ ...trip, itinerary: proposal.itinerary });
      setUndoable({ itinerary: previous, days: proposal.diff.days });
      setPending(null);
      // Persisted after the plan is on screen, and NOT rolled back if this fails. The edit is
      // one the traveler just approved, and a plan that reverts under you is worse than one
      // that needs saving again — the same bargain the unconditional swap used to make.
      const saved = await updateTripItinerary(trip.id, proposal.itinerary, proposal.sessionId);
      if (!saved) setFailure("The plan changed, but saving it failed. It may not survive a reopen.");
    } finally {
      setApplying(false);
    }
  }

  /**
   * Turning a proposal down is not a no-op for the conversation.
   *
   * The model now believes it changed a plan it did not change, so its picture and ours have
   * parted — which is exactly the condition a null `syncedHash` exists to announce. Echoing null
   * next turn forces the resync, the same way a server-side rejected op does.
   */
  function discard() {
    setPending(null);
    session.current.hash = null;
  }

  async function undo() {
    const back = undoable;
    if (!back || !trip) return;
    setUndoable(null);
    setTrip({ ...trip, itinerary: back.itinerary });
    session.current.hash = null;
    const saved = await updateTripItinerary(trip.id, back.itinerary, session.current.id);
    if (!saved) setFailure("Undone here, but saving that failed. It may not survive a reopen.");
  }

  return {
    visible,
    open,
    close: () => setVisible(false),
    turns,
    replying,
    failure,
    send,
    remember,
    pending,
    applying,
    apply,
    discard,
    undoable,
    undo,
  };
}

interface Pending {
  itinerary: Itinerary;
  sessionId: string | null;
  diff: ItineraryDiff;
}

/**
 * The days, paged one per screen.
 *
 * A `ScrollView` rather than a `FlatList`, and the reason is the map that lands next: a list's one
 * real contribution here is windowing, and windowing is precisely what would unmount a built map
 * two pages away. A FlatList configured never to window *is* a ScrollView, with three more knobs
 * and two more ways to fail quietly. A trip is one to fourteen days; mounting them all is cheap.
 *
 * The strip and the swipe drive the same `day`, so the sync runs both ways. `settled` is what
 * stops it looping: a programmatic `scrollTo` fires `onMomentumScrollEnd` too, and without the
 * guard that would set the state that caused the scroll.
 */
function DayPager({
  trip,
  day,
  onDayChange,
  emphasis,
  onEmphasise,
  onFindNearby,
  findings,
  onToggleLock,
  onAsk,
  repairs,
  onRepair,
}: {
  trip: Trip;
  day: number;
  onDayChange: (day: number) => void;
  emphasis: string | null;
  onEmphasise: (key: string | null) => void;
  onFindNearby: (stop: Stop) => void;
  /** Every finding for the whole trip; each day takes its own slice below. */
  findings: Guardrail[];
  onToggleLock: (dayIndex: number, stopIndex: number) => void;
  onAsk: (message: string) => void;
  repairs: (finding: Guardrail) => Repair[];
  onRepair: (days: DayPlan[], label: string) => void;
}) {
  // `useWindowDimensions`, not `Dimensions.get()` — this one re-renders on rotation, and a page
  // whose width disagrees with the pager's by even a point drifts out of alignment by day 8.
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const settled = useRef(0);
  const days = trip.itinerary?.days ?? [];

  useEffect(() => {
    if (settled.current === day) return;
    settled.current = day;
    pager.current?.scrollTo({ x: day * width, animated: true });
  }, [day, width]);

  function onMomentumScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const landed = Math.round(event.nativeEvent.contentOffset.x / width);
    if (landed === settled.current) return;
    settled.current = landed;
    onDayChange(landed);
  }

  return (
    <ScrollView
      ref={pager}
      horizontal
      pagingEnabled
      // iOS-only, harmless elsewhere: stops a diagonal drag jiggling the page sideways while the
      // day's own list is scrolling vertically.
      directionalLockEnabled
      // Explicit, because a clipped subview is how a native map goes black on Android.
      removeClippedSubviews={false}
      showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={onMomentumScrollEnd}>
      {days.map((dayPlan, index) => (
        // A fixed width, never `flex: 1`: a flex child inside a horizontal ScrollView collapses
        // to zero width and renders blank, with no warning.
        <View key={dayPlan.date} style={{ width }}>
          <DayPage
            day={dayPlan}
            dayIndex={index}
            dayCount={days.length}
            destination={trip.destination}
            emphasis={stopIndexFor(emphasis, index)}
            onEmphasise={(stop) => onEmphasise(stop === null ? null : `${index}:${stop}`)}
            onFindNearby={onFindNearby}
            findings={findings.filter((f) => f.dayIndex === index)}
            onToggleLock={(stopIndex) => onToggleLock(index, stopIndex)}
            onAsk={onAsk}
            repairs={repairs}
            onRepair={onRepair}
          />
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * One slim line for the two things that happen around an edit.
 *
 * Pending outranks undoable: a change waiting for an answer is a question, and a change already
 * made is only an offer. Neither is a toast — nothing here disappears on a timer, because both
 * are things a traveler may want after reading a screenful, and a control that leaves while you
 * are still deciding is worse than one that stays a little too long.
 *
 * Jade on the label, because both are actions. The bar renders nothing at all when there is
 * neither, rather than reserving the space.
 */
function EditBar({
  pending,
  onReview,
  undoable,
  onUndo,
}: {
  pending: boolean;
  onReview: () => void;
  undoable: { days: number[] } | null;
  onUndo: () => void;
}) {
  if (!pending && !undoable) return null;
  const waiting = pending;
  return (
    <Pressable
      onPress={waiting ? onReview : onUndo}
      accessibilityRole="button"
      style={({ pressed }) => [styles.editBar, pressed && styles.editBarPressed]}>
      <ThemedText type="detail" themeColor="muted" style={styles.grow}>
        {waiting ? 'A change is waiting' : daysUpdatedLabel(undoable?.days ?? [])}
      </ThemedText>
      <ThemedText type="label" themeColor="accent">
        {waiting ? 'Review' : 'Undo'}
      </ThemedText>
    </Pressable>
  );
}

/**
 * Which day you are on, and that there are others.
 *
 * The masthead already prints "Day 3 of 7", so this is not information — it is the affordance. It
 * also outlives the swipe: once the map face is pannable it takes the horizontal drag, and tapping
 * a chip is then the only way to change day. Tapping one is also how you reach day 6 without
 * swiping six times.
 *
 * Not jade. Jade means action, and where-you-are is not an action.
 */
function DayStrip({
  days,
  current,
  onSelect,
}: {
  days: DayPlan[];
  current: number;
  onSelect: (day: number) => void;
}) {
  const count = days.length;
  const strip = useRef<ScrollView>(null);

  // Keep the active chip on screen — a fourteen-day trip runs off the edge.
  useEffect(() => {
    strip.current?.scrollTo({ x: Math.max(0, current * CHIP_STRIDE - CHIP_STRIDE), animated: true });
  }, [current]);

  return (
    <ScrollView
      ref={strip}
      horizontal
      showsHorizontalScrollIndicator={false}
      // The box explicitly takes the room the toggle leaves, rather than inheriting it. A
      // seven-day strip at the largest text size already bounded correctly without this, so it
      // fixes nothing observed — it states the constraint the layout is relying on instead of
      // depending on how a ScrollView happens to size itself inside a row.
      contentContainerStyle={styles.strip}>
      {days.map((plan, index) => {
        const active = index === current;
        const chip = formatDayChip(plan.date);
        return (
          <Pressable
            key={index}
            onPress={() => onSelect(index)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            // The chip shows a date; the label still says which day of how many, because that
            // is the thing a screen-reader user cannot get from the strip's shape.
            accessibilityLabel={`Day ${index + 1} of ${count}`}
            style={[styles.chip, active && styles.chipActive]}>
            <ThemedText type="money" themeColor={active ? 'foreground' : 'muted'}>
              {chip?.dayOfMonth ?? index + 1}
            </ThemedText>
            {chip ? (
              <ThemedText type="micro" themeColor="muted" style={styles.chipWeekday}>
                {chip.weekday.toUpperCase()}
              </ThemedText>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * The map face, faded over the list rather than swapped with it.
 *
 * **Hidden by opacity, never unmounted and never `display: none`.** Both of those throw the
 * native map away; `pointerEvents` is what actually takes the hidden face out of hit-testing, so
 * a drag meant for the list underneath is not swallowed by an invisible map on top.
 *
 * Opacity and a slight scale together are Material's shared-axis Z — the canonical "two views of
 * one thing" transition, and unremarkable on iOS.
 */
function MapFace({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: visible ? 220 : 160 }),
    transform: [{ scale: withTiming(visible ? 1 : 0.96, { duration: visible ? 220 : 160 }) }],
  }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents={visible ? 'auto' : 'none'}>
      {children}
    </Animated.View>
  );
}

/**
 * List or map, for the trip.
 *
 * A two-up control rather than a card flip: neither platform ships a flip — it is iOS 6-era
 * skeuomorphism Apple removed, and Material has no equivalent — and a flip would also force both
 * faces to stay mounted for backface-visibility, keeping a live map behind the list forever.
 *
 * The selected side is paper on slate, not jade. Jade means action, and which view you are
 * looking at is not an action.
 */
function FaceToggle({
  face,
  onChange,
}: {
  face: 'list' | 'map';
  onChange: (face: 'list' | 'map') => void;
}) {
  return (
    <View style={styles.toggle}>
      {(['list', 'map'] as const).map((option) => {
        const active = face === option;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.toggleHalf, active && styles.toggleHalfActive]}>
            <ThemedText type="label" themeColor={active ? 'foreground' : 'muted'}>
              {option === 'list' ? 'List' : 'Map'}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The middle of a day's stops, reusing the map's own framing maths. */
function centreOf(stops: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  const region = regionForStops(stops);
  return region ? { lat: region.latitude, lng: region.longitude } : null;
}

/** The stop index within `dayIndex`, or null when the emphasis belongs to another day. */
function stopIndexFor(emphasis: string | null, dayIndex: number): number | null {
  if (!emphasis) return null;
  const [day, stop] = emphasis.split(':');
  return Number(day) === dayIndex ? Number(stop) : null;
}

/**
 * An unkept plan's shelf.
 *
 * A generated trip is a `draft` row from the moment it exists, so nothing is lost on a back
 * press — but a draft is invisible on the trips wall (`listTrips` defaults to saved), so
 * without this it could only be reached by going back through generation. Keeping promotes the
 * same row rather than inserting a second one, which is what keeps its `runId` link intact.
 */
function KeepShelf({ trip, onKept }: { trip: Trip; onKept: (endDate: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'keep' | 'discard' | null>(null);
  const [failed, setFailed] = useState(false);

  async function keep() {
    setBusy('keep');
    setFailed(false);
    const update = await promoteTrip(trip.id, trip.itinerary);
    setBusy(null);
    // The returned endDate is recomputed from the itinerary server-side, so it is the one to
    // keep — not whatever was sent.
    if (update) onKept(update.endDate);
    else setFailed(true);
  }

  async function discard() {
    setBusy('discard');
    setFailed(false);
    const ok = await discardTrip(trip.id);
    if (ok) router.replace('/(tabs)/trips');
    else {
      setBusy(null);
      setFailed(true);
    }
  }

  return (
    <View style={styles.shelf}>
      {failed ? (
        <ThemedText type="detail" themeColor="alert" style={styles.shelfError}>
          That didn&rsquo;t go through. Try again.
        </ThemedText>
      ) : (
        <ThemedText type="detail" themeColor="muted" style={styles.shelfError}>
          Not kept yet — it won&rsquo;t appear under Trips until you do.
        </ThemedText>
      )}
      <PrimaryButton title="Keep this trip" onPress={keep} busy={busy === 'keep'} disabled={!!busy} />
      <Pressable onPress={discard} disabled={!!busy} style={styles.discard}>
        <ThemedText type="detail" themeColor="muted">
          {busy === 'discard' ? 'Discarding…' : 'Discard'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** Chip width plus its gap — what one step along the strip measures. An estimate, and only
 *  used to keep the active chip on screen: it drifts as the text scales, and landing a few
 *  points out of centre is invisible where failing to scroll at all would not be. */
const CHIP_STRIDE = 52;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  stateWrap: { paddingTop: Spacing.regular },

  chrome: {
    paddingHorizontal: Spacing.read,
    paddingBottom: Spacing.tight,
    gap: Spacing.tight,
  },
  chromeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },
  // Pushes Ask and + to the trailing end, so the row reads as "view here, actions there"
  // rather than as four controls in a queue.
  spacer: { flex: 1 },
  editBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    marginHorizontal: Spacing.read,
    marginBottom: Spacing.tight,
    paddingHorizontal: Spacing.rows,
    minHeight: 44,
    borderRadius: Radius.read,
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  editBarPressed: { backgroundColor: Colors.pressed },
  grow: { flex: 1 },
  faces: { flex: 1 },
  // `flexGrow` + `space-between` is the whole alignment fix: seven fixed-width chips came to
  // 356pt in a 370pt row, so the strip stopped 30pt short of a right margin every other row in
  // the chrome runs flush to. Narrower than the row, the chips now share the slack and the last
  // one lands on the margin; wider than it — a fortnight — neither rule has anything to give and
  // it scrolls exactly as before.
  strip: {
    flexGrow: 1,
    justifyContent: 'space-between',
    gap: Spacing.tight,
    alignItems: 'flex-end',
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
    padding: 3,
    gap: 2,
  },
  toggleHalf: {
    paddingHorizontal: Spacing.rows,
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  toggleHalfActive: { backgroundColor: Colors.surfaceDeep },
  // The face toggle's pill, since this reads as the third control in that group rather than a
  // second + — its height comes from the same 3pt padding plus a `label` line.
  ask: {
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
    paddingHorizontal: Spacing.rows,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askPressed: { backgroundColor: Colors.pressed },
  add: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No fixed height: two lines of text at the accessibility sizes need the room, and a chip
  // that clips its weekday is worse than a taller strip. `read` rather than `pill`, because a
  // two-line pill is a lozenge.
  chip: {
    minWidth: 44,
    paddingHorizontal: Spacing.tight,
    paddingVertical: 5,
    borderRadius: Radius.read,
    backgroundColor: Colors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipWeekday: { marginTop: -1 },
  chipActive: {
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },

  shelf: {
    backgroundColor: Colors.bar,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.cardBorder,
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.rows,
    paddingBottom: Spacing.regular,
    gap: Spacing.rows,
  },
  shelfError: { textAlign: 'center' },
  discard: { alignItems: 'center', paddingVertical: Spacing.tight },
});
