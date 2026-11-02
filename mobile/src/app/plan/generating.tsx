import { CormorantGaramond_400Regular, CormorantGaramond_500Medium_Italic } from '@expo-google-fonts/cormorant-garamond';
import { InterTight_400Regular, InterTight_500Medium, InterTight_600SemiBold } from '@expo-google-fonts/inter-tight';
import { Oswald_400Regular } from '@expo-google-fonts/oswald';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { createTripDraft, generateTrip, getRunStatus, getTrip, placePhoto, saveProfile, tripFetch, updateTripItinerary } from '@/api/tripMateApi';
import type { Itinerary, SketchEvent, StreamedStop } from '@/api/types';
import { PrimaryButton } from '@/components/form';
import { Meridian } from '@/components/meridian';
import { Notice } from '@/components/states';
import { WritingThePlan } from '@/components/writing-the-plan';
import { Polar } from '@/constants/polar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { usePlanLiveActivity } from '@/lib/planLiveActivity';
import { recoveryStep } from '@/lib/planRecovery';
import { tierName, tripDays } from '@/lib/tiers';
import { assembleDays, type DayCoords } from '@/lib/writingPlan';
import { buildDestinationFacts } from '@shared/destinationFacts';
import { formatDateRange } from '@shared/format';
import { STAGE_ORDER, type StageProgress } from '@shared/generationStages';
import { meriForGeneration } from '@shared/meri';
import type { RawFetch } from '@shared/types';
import { toGenerateRequest, toTravelerProfile, toUserAnswers, usePlanDraft } from '@/lib/planDraft';
import { Text } from '@/components/themed-text';

/** How often a plan whose stream was lost is asked after. A status read, free: no allowance. */
const RECOVERY_POLL_MS = 4000;

/**
 * The wait, drawn as the live map writing the plan (`components/writing-the-plan.tsx`).
 *
 * **The Polar faces load here, as on `/landing`**: the root loads the display cut and the two
 * figure cuts every screen uses, and the italic, Inter Tight Regular and Oswald belong to the
 * Polar screens alone. Nothing renders until they are in, because a missing family is not an
 * error in RN; the night ground holds the frame meanwhile.
 */
export default function Generating() {
  const router = useRouter();
  const { draft } = usePlanDraft();
  const [fontsLoaded] = useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_500Medium_Italic,
    InterTight_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
    Oswald_400Regular,
  });

  const [stages, setStages] = useState<StageProgress[]>(() => STAGE_ORDER.map((stage) => ({ stage, status: 'pending' })));
  const [stops, setStops] = useState<StreamedStop[]>([]);
  const [sketch, setSketch] = useState<SketchEvent['days']>([]);
  const [coords, setCoords] = useState<DayCoords>({});
  const [failure, setFailure] = useState<string | undefined>();
  /** The plan is saved: the card says so over the map for a beat, then the trip opens. */
  const [ready, setReady] = useState(false);
  /** Bumped by Try again, which runs the same answers again from the top. */
  const [attempt, setAttempt] = useState(0);
  const reduce = useReducedMotion();
  // The trip-fetch bundle (forecast, calendar, the city's centre) and the place's Wikipedia line,
  // for the facts. Both are already cached by the wizard's own calls for these dates.
  const [raw, setRaw] = useState<RawFetch | null>(null);
  const [wikiExtract, setWikiExtract] = useState<string | null>(null);
  /** Cancel's lever: closes the stream. The route has no cancellation token (see `generateTrip`). */
  const abort = useRef<AbortController | null>(null);
  /** False once the traveller has left, by Cancel or by unmounting; every handler checks it. */
  const live = useRef(true);

  // A generation is 60-246 seconds of billed work. Under React 19's development double-invoke
  // this effect runs twice, which would start two of them; the ref makes each attempt start once.
  const started = useRef(-1);
  /**
   * The row this screen wrote, so the reviewed plan arriving ~150s later knows what to correct.
   *
   * A ref rather than state, and read from a callback that fires *after* this screen has
   * unmounted: by then the traveller is on the trip screen, and the only thing left to do is fix
   * what is stored.
   */
  const written = useRef<{ id: string; itinerary: Itinerary } | null>(null);
  /**
   * The run the server is writing, from the stream's first frame, and when it began.
   *
   * iOS suspends the app when it is left and the stream drops, while the server carries on and
   * saves the plan as a draft itself. So a lost stream with a run in hand is not a failure: this
   * screen asks what became of the run (`recovering`) and opens the plan when it is there.
   */
  const run = useRef<{ id: string; startedAt: number } | null>(null);
  const [recovering, setRecovering] = useState(false);
  /** When the run began, as state, so the Live Activity starts with it. */
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  /** The place's photograph, for the Live Activity's artwork. */
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (started.current === attempt) return;
    started.current = attempt;
    live.current = true;

    const { destination, startDate, endDate, budget } = draft;
    const controller = new AbortController();
    abort.current = controller;

    void tripFetch(destination, startDate, endDate).then((bundle) => {
      if (live.current) setRaw(bundle);
    });
    void placePhoto(destination).then((photo) => {
      if (!live.current) return;
      setWikiExtract(photo?.extract ?? null);
      setPhotoUrl(photo?.thumbnailUrl ?? photo?.imageUrl ?? null);
    });

    generateTrip(
      toGenerateRequest(draft),
      {
        onRun: (id) => {
          run.current = { id, startedAt: Date.now() };
          if (live.current) setRunStartedAt(run.current.startedAt);
        },
        onStage: (event) => {
          if (!live.current) return;
          setStages((prev) => prev.map((s) => (s.stage === event.stage ? { ...s, status: event.status } : s)));
        },
        onStop: (event) => {
          if (!live.current) return;
          // Replace by position rather than append: a stop can be re-sent as the model revises
          // its own line, and appending would show it twice.
          setStops((prev) => {
            const next = prev.filter(
              (s) => !(s.dayIndex === event.dayIndex && s.stopIndex === event.stopIndex)
            );
            next.push(event);
            return next.sort(
              (a, b) => a.dayIndex - b.dayIndex || a.stopIndex - b.stopIndex
            );
          });
        },
        onSketch: (event) => {
          if (live.current) setSketch(event.days);
        },
        onDayCoords: (event) => {
          if (live.current) setCoords((prev) => ({ ...prev, [event.dayIndex]: event.coords }));
        },
        onPlan: async (result) => {
          if (!live.current) return;
          // A row exists the moment a plan does, as a draft — so a back press cannot throw away
          // four minutes of work. Keep promotes this same row later.
          // The server saved it already (`tripId`); the client's own save stays as the fallback, and
          // finds that same row if both run.
          const id = result.tripId ?? await createTripDraft({
            destination,
            startDate,
            endDate,
            budget,
            itinerary: result.itinerary,
            status: 'draft',
            runId: result.runId,
            chatSessionId: result.sessionId,
            // Stored so the edit loop can reuse the answers without asking again.
            userAnswers: toUserAnswers(draft),
          });
          // The durable half of the draft becomes the traveller profile. Unawaited: a plan is
          // not worth blocking on a preference write, and the Profile tab reads it next time.
          void saveProfile(toTravelerProfile(draft));
          if (!live.current) return;
          if (!id) {
            setFailure('The plan was written, but saving it failed. Try generating again.');
            return;
          }
          written.current = { id, itinerary: result.itinerary };
          // The ending is the map, not a cut: the card fills and says "ready" over the day the
          // traveller just watched being drawn, then the trip opens. Replace, not push: the wait is
          // not somewhere to come back to.
          setReady(true);
          setTimeout(() => router.replace(`/trip/${id}`), reduce ? 200 : 1100);
        },
        /**
         * The reviewed plan, landing after this screen is gone.
         *
         * **Deliberately not guarded by `live`.** Every other callback here is, because they
         * write component state; this one runs precisely *because* the screen was left, and
         * dropping it would put us back to keeping the un-reviewed draft forever.
         *
         * **The traveller's own edits win.** They have had ~150s on the trip screen and may have
         * added a stop, marked something booked, or asked for a change. So this re-reads what is
         * actually stored and writes only if it still matches the draft we left — anything else
         * and the review is dropped rather than allowed to overwrite a person's decision with a
         * model's. Skipping is safe: it leaves exactly the plan they are already looking at.
         *
         * **It corrects storage, not the screen.** There is no attempt to swap the plan out from
         * under someone mid-read, which would move stops under their eyes with no explanation;
         * the corrected version is simply what they get from the next time they open the trip.
         */
        onFinal: async (result) => {
          const row = written.current;
          if (!row) return;
          if (sameItinerary(row.itinerary, result.itinerary)) return;
          const current = await getTrip(row.id);
          if (!current || !sameItinerary(current.itinerary, row.itinerary)) return;
          await updateTripItinerary(row.id, result.itinerary);
        },
      },
      controller.signal
    ).then((error) => {
      if (!live.current || !error) return;
      // A dropped stream for a run that exists: the plan may well be written. Ask, don't fail.
      if (error.kind === 'failed' && run.current && !written.current) setRecovering(true);
      else setFailure(error.message);
    });

    return () => {
      live.current = false;
    };
    // params is a fresh object each render; the ref above is what actually guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Asks what became of the run every few seconds while the app is in front, until the plan is
  // there (and opens it, as the stream would have), the run failed, or far too long has passed.
  useEffect(() => {
    if (!recovering) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const held = run.current;
      if (stopped || !held) return;
      if (AppState.currentState !== 'active') {
        timer = setTimeout(check, RECOVERY_POLL_MS);
        return;
      }
      const step = recoveryStep(await getRunStatus(held.id), held.startedAt, Date.now());
      if (stopped || !live.current) return;
      if (step.action === 'open') {
        setRecovering(false);
        setReady(true);
        setTimeout(() => router.replace(`/trip/${step.tripId}`), reduce ? 200 : 1100);
      } else if (step.action === 'fail') {
        setRecovering(false);
        setFailure(step.message);
      } else {
        timer = setTimeout(check, RECOVERY_POLL_MS);
      }
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [recovering, reduce, router]);

  /** The same answers, from the top. Everything the last run streamed is cleared first. */
  function tryAgain() {
    run.current = null;
    setRunStartedAt(null);
    setRecovering(false);
    setStages(STAGE_ORDER.map((stage) => ({ stage, status: 'pending' })));
    setStops([]);
    setSketch([]);
    setCoords({});
    setFailure(undefined);
    setAttempt((n) => n + 1);
  }

  const planDays = useMemo(() => assembleDays(sketch, stops, coords, tripDays(draft.startDate, draft.endDate)), [sketch, stops, coords, draft.startDate, draft.endDate]);
  const facts = useMemo(
    () =>
      buildDestinationFacts({
        destination: draft.destination,
        rawFetch: raw,
        wikiExtract,
        viewerUtcOffsetMinutes: -new Date().getTimezoneOffset(),
      }),
    [draft.destination, raw, wikiExtract]
  );
  /**
   * The planner, with every answer as it was: the draft lives in the plan layout, which this does
   * not leave. `replace`, not `back` — the planner reaches this screen with `replace`, so it is not
   * underneath, and `back` would leave the flow altogether.
   */
  const backToReview = () => router.replace('/plan/basics');

  // The plan on the Dynamic Island and the Lock Screen while the traveller is away (iOS only).
  usePlanLiveActivity({
    startedAt: runStartedAt,
    phase: ready ? 'ready' : failure ? 'failed' : 'writing',
    destination: draft.destination,
    dateRange: draft.startDate && draft.endDate ? formatDateRange(draft.startDate, draft.endDate) : null,
    tripDays: tripDays(draft.startDate, draft.endDate),
    tierName: tierName(toGenerateRequest(draft).tier),
    stages,
    days: planDays,
    facts,
    photoUrl,
  });

  // A sketch alone is not streaming — only a real stop is.
  const meri = meriForGeneration({ complete: ready, streaming: stops.length > 0, failed: !!failure });

  if (failure) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
        <View style={styles.failure}>
          <View style={styles.meriFailed}>
            <Meridian state={meri} size={56} />
          </View>
          <Notice>{failure}</Notice>
          {/* Try again first: the answers were fine, the run was not, so the likeliest next step is
              the same plan again. Changing something is the second way out. */}
          <View style={styles.retry}>
            <PrimaryButton title="Try again" onPress={tryAgain} />
            <Pressable onPress={backToReview} accessibilityRole="button" style={styles.back}>
              <Text style={styles.backText}>Back to the details</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (!fontsLoaded) return <View style={styles.night} />;

  const request = toGenerateRequest(draft);
  const days = tripDays(draft.startDate, draft.endDate);
  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <WritingThePlan
        destination={draft.destination}
        dateRange={draft.startDate && draft.endDate ? formatDateRange(draft.startDate, draft.endDate) : null}
        tripDays={days}
        tierName={tierName(request.tier)}
        budget={draft.budget}
        stages={stages}
        days={planDays}
        facts={facts}
        raw={raw}
        ready={ready}
        seed={draft.destinationLat !== undefined && draft.destinationLng !== undefined ? { lat: draft.destinationLat, lon: draft.destinationLng } : null}
        note={recovering ? 'Still writing your plan. It carried on while you were away.' : 'You can leave the app. Your plan keeps being written and will be in Trips.'}
        onCancel={() => {
          live.current = false;
          abort.current?.abort();
          backToReview();
        }}
      />
    </>
  );
}

/**
 * Has anything a traveller could have changed, changed?
 *
 * Compares the fields an edit actually touches rather than the whole object, because the two sides
 * have taken different routes: one was held in memory, the other went to the server and back. A
 * field-by-field deep compare would report normalisation as an edit.
 *
 * **Errs towards "changed", on purpose.** A false positive drops the review and leaves the plan
 * exactly as the traveller sees it — the old behaviour, which was survivable for months. A false
 * negative overwrites something they did. The two mistakes are not the same size.
 */
function sameItinerary(a: Itinerary, b: Itinerary): boolean {
  const days = a.days ?? [];
  const other = b.days ?? [];
  if (days.length !== other.length) return false;
  return days.every((day, i) => {
    const stops = day.stops ?? [];
    const otherStops = other[i].stops ?? [];
    if (stops.length !== otherStops.length) return false;
    return stops.every((stop, j) => {
      const s = otherStops[j];
      return (
        stop.name === s.name &&
        stop.time === s.time &&
        stop.cost === s.cost &&
        stop.note === s.note &&
        stop.actualCost === s.actualCost &&
        stop.timeFlexibility === s.timeFlexibility
      );
    });
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  night: { flex: 1, backgroundColor: Polar.night },
  meriFailed: { paddingHorizontal: Spacing.read },
  failure: { paddingTop: Spacing.regular, gap: Spacing.read },
  retry: { paddingHorizontal: Spacing.read, gap: Spacing.tight },
  back: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '600', color: Colors.accentText },
});
