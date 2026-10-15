import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
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
  promoteTrip,
  shareTrip,
  unshareTrip,
  updateTripItinerary,
} from '@/api/tripMateApi';
import type { ChatTurn, DayPlan, Itinerary, Stop, Trip } from '@/api/types';
import { lastRequestReachedServer } from '@/api/session';
import { AddPlaceSheet } from '@/components/add-place-sheet';
import { AnchorReceipt } from '@/components/anchor-receipt';
import { AskBar } from '@/components/ask-bar';
import { BudgetSheet } from '@/components/budget-sheet';
import { ChatSheet } from '@/components/chat-sheet';
import { DayMap } from '@/components/day-map';
import { DayPage } from '@/components/day-page';
import { OfflineScreen } from '@/components/offline-screen';
import { StoryPanel } from '@/components/story-panel';
import { PlanHealth } from '@/components/plan-health';
import { Invitation, Loading, Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { TripToolbar } from '@/components/trip-toolbar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { fitMessage } from '@/lib/anchors';
import { type Repair, repairsFor } from '@shared/guardrailFixes';

import { clockAt, formatDayChip, formatRange } from '@/lib/dayDisplay';
import { type ItineraryDiff, daysUpdatedLabel, diffItineraries } from '@/lib/itineraryDiff';
import { tripHealth, type Guardrail } from '@/lib/health';
import { importNoteLines, showsHealthOnOpen } from '@/lib/importNotes';
import { drawableStops, regionForStops } from '@/lib/mapRegion';
import { proposalRows } from '@/lib/proposalRows';
import { useStoryFilm } from '@/lib/useStoryFilm';
import { surenessFields, tripSpend, type Sureness } from '@/lib/spend';
import { loadTrip } from '@/lib/tripCache';
import { todayInZone } from '@/lib/tripClock';
import { openingDay } from '@/lib/tripPhase';
import { todayISO } from '@/lib/tripsWall';

/** Handed to `useStoryFilm` before the trip has loaded: hooks cannot be conditional, and with
 *  `active` false the hook never reads it. */
const PLACEHOLDER_TRIP = { id: '', destination: '', itinerary: { days: [] } } as unknown as Trip;

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
  const router = useRouter();
  /** `dayIndex:stopIndex` of the one expanded stop, or null. One at a time, like the Swift app. */
  const [emphasis, setEmphasis] = useState<string | null>(null);
  /**
   * Which day is open — the one that is running, until the traveller says otherwise.
   *
   * **This opened on day 1 regardless, and that was wrong in the one case it matters.** Today's
   * masthead is a link here, so on day 5 of a trip the way to "what have I already done" landed
   * on the first day and asked for four taps forward. The same is true arriving from the Trips
   * wall: a trip you are *on* should open where you are.
   *
   * Derived at render rather than stamped in an effect. `trip` arrives asynchronously, so the
   * running day is not knowable at mount, and `setState` inside an effect is both a cascading
   * render and the thing this project's lint rule rejects on sight — the same correction Home's
   * `loaded` state records. `chosen` is null until the traveller picks a day, and from then on
   * it wins: a screen that yanked itself back to today while you were reading Thursday would be
   * a worse bug than the one this fixes.
   *
   * `?ask=` still outranks both. It is an explicit instruction from Today's "Plans changed?".
   */
  const [chosen, setChosen] = useState<number | null>(null);
  const runningDay = useMemo(
    () => (trip ? openingDay(trip, todayInZone(trip.timezone) ?? todayISO()) : 0),
    [trip]
  );
  const day = chosen ?? (opensOnAsk ? askedDay : runningDay);
  const setDay = setChosen;
  /**
   * Which face you are reading, for the whole trip rather than per day.
   *
   * Trip-level on purpose: you are *in map mode*, and changing day should not silently drop you
   * back to a list. It is also what lets one map serve every day instead of one per day.
   */
  const [face, setFace] = useState<'list' | 'map'>('list');
  /**
   * Whether a film is playing this day. While it is, the map fills the screen: header, day strip,
   * toolbar and the bars beneath are not rendered, and the face is forced to Map. `faceBefore` is
   * what Close restores.
   */
  const [filming, setFilming] = useState(false);
  const faceBefore = useRef<'list' | 'map'>('list');
  /** The film sheet's height, which the map pads by so nothing it must show sits under the sheet. */
  const [sheetHeight, setSheetHeight] = useState(0);
  /**
   * One-way: false until the map is first asked for, true forever after.
   *
   * The map is never unmounted once built — the same latch the web app's map background uses.
   * Tearing down a warmed native map and its decoded tiles every time someone glances at the
   * list would make the second look as slow as the first.
   */
  const [mapBuilt, setMapBuilt] = useState(false);
  if ((face === 'map' || filming) && !mapBuilt) setMapBuilt(true);
  const film = useStoryFilm({ trip: trip ?? PLACEHOLDER_TRIP, dayIndex: day, active: filming && !!trip });
  function startFilm() {
    faceBefore.current = face;
    setFace('map');
    setFilming(true);
  }
  function closeFilm() {
    setFilming(false);
    setFace(faceBefore.current);
  }
  // Back during a film means Close, not "leave the trip" — Android's back button, and the header
  // and edge swipe the film hides.
  usePreventRemove(filming, closeFilm);
  const [adding, setAdding] = useState(false);
  /** The Budget sheet, and which tab it opens on: the ring asks about the trip, a day's total
   *  about that day. */
  const [budgetSheet, setBudgetSheet] = useState<'trip' | 'day' | null>(null);
  /** How much of the screen's foot the floating toolbar covers; the faces keep clear of it. */
  const [toolbarHeight, setToolbarHeight] = useState(0);
  /**
   * The stop being asked "what else is near this?", or null when the sheet was opened by +.
   *
   * One piece of state rather than a second sheet: the two ask the same question of the same
   * endpoint and end in the same day-and-slot card, and the only difference is where they search
   * and how tightly. Cleared alongside `adding` on every close, or the next + press would silently
   * inherit the last stop asked about.
   */
  const [probe, setProbe] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const chat = useChat(id, trip, setTrip, opensOnAsk ? askedDay : null, (diff) => {
    // A proposal is drawn on the day it changes, so show one it changes, and show it as a list —
    // the map face has no rows to draw a change on.
    if (!diff.days.includes(day)) setChosen(diff.days[0] ?? day);
    setFace('list');
  });
  /** The whole conversation, which the bar's "N messages" opens. */
  const [history, setHistory] = useState(false);
  // Back while asking folds the bar into the toolbar rather than leaving the trip.
  usePreventRemove(chat.visible && !chat.pending && !filming, chat.close);
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
  const [saveError, setSaveError] = useState<string | null>(null);
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
    chat.open(message, scope);
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

  /**
   * An optimistic write, rolled back **and explained** when the server refuses it.
   *
   * Every writer here already put the old object back, so nothing was ever lied about. What they
   * could not do is say so: a control that flips and reverts with no reason reads as a broken app
   * rather than a stated limit. That argument was already written down one function below, about
   * the offline case — this is the same argument, and it was never extended to the case where the
   * request actually goes out and comes back a no.
   *
   * **A refusal is ordinary, not exotic.** `PATCH /api/trips/[id]` is scoped to `writableOwners`,
   * and answers 404 — deliberately not 403, so an unreadable trip is indistinguishable from one
   * that is not there — for anyone else. A trip reached on a device that does not own it therefore
   * fails *every* write, and before this the traveller saw a value snap back and nothing at all.
   * Measured against the running dev server: a PATCH carrying a foreign owner header is a 404.
   *
   * `console.warn` was not a substitute. It reaches a developer with a debugger open, which is the
   * one reader who did not need telling.
   */
  async function commit(next: Itinerary, what: string): Promise<boolean> {
    if (!trip) return false;
    const previous = trip;
    setTouched(true);
    setTrip({ ...trip, itinerary: next });
    if (await updateTripItinerary(trip.id, next)) {
      setSaveError(null);
      return true;
    }
    setTrip(previous);
    setSaveError(`${what} did not save, so the change has been put back.`);
    return false;
  }

  async function applyRepair(days: DayPlan[], label: string) {
    // Refusing before the optimistic update, with the offline banner saying why, is the
    // difference between a stated limit and a glitch. `commit` covers the other direction:
    // online, but turned down.
    if (!trip || offline) return;
    const previous = trip.itinerary;
    const next = { ...previous, days };
    chat.remember(previous, diffItineraries(previous, next).days);
    await commit(next, `"${label}"`);
  }

  /**
   * What a stop really cost, how sure that is, and — in the same write — whether it is locked.
   *
   * **Booked and locked are one fact now.** A cost marked Booked or Paid fixes the stop, and
   * Estimate releases it (`surenessFields`). They were two controls, and a stop could read Booked,
   * Unlock and Estimate at once. This is also the ONLY way the lock is ever cleared — `applyPatch`
   * refuses an op that would, because a planner able to unlock a stop could unlock it and move it
   * in one turn.
   *
   * Optimistic then rolled back, the same bargain `onAdd` strikes below and for the same reason:
   * the write is a whole-itinerary overwrite with no server-side undo, so the only honest recovery
   * is to put back the object we replaced.
   *
   * An `undefined` cost clears the figure and returns the stop to the planner's estimate — which is
   * different from `0`, a real answer meaning it turned out to be free.
   */
  async function setCost(dayIndex: number, stopIndex: number, cost: number | undefined, sureness: Sureness) {
    if (!trip || offline) return;
    // Read before the map below changes it, so the message names what was asked for.
    const wasFixed = trip.itinerary.days[dayIndex]?.stops[stopIndex]?.timeFlexibility === 'FIXED';
    const fields = surenessFields(sureness);
    const next: Itinerary = {
      ...trip.itinerary,
      days: trip.itinerary.days.map((plan, di) =>
        di !== dayIndex
          ? plan
          : {
              ...plan,
              stops: plan.stops.map((stop, si) =>
                si !== stopIndex ? stop : { ...stop, actualCost: cost, ...fields }
              ),
            }
      ),
    };
    const locking = fields.timeFlexibility === 'FIXED';
    await commit(next, locking === wasFixed ? 'That cost' : locking ? 'Marking that stop booked' : 'Unlocking that stop');
  }

  function closeSheet() {
    setAdding(false);
    setProbe(null);
  }

  function findNearby(stop: { name: string; lat: number; lng: number }) {
    setProbe({ lat: stop.lat, lng: stop.lng, name: stop.name });
    setAdding(true);
  }

  /**
   * Live if the network answers, the copy on disk if it does not.
   *
   * Today is the screen somebody opens standing in a street, and its header is a link straight
   * here — a trip screen that went blank underground would make the on-trip mode a dead end one
   * tap in. `loadTrip` also writes the copy this reads back, so simply opening a trip while
   * connected is what arms it.
   */
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  /** No copy on disk and TripMate could not be reached at all: the offline screen, not a notice. */
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    let alive = true;
    loadTrip(id).then((hit) => {
      if (!alive) return;
      setTrip(hit?.value ?? null);
      setCachedAt(hit?.cachedAt ?? null);
      setUnreachable(!hit && lastRequestReachedServer() === false);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  /** The offline screen's Try again: the same read, applied only when it got through. */
  const retryLoad = useCallback(async () => {
    const hit = await loadTrip(id);
    if (!hit && lastRequestReachedServer() === false) return null;
    return () => {
      setTrip(hit?.value ?? null);
      setCachedAt(hit?.cachedAt ?? null);
      setUnreachable(false);
    };
  }, [id]);

  /** Nothing may be written against a copy from disk. */
  const offline = cachedAt !== null;

  /**
   * **Memoised because `headerRight` is a native header, not a view in the page.** Every day swipe
   * re-renders this screen, and an inline closure would hand react-navigation a new element each
   * time — the same cost the note above the title records for a title that changes per day. This
   * identity turns over only when the trip itself does, which is when the icon's own state can
   * actually have changed.
   */
  const shareRight = useCallback(
    () =>
      trip ? (
        <ShareButton
          trip={trip}
          offline={offline}
          onShared={(shared) => setTrip({ ...trip, shared })}
        />
      ) : null,
    [trip, offline]
  );

  if (trip === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
        <Loading />
      </View>
    );
  }

  if (trip === null && unreachable) {
    return (
      <>
        {/* Its own Go back on the night, not the native header, which would sit over it in paper. */}
        <Stack.Screen options={{ headerShown: false }} />
        <OfflineScreen retry={retryLoad} exclude={id} onBack={router.canGoBack() ? router.back : undefined} />
      </>
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
  // A day with nothing on the map has nothing to fly to.
  const canPlay = drawableStops(days[day]?.stops ?? []).length > 0;

  return (
    <View style={styles.screen}>
      {/* Chevron only. The back label defaults to the previous screen's title, which for a route
          group is the literal string "(tabs)" — and naming one tab would be wrong anyway, since
          a trip opens from both Home and Trips. The title stays the destination rather than
          the day: a nav title that changes on every swipe is noise, and it re-renders the native
          header each time. */}
      <Stack.Screen
        options={{
          title: trip.destination,
          headerBackButtonDisplayMode: 'minimal',
          // A draft is not a thing to send anybody, so the slot is simply empty until Keep — the
          // same mutual exclusion `KeepShelf` and the old shelf had, expressed as presence.
          headerRight: trip.status === 'draft' ? undefined : shareRight,
          headerShown: !filming,
        }}
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
          {filming ? null : (
            <>
              <View style={styles.chrome}>
                <ThemedText type="label" themeColor="muted">
                  {formatRange(trip.startDate, trip.endDate)}
                </ThemedText>
                {/* The strip alone now: which day you are reading is navigation, and everything
                    that acts on the day moved to the toolbar at the thumb. That also leaves the
                    strip the row's whole width, which is the constraint a fortnight needs. */}
                <DayStrip days={days} current={day} onSelect={setDay} marked={chat.pending?.diff.days ?? []} />
              </View>

              {/* Says which copy this is, once, above everything it explains. Each disabled control
                  below goes grey without repeating the reason — eight copies of "no connection" is
                  a screen shouting, and the state is a property of the screen rather than of any
                  one button. */}
              {offline ? (
                <View style={styles.status} accessibilityLiveRegion="polite">
                  <SymbolView name={{ ios: 'icloud.slash', android: 'cloud_off' }} tintColor={Colors.muted} size={18} />
                  <View style={styles.grow}>
                    <ThemedText type="detail" style={{ fontWeight: '600' }}>
                      {`Offline${clockAt(cachedAt) ? ` · saved ${clockAt(cachedAt)}` : ''}`}
                    </ThemedText>
                    <ThemedText type="detail" themeColor="muted">
                      Changes wait until you are back.
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {/* Up here rather than as a shelf at the foot: the foot is the toolbar's now, and an
                  unkept plan is a fact about the trip that belongs with the other one, offline. */}
              {trip.status === 'draft' ? (
                <KeepShelf trip={trip} onKept={(endDate) => setTrip({ ...trip, status: 'saved', endDate })} />
              ) : null}

              {/* **A refused write, said out loud.** Coral, because this is the alert sense the One
                  Meaning Rule reserves it for: something the traveller asked for cannot happen. It
                  sits in the same slot as the offline line above and never both at once — offline is
                  refused before the optimistic update, so a failure here is always the online kind.

                  An event rather than a state, so it does not linger like the banner above it: the
                  next write that succeeds clears it, and a tap dismisses it in the meantime. The live
                  region is what makes it reach a screen reader at all — the value the traveller just
                  typed snaps back somewhere further down the page, and nothing else announces. */}
              {saveError || (!chat.visible && !chat.pending && chat.failure) ? (
                <Pressable
                  style={styles.stale}
                  onPress={() => {
                    setSaveError(null);
                    chat.dismissFailure();
                  }}
                  accessibilityRole="button"
                  accessibilityLiveRegion="polite"
                  accessibilityHint="Dismisses this message">
                  <ThemedText type="detail" themeColor="alert">
                    {saveError ?? chat.failure}
                  </ThemedText>
                </Pressable>
              ) : null}

              {trip && importNoteLines(trip.itinerary).length > 0 ? (
                // Inset to the same edge as the PlanHealth card beneath it, so the two read as one block.
                <View style={styles.importNotes}>
                  {importNoteLines(trip.itinerary).map((line) => (
                    <ThemedText key={line} type="detail" themeColor="muted">
                      {line}
                    </ThemedText>
                  ))}
                </View>
              ) : null}
              {health && (touched || chat.turns.length > 0 || (trip && showsHealthOnOpen(trip.itinerary))) ? (
                <PlanHealth health={health} />
              ) : null}

              <AnchorReceipt
                itinerary={trip.itinerary}
                kept={trip.status !== 'draft'}
                onFitAnchor={(name) => askWith(fitMessage(name))}
              />
            </>
          )}

          <View style={styles.faces}>
            <DayPager
              trip={trip}
              day={day}
              onDayChange={setDay}
              emphasis={emphasis}
              onEmphasise={setEmphasis}
              onFindNearby={findNearby}
              findings={findings}
              onSetCost={setCost}
              onBudget={() => setBudgetSheet('day')}
              footer={filming ? 0 : toolbarHeight}
              onAsk={(message: string) => askWith(message, day)}
              repairs={repairs}
              onRepair={applyRepair}
              offline={offline}
              proposal={chat.pending ? { itinerary: chat.pending.itinerary, diff: chat.pending.diff } : null}
            />

            {mapBuilt ? (
              <MapFace visible={face === 'map'}>
                <DayMap
                  stops={days[day]?.stops ?? []}
                  dayIndex={day}
                  emphasis={stopIndexFor(emphasis, day)}
                  onEmphasise={(stop) => setEmphasis(stop === null ? null : `${day}:${stop}`)}
                  film={filming ? { stop: film.stop, inset: sheetHeight } : undefined}
                  lift={filming ? 0 : toolbarHeight}
                />
              </MapFace>
            ) : null}

            {filming ? (
              <StoryPanel
                film={film}
                destination={trip.destination}
                day={days[day]}
                dayIndex={day}
                dayCount={days.length}
                onClose={closeFilm}
                onNextDay={() => setDay(day + 1)}
                onInset={setSheetHeight}
              />
            ) : null}
          </View>

          {filming ? null : chat.visible || chat.pending ? (
            <AskBar
              mode={chat.pending ? 'decide' : 'ask'}
              draft={chat.draft}
              onDraft={chat.setDraft}
              scope={chat.scope}
              onScope={chat.setScope}
              currentDay={day}
              days={days}
              replying={chat.replying}
              failure={chat.failure}
              asked={chat.asked}
              reply={chat.reply}
              turns={chat.turns.length}
              onHistory={() => setHistory(true)}
              pending={chat.pending?.diff ?? null}
              applying={chat.applying}
              onApply={chat.apply}
              onKeep={chat.discard}
              onSend={chat.send}
              onClose={chat.close}
              onHeight={setToolbarHeight}
            />
          ) : (
            <>
              {/* An approved change is easiest to regret once it is in the plan, so the way back
                  sits right above the control that made it, until the next ask replaces it. */}
              {chat.undoable ? (
                <View pointerEvents="box-none" style={[styles.undoDock, { bottom: toolbarHeight + Spacing.tight }]}>
                  <Pressable
                    onPress={chat.undo}
                    accessibilityRole="button"
                    accessibilityLabel={`${daysUpdatedLabel(chat.undoable.days)}. Undo`}
                    style={({ pressed }) => [styles.undo, pressed && styles.pressedRow]}>
                    <SymbolView name={{ ios: 'checkmark', android: 'check' }} tintColor={Colors.muted} size={12} />
                    <ThemedText type="detail" themeColor="muted">
                      {daysUpdatedLabel(chat.undoable.days)}
                    </ThemedText>
                    <ThemedText type="detail" themeColor="accentText" style={styles.undoAction}>
                      Undo
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}
              <TripToolbar
                face={face}
                onFace={setFace}
                canPlay={canPlay}
                onPlay={startFilm}
                offline={offline}
                // The plain Ask is about the trip, not the day you happen to be reading. Whatever
                // was left in the box when it last closed is still there.
                onAsk={() => chat.open(undefined, null)}
                onAdd={() => setAdding(true)}
                spent={tripSpend(days)}
                budget={trip.budget}
                onBudget={() => setBudgetSheet('trip')}
                onHeight={setToolbarHeight}
              />
            </>
          )}
        </>
      )}

      <BudgetSheet
        visible={budgetSheet !== null}
        initial={budgetSheet ?? 'trip'}
        days={days}
        budget={trip.budget}
        dayIndex={day}
        offline={offline}
        onDay={setDay}
        onSureness={(dayIndex, stopIndex, sureness) =>
          setCost(dayIndex, stopIndex, days[dayIndex]?.stops[stopIndex]?.actualCost, sureness)
        }
        onClose={() => setBudgetSheet(null)}
      />

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
          // The write is a whole-itinerary overwrite with no server-side transaction to undo, so
          // the only honest recovery is to put the object we replaced back exactly as it was —
          // which `commit` does, and now says out loud.
          const previous = trip.itinerary;
          if (!(await commit(next, `Adding ${name}`))) return false;
          // Nothing in this app removes a stop, so before this an add was permanent short of
          // asking the planner to undo it in words. The day is read off the diff rather than
          // passed down: the sheet may add to a day other than the one being read, and the
          // comparison already knows which one it was.
          chat.remember(previous, diffItineraries(previous, next).days);
          return true;
        }}
      />

      <ChatSheet
        visible={history}
        onClose={() => setHistory(false)}
        turns={chat.turns}
        replying={chat.replying}
        failure={chat.failure}
        days={days}
      />
    </View>
  );
}

/**
 * Sending the plan to somebody, and taking it back.
 *
 * **Publishing is an act, and this is the only thing that performs it.** A trip is readable by
 * its owner and nobody else until this is pressed; the link it produces is a token the server
 * mints, not the trip's own id, so withdrawing it later actually withdraws it.
 *
 * The native sheet rather than a copy button: on a phone the next step after "share" is always a
 * particular person in a particular app, and the platform already knows which ones. `Share.share`
 * resolves either way — `dismissedAction` when they back out — so there is nothing to report
 * about the outcome and nothing is claimed about it.
 *
 * **It was a shelf across the foot of the screen, and the shelf outweighed the act.** Two lines
 * of chrome — a sentence and a pill — permanently occupying the bottom of every saved trip, for
 * something most readers do once or never, while the nav bar's trailing slot sat empty opposite
 * the back chevron. As an icon it costs one glyph, it balances the chevron, and it sits where
 * iOS has put share since the first iPhone, so it needs no label to be found.
 *
 * **The two sentences the shelf carried are not dropped, they move into the confirm.** An icon
 * cannot say "stop sharing" and must not silently perform it, so a trip that is already shared
 * opens the platform's own alert: the promise ("they cannot change it") is its message, and
 * withdrawing is a destructive button there rather than a pill somebody can hit by accident.
 * An unshared trip skips the alert entirely — pressing share to share is not a question.
 *
 * `POST /api/trips/[id]/share` is idempotent and hands back the link a shared trip already has
 * (see that route), so "Send the link" and the first press are the same call.
 *
 * Disabled offline rather than hidden, matching every other control on this screen: the banner
 * above says why once, and eight controls each repeating it is a screen shouting.
 */
function ShareButton({
  trip,
  offline,
  onShared,
}: {
  trip: Trip;
  offline: boolean;
  onShared: (shared: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    const result = await shareTrip(trip.id);
    setBusy(false);
    if (!result) {
      Alert.alert('That didn\u2019t go through', 'Try again.');
      return;
    }
    onShared(true);
    // **One field, chosen by platform — not both.** Sending `message` and `url` together is the
    // obvious-looking call and it is wrong: iOS treats them as two separate items and the sheet
    // offers "2 Links" for what is one link. Observed on the simulator. Android has no `url` at
    // all and drops it silently, so it has to take `message`.
    await Share.share(
      Platform.OS === 'ios' ? { url: result.url } : { message: result.url }
    ).catch(() => {});
  }

  async function stop() {
    setBusy(true);
    const ok = await unshareTrip(trip.id);
    setBusy(false);
    if (ok) onShared(false);
    else Alert.alert('That didn\u2019t go through', 'Try again.');
  }

  function press() {
    if (!trip.shared) {
      void send();
      return;
    }
    Alert.alert(
      'This plan is shared',
      'Anyone with the link can read it. They cannot change it.',
      [
        { text: 'Send the link', onPress: () => void send() },
        { text: 'Stop sharing', style: 'destructive', onPress: () => void stop() },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  return (
    <Pressable
      onPress={press}
      disabled={busy || offline}
      accessibilityRole="button"
      // The icon alone is the label for sighted readers; this is the whole sentence for everyone
      // else, and it has to carry the state because the tint that carries it visually does not
      // reach VoiceOver.
      accessibilityLabel={trip.shared ? 'Shared. Send the link or stop sharing' : 'Share a link'}
      accessibilityState={{ disabled: busy || offline }}
      hitSlop={12}>
      {busy ? (
        <ActivityIndicator size="small" color={Colors.muted} />
      ) : (
        <SymbolView
          // Object form, never a bare SF string: given one, the Android path renders nothing at
          // all, silently. Same trap as `plan/_layout`'s close button.
          name={{ ios: 'square.and.arrow.up', android: 'share' }}
          // Jade only while the plan is actually out there. This is the one place the accent
          // reports a state rather than inviting a press, and it is still an action colour on an
          // action — the trip being shared is what the press is about.
          tintColor={offline ? Colors.muted : trip.shared ? Colors.accentText : Colors.foreground}
          size={20}
          fallback={
            <ThemedText type="label" themeColor={offline ? 'muted' : 'foreground'}>
              Share
            </ThemedText>
          }
        />
      )}
    </Pressable>
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
  /** A day to open straight away on — the screen was entered from Today's "Plans changed?". */
  openOnDay: number | null,
  /** A proposal has landed: the screen shows a day it changes. */
  onProposal: (diff: ItineraryDiff) => void
) {
  /** Whether the toolbar is open into the box. */
  const [visible, setVisible] = useState(openOnDay !== null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  /**
   * What is in the box. Here rather than in the bar, because the bar comes and goes with the
   * toolbar and the words should not: closing it is not deleting them, and a seeded opening —
   * "Fit it anyway", a stop's "Fix this" — has to set them from outside.
   */
  const [draft, setDraft] = useState('');
  /**
   * What the next message may change: a day index, or null for the whole trip.
   *
   * **Whole trip is the default, and that is a decision rather than an omission.** The Swift app
   * scope-locked every conversation to whatever day was on screen, so "move the market to day 3"
   * came back refused with nothing having said it would be. So the scope is stated before you ask,
   * it starts wide, and narrowing it is a thing you do rather than a side effect of where you were
   * standing. Per turn, not per conversation: the prompt carries it on every message.
   */
  const [scope, setScope] = useState<number | null>(openOnDay);
  /** How many turns there were when the box opened: the bar answers only what was asked since. */
  const [openedAt, setOpenedAt] = useState(0);
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
    chatTurns(id).then((saved) => {
      if (!saved.length) return;
      setTurns(saved);
      setOpenedAt(saved.length);
    });
  }, [visible, trip, id]);

  /** `seed` replaces the box's words — never sends them; undefined leaves whatever was there. */
  function open(seed?: string, at?: number | null) {
    if (seed !== undefined) setDraft(seed);
    if (at !== undefined) setScope(at);
    setOpenedAt(turns.length);
    setFailure(null);
    setVisible(true);
  }

  async function send(text: string): Promise<boolean> {
    const body = text.trim();
    if (!trip || !body || replying) return false;
    const dayIndex = scope ?? undefined;
    // Out of the box the moment it goes, and back into it if it does not arrive — nobody retypes.
    setDraft('');
    // Stamped with the scope it goes out under, matching what `/api/trip-edit` writes to the
    // transcript — so a live turn and a restored one carry the same label and the sheet never
    // shows the stamp appearing on reload.
    setTurns((prior) => [...prior, { role: 'user', content: body, scope: dayIndex ?? null }]);
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
          { role: 'user' as const, content: body },
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
        setDraft(body);
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
      onProposal(diff);
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
      // Folds back into the toolbar, with Undo just above it.
      setVisible(false);
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
    setVisible(false);
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

  const since = turns.slice(openedAt);
  return {
    visible,
    open,
    close: () => setVisible(false),
    draft,
    setDraft,
    scope,
    setScope,
    /** The planner's latest answer since the box opened. */
    reply: [...since].reverse().find((turn) => turn.role === 'assistant') ?? null,
    /** What is being worked on, while it is. */
    asked: replying ? ([...since].reverse().find((turn) => turn.role === 'user')?.content ?? null) : null,
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
    dismissFailure: () => setFailure(null),
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
  onSetCost,
  onBudget,
  footer,
  onAsk,
  repairs,
  onRepair,
  offline,
  proposal,
}: {
  trip: Trip;
  day: number;
  onDayChange: (day: number) => void;
  emphasis: string | null;
  onEmphasise: (key: string | null) => void;
  onFindNearby: (stop: Stop) => void;
  /** Every finding for the whole trip; each day takes its own slice below. */
  findings: Guardrail[];
  onSetCost: (dayIndex: number, stopIndex: number, cost: number | undefined, sureness: Sureness) => void;
  onBudget: () => void;
  /** The floating toolbar's height — see `DayPage`. */
  footer: number;
  onAsk: (message: string) => void;
  repairs: (finding: Guardrail) => Repair[];
  onRepair: (days: DayPlan[], label: string) => void;
  /** Serving a copy from disk, so nothing below may write — see `DayPage`. */
  offline: boolean;
  /** A change waiting for approval, drawn on each day it touches. */
  proposal: { itinerary: Itinerary; diff: ItineraryDiff } | null;
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
            onSetCost={(stopIndex, cost, sureness) => onSetCost(index, stopIndex, cost, sureness)}
            onBudget={onBudget}
            footer={footer}
            offline={offline}
            onAsk={onAsk}
            repairs={repairs}
            onRepair={onRepair}
            preview={
              proposal?.diff.days.includes(index)
                ? {
                    rows: proposalRows(dayPlan, proposal.itinerary.days[index], index, proposal.diff),
                    dayName: (i) => {
                      const chip = formatDayChip(days[i]?.date ?? '');
                      return chip ? `Day ${i + 1} · ${chip.weekday} ${chip.dayOfMonth}` : `Day ${i + 1}`;
                    },
                  }
                : null
            }
          />
        </View>
      ))}
    </ScrollView>
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
  marked,
}: {
  days: DayPlan[];
  current: number;
  onSelect: (day: number) => void;
  /** Days a waiting proposal would change: a dot, so a change landing off-screen is not missed. */
  marked: number[];
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
            accessibilityLabel={`Day ${index + 1} of ${count}${marked.includes(index) ? ', changes here' : ''}`}
            style={[styles.chip, active && styles.chipActive]}>
            {marked.includes(index) ? <View style={styles.chipMark} /> : null}
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
    <View style={styles.status}>
      <SymbolView name={{ ios: 'doc.text', android: 'description' }} tintColor={Colors.muted} size={18} />
      <View style={styles.grow}>
        <ThemedText type="detail" style={{ fontWeight: '600' }}>Draft</ThemedText>
        {failed ? (
          <ThemedText type="detail" themeColor="alert">
            That didn&rsquo;t go through. Try again.
          </ThemedText>
        ) : (
          <ThemedText type="detail" themeColor="muted">
            Not under Trips until you keep it.
          </ThemedText>
        )}
      </View>
      <Pressable onPress={discard} disabled={!!busy} accessibilityRole="button" hitSlop={8}>
        <ThemedText type="detail" themeColor="muted">
          {busy === 'discard' ? 'Discarding…' : 'Discard'}
        </ThemedText>
      </Pressable>
      <Pressable
        onPress={keep}
        disabled={!!busy}
        accessibilityRole="button"
        accessibilityLabel="Keep this trip"
        style={({ pressed }) => [styles.keep, pressed && styles.pressedRow]}>
        {busy === 'keep' ? (
          <ActivityIndicator color={Colors.accentForeground} />
        ) : (
          <ThemedText type="detail" style={{ color: Colors.accentForeground, fontWeight: '600' }}>
            Keep
          </ThemedText>
        )}
      </Pressable>
    </View>
  );
}

/** Chip width plus its gap — what one step along the strip measures. An estimate, and only
 *  used to keep the active chip on screen: it drifts as the text scales, and landing a few
 *  points out of centre is invisible where failing to scroll at all would not be. */
const CHIP_STRIDE = 52;

const styles = StyleSheet.create({
  importNotes: { marginHorizontal: Spacing.read, gap: Spacing.hair },
  screen: { flex: 1, backgroundColor: Colors.canvas },
  stateWrap: { paddingTop: Spacing.regular },

  chrome: {
    paddingHorizontal: Spacing.read,
    paddingBottom: Spacing.tight,
    gap: Spacing.tight,
  },
  grow: { flex: 1 },
  faces: { flex: 1 },
  // `flexGrow` + `space-between` is the whole alignment fix: seven fixed-width chips came to
  // 356pt in a 370pt row, so the strip stopped 30pt short of a right margin every other row in
  // the chrome runs flush to. Narrower than the row, the chips now share the slack and the last
  // one lands on the margin; wider than it — a fortnight — neither rule has anything to give and
  // it scrolls exactly as before.
  // No `flexGrow` and no `space-between`: together they shared the leftover width out between
  // the chips, which is invisible on a seven-day trip that already fills the row and spreads a
  // three-day trip across the whole screen. The gap is the spacing; the row is only as wide as
  // its chips.
  /**
   * **`flexGrow` so a strip that fits ends where the row beneath it ends.**
   *
   * The chips were always evenly spaced — measured, seven of them at exactly 44.00pt with six
   * 8.00pt gaps. What was uneven was the row: left-aligned content in a padded box leaves its
   * remainder on the right, so a seven-day strip ran 16pt→371.67pt while the List/Map · Ask · +
   * row directly below runs 16pt→386pt. Two stacked rows disagreeing about their right edge by
   * 14pt is what the eye calls "not evenly spaced", and it is why this kept getting reported
   * against chips that were already identical.
   *
   * It is a function of the day count, which is why it comes and goes: three days is obviously a
   * short list and nobody reads the gap as an error, fourteen days overflows and scrolls flush,
   * and seven — the common trip — lands 14pt short, near enough to fill that the shortfall reads
   * as a mistake. Growing the chips into the remainder fixes every count that fits, and on a
   * count that does not there is no remainder to share, so the scroller behaves exactly as before.
   */
  strip: {
    gap: Spacing.tight,
    alignItems: 'flex-end',
    flexGrow: 1,
  },
  stale: { paddingHorizontal: Spacing.read, paddingBottom: Spacing.tight },
  /** A fact about the whole trip — offline, or not kept yet — said once, above the faces it
   *  applies to: a neutral slate card with its icon, never a tint on the page. */
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.rows,
    marginHorizontal: Spacing.read,
    marginBottom: Spacing.tight,
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.tight,
    borderRadius: Radius.surface,
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  keep: {
    minHeight: 36,
    minWidth: 64,
    paddingHorizontal: Spacing.read,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.foreground,
  },
  // No fixed height: two lines of text at the accessibility sizes need the room, and a chip
  // that clips its weekday is worse than a taller strip. `read` rather than `pill`, because a
  // two-line pill is a lozenge.
  chip: {
    // Share whatever the row has left over, never give any back: `flexShrink: 0` is what keeps a
    // fourteen-day strip at its natural width so it scrolls rather than squashing to fit. Basis
    // stays auto so a chip still sizes to its own text at the accessibility sizes.
    flexGrow: 1,
    flexShrink: 0,
    minWidth: 44,
    paddingHorizontal: Spacing.tight,
    paddingVertical: 5,
    borderRadius: Radius.read,
    backgroundColor: Colors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipWeekday: { marginTop: -1 },
  chipMark: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
  },
  undoDock: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingLeft: Spacing.rows,
    paddingRight: Spacing.hair,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  undoAction: {
    fontWeight: '600',
    paddingHorizontal: Spacing.rows,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    backgroundColor: Colors.control,
  },
  chipActive: {
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },

  // The keep shelf's material, but left-aligned and without its centred, decision-shaped
  // emphasis: keeping a plan is the step that gates the trip, and sharing one is a thing you may
  // never do. Same gutters so the two occupy the same slot without the page shifting.
  pressedRow: { opacity: 0.6 },
});
