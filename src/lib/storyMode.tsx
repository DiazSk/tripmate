"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useMapCamera } from "@/lib/mapCamera";
import { fallbackScript, storyCacheKey, type StoryScript } from "@/lib/storyScript";
import { legBearingRad, tourFlightSeconds } from "@/lib/tourPacing";
import { metresBetween } from "@/lib/peekRange";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import type { NaturalVoiceStatus } from "@/lib/kokoroVoice";
import { loadNaturalVoice, naturalVoiceSupported } from "@/lib/kokoroVoice";
import {
  estimateDurationMs,
  silence,
  speakOn,
  speechAvailable,
  storedVoiceEngine,
  storeVoiceEngine,
  warmVoices,
  type SpeakHandle,
  type VoiceEngine,
} from "@/lib/storyVoice";
import type { DayPlan, Itinerary } from "@/lib/types";

/**
 * Story mode — the itinerary played as a film.
 *
 * One day at a time: the panel goes away, the map keeps whatever engine it was on, and the plan is
 * spoken beat by beat while the camera flies to the place being described and the matching line
 * lights up. This module is the controller — one state machine owning three things that have to
 * agree on which beat it is (the **camera**, the **voice**, and the **highlight**) — and
 * `StoryStage` is the only thing that draws it.
 *
 * **Why the camera lives here and not in the card.** The old Play tour stepped stops on a fixed
 * 6.5s interval (`useStopTour`, now retired). A narrated tour cannot: a beat lasts exactly as long
 * as it takes to say, which is known only when the voice reports it finished. So the beat is the
 * clock, and everything else is derived from it — which is also what makes Next honest. It cancels
 * the sentence and moves, rather than nudging a timer that the audio then talks over.
 *
 * **Two contexts, deliberately.** `useStoryControls` changes only when a story starts or ends;
 * `useStoryPlayback` changes on every beat. The controls are consumed by the page hosts and by
 * `ItineraryCard` — trees that have no business re-rendering because a sentence finished — and the
 * playback state by the stage alone. Same reasoning `mapCamera` gives for keeping the itinerary out
 * of its own context.
 */

/** Everything the controller needs to play a day, handed over by whoever pressed Play. */
export interface StoryRequest {
  itinerary: Itinerary;
  /** 0-based day to narrate. */
  dayIndex: number;
  /** The trip's destination, for the opening beat and for the run row. */
  destination: string;
  /** A real trip id caches the script server-side. The pre-save result view has none — see the
   *  note on `"preview"` in `/api/trip-story`. */
  tripId?: string;
}

/**
 * Where playback is.
 *
 * `loading` is the model call. It is a phase rather than a boolean because the camera has already
 * flown to the day by then — the film has started, it just has no words yet.
 */
export type StoryPhase = "loading" | "playing" | "paused" | "ended";

interface StoryControls {
  /** True while the film is up. The card stops driving the map on this, and the hosts swap their
   *  capsule's action for a pause. */
  active: boolean;
  /** The day being narrated, or null when nothing is. */
  dayIndex: number | null;
  /**
   * Where playback is, exposed here as well as on the playback context because the **capsule** is
   * the film's play/pause button — see the layout note on `StoryStage`. It changes a handful of
   * times per film (loaded, paused, resumed, ended), not per beat, so the hosts reading it does
   * not put them on the beat clock.
   */
  phase: StoryPhase;
  start: (request: StoryRequest) => void;
  /**
   * Warm the script for the day **in focus** — not the day playing — so Play is instant.
   *
   * Called by whichever surface is showing a plan, on the day whose tab is selected. Safe to call
   * on every render: it debounces, and it is a cache hit once warm. See the note on the timer in
   * the provider for why the dwell lives there rather than in each host.
   */
  prefetch: (request: StoryRequest) => void;
  exit: () => void;
  togglePlay: () => void;
}

interface StoryPlayback {
  request: StoryRequest | null;
  phase: StoryPhase;
  script: StoryScript | null;
  /** Index into `script.beats`. Meaningless while `script` is null. */
  beatIndex: number;
  muted: boolean;
  /**
   * True when no voice is going to speak here — either the API is absent (some Linux desktops,
   * locked-down webviews) or it is present and demonstrably mute (see `voiceBroken`). The film
   * still plays, on estimated beat lengths, and the stage says so rather than leaving somebody
   * waiting for a voice that is never coming.
   */
  silentPlatform: boolean;
  /** Which narrator the traveller has asked for — remembered across sessions. */
  voiceEngine: VoiceEngine;
  /**
   * Where the natural voice is: `idle` (never asked for), `loading` (downloading the 88MB model,
   * `naturalProgress` is a 0-1 fraction), `ready`, or `unavailable` (it was asked for and failed,
   * or this browser cannot run it).
   *
   * Separate from `voiceEngine` on purpose — a traveller can have *asked* for the natural voice
   * while it is still downloading, and during that minute the browser voice keeps narrating.
   */
  naturalStatus: NaturalVoiceStatus;
  naturalProgress: number;
  setVoiceEngine: (engine: VoiceEngine) => void;
  next: () => void;
  prev: () => void;
  togglePlay: () => void;
  toggleMute: () => void;
  /** Narrate a different day without leaving the film — the "next day" offer at the end. */
  playDay: (dayIndex: number) => void;
  exit: () => void;
}

type ScriptParams = { day: DayPlan; dayIndex: number; dayCount: number; destination: string };

/**
 * The script for one day, from the session cache or from the route.
 *
 * **The promise is cached, not the script, and it is cached before it settles.** That is the whole
 * of the in-flight dedupe, and it is what makes warming safe: a Play that lands while a warm is
 * still running joins the call already in flight rather than spawning a second one beside it. On
 * the CLI transport that window is a minute wide — see `STORY_TIMEOUT_MS` in the route. It also
 * fixes something that was always broken and invisible: React's StrictMode mounts an effect twice
 * in dev, and with nothing cached until a response landed, the first Play of every dev session
 * fired two subprocesses.
 *
 * A **rejection evicts its own entry**, so one dropped connection does not pin the read-aloud
 * fallback to that day for the rest of the session. A 200 carrying the route's *own* fallback is
 * kept, and the asymmetry is deliberate: that call has already been paid for, and re-spending a
 * minute to arrive at the same words is worse than the words.
 */
function loadScript(
  cache: Map<string, Promise<StoryScript>>,
  params: ScriptParams,
  tripId?: string
): Promise<StoryScript> {
  const key = storyCacheKey(params);
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = (async () => {
    const res = await fetch("/api/trip-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, tripId }),
    });
    const data = (await res.json()) as { script?: StoryScript };
    if (!data.script?.beats?.length) throw new Error("no script");
    return data.script;
  })();
  // Attached here rather than left to the caller, for two reasons: the entry is gone before anyone
  // builds a fallback from it, and a warm nobody awaits never becomes an unhandled rejection.
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  cache.set(key, pending);
  return pending;
}

/**
 * How long a day has to stay on screen before warming it is worth a model call.
 *
 * Clicking along a week of day tabs is one gesture, not seven decisions, and on the CLI transport
 * each of those decisions would be a Sonnet subprocess. Long enough to sit out a scan, short
 * enough that reading a day's first stop has already bought the Play button.
 */
const WARM_DWELL_MS = 1200;

const ControlsContext = createContext<StoryControls | null>(null);
const PlaybackContext = createContext<StoryPlayback | null>(null);

const IDLE_CONTROLS: StoryControls = {
  active: false,
  dayIndex: null,
  phase: "loading",
  start: () => {},
  prefetch: () => {},
  exit: () => {},
  togglePlay: () => {},
};

export function StoryModeProvider({ children }: { children: ReactNode }) {
  const { showTripRoute, flyToStoryStop, setActiveIndex, reframeRoute, setRouteConnectorsHidden } =
    useMapCamera();

  const [request, setRequest] = useState<StoryRequest | null>(null);
  const [script, setScript] = useState<StoryScript | null>(null);
  const [phase, setPhase] = useState<StoryPhase>("loading");
  const [beatIndex, setBeatIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  /**
   * Whether this browser can speak, decided once in a lazy initialiser.
   *
   * It touches `window`, so it resolves to `false` during SSR — which costs nothing here because
   * the only thing that renders from it is `StoryStage`, and that is mounted `ssr: false`. Keep it
   * that way: read this in server-rendered markup and the two passes will disagree about a line of
   * copy.
   */
  const [voiceCapable] = useState(speechAvailable);
  /**
   * Latched the first time a beat's voice fails to speak, which is a thing only playback can find
   * out — see `START_GUARD_MS` in storyVoice.ts. Set from a callback rather than an effect, and a
   * dependency of the beat effect, so the failed beat immediately replays as a timed one instead
   * of stranding the film on the line that could not be said.
   *
   * Per film, not per session: `openDay` clears it, so a transient failure does not permanently
   * mute a browser that can in fact talk.
   */
  const [voiceBroken, setVoiceBroken] = useState(false);
  const speaks = voiceCapable && !voiceBroken;

  /** The narrator the traveller has chosen, read from localStorage once. */
  const [voiceEngine, setVoiceEngineState] = useState<VoiceEngine>(storedVoiceEngine);
  const [naturalStatus, setNaturalStatus] = useState<NaturalVoiceStatus>("idle");
  const [naturalProgress, setNaturalProgress] = useState(0);
  /**
   * The engine actually speaking right now, which is not the same as the one asked for.
   *
   * A `natural` preference with the model still downloading resolves to `browser`, so the film
   * narrates through the whole load rather than sitting silent — and because this is a dependency
   * of the beat effect, the moment the model lands the current beat is re-spoken in the new voice.
   * That is the upgrade arriving mid-film, with no sequencing code anywhere.
   */
  const engine: VoiceEngine =
    voiceEngine === "natural" && naturalStatus === "ready" ? "natural" : "browser";
  /**
   * Every script asked for this session, keyed by `storyCacheKey` — the **promise**, not the
   * script, so a request that arrives while an identical one is in flight joins it instead of
   * starting a second call. See `loadScript`.
   *
   * The key carries no trip id, which is what lets a warm started on the pre-save result view be
   * read by the Play button on `/trip/[id]` after Keep: this provider is mounted in `AppShell`
   * from the root layout, so it survives that navigation with the Map intact.
   */
  const cacheRef = useRef(new Map<string, Promise<StoryScript>>());
  /** The single pending warm. One focused day at a time, the same way there is one film at a
   *  time — see `prefetch`. */
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakRef = useRef<SpeakHandle | null>(null);

  useEffect(() => {
    warmVoices();
    // Nothing may still be speaking after this provider goes away — `speechSynthesis` is a
    // property of the window, not of the React tree, so an unmount mid-sentence would otherwise
    // narrate over whatever the traveller navigated to.
    return () => {
      silence();
      if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
    };
  }, []);

  const day = request ? request.itinerary.days[request.dayIndex] : undefined;

  /** Every day in the shape the globe wants — the same mapping `ItineraryCard` does, since the
   *  film draws the route itself while the card is off duty. */
  const routeDays = useMemo(
    () =>
      request?.itinerary.days.map((d, i) =>
        d.stops.map((st) => ({ lat: st.lat, lng: st.lng, name: st.name, day: i, time: st.time }))
      ) ?? [],
    [request?.itinerary]
  );

  /** Where this day's stops start in the flat list the map indexes selection by. */
  const dayOffset = useMemo(
    () => routeDays.slice(0, request?.dayIndex ?? 0).reduce((n, d) => n + d.length, 0),
    [routeDays, request?.dayIndex]
  );

  /** Every entry point into a day — the first press and the "next day" offer at the end — resets
   *  the same four pieces of state. It happens in these handlers rather than in the fetch effect
   *  below so that no render is triggered from inside an effect body. */
  const openDay = useCallback((next: StoryRequest) => {
    setRequest(next);
    setScript(null);
    setBeatIndex(0);
    setPhase("loading");
    setVoiceBroken(false);
  }, []);

  const start = openDay;

  const exit = useCallback(() => {
    // Cleared before the card's own route effect re-runs (it depends on `story.active`), so the
    // redraw that restores the panel's framing restores the arcs with it.
    setRouteConnectorsHidden(false);
    silence();
    speakRef.current?.cancel();
    speakRef.current = null;
    setRequest(null);
    setScript(null);
    setBeatIndex(0);
    setPhase("loading");
    setActiveIndex(null);
  }, [setActiveIndex, setRouteConnectorsHidden]);

  const playDay = useCallback(
    (nextDay: number) => {
      if (!request || nextDay < 0 || nextDay >= request.itinerary.days.length) return;
      openDay({ ...request, dayIndex: nextDay });
    },
    [request, openDay]
  );

  /**
   * Fetch (or recall) the script for the day in play.
   *
   * Keyed on the request object's identity, which changes only on `start` and `playDay` — so this
   * fires once per day narrated, never on a beat. A rejected fetch is not an error state: the
   * route itself already falls back, and this catches the case where the route was never reached
   * (offline, a dev server restart mid-press) with the same day-read-aloud script.
   */
  useEffect(() => {
    if (!request || !day) return;
    let alive = true;
    const params = {
      day,
      dayIndex: request.dayIndex,
      dayCount: request.itinerary.days.length,
      destination: request.destination,
    };
    // A cache hit still resolves a microtask later than it strictly could, which is a frame nobody
    // can see and which keeps every path out of this effect asynchronous — so none of them renders
    // from the effect body.
    loadScript(cacheRef.current, params, request.tripId)
      // The route degrades to `fallbackScript` on its own; this is the case where the route was
      // never reached at all (offline, a dev server restart mid-press). Applied *outside* the
      // cached promise on purpose — inside it, one dropped connection would make the read-aloud
      // fallback this day's script for the rest of the session.
      .catch(() => fallbackScript(params))
      .then((resolved) => {
        if (!alive) return;
        setScript(resolved);
        setPhase("playing");
      });
    return () => {
      alive = false;
    };
  }, [request, day]);

  /**
   * Warm the script for the day in focus, so pressing Play is instant rather than a wait.
   *
   * The same key, the same cache and the same promise the play effect uses — and that sameness is
   * the feature rather than a tidiness: a Play landing mid-warm joins the call already running.
   *
   * **The dwell lives here, not in the hosts.** There is one focused day at a time, the way there
   * is one film at a time, so one timer covers every caller — and a debounce written once is a
   * cleanup that can only be got wrong once. Each call re-arms it, so clicking along a week of day
   * tabs warms the day landed on and none of the ones passed through.
   *
   * The empty dependency list is load-bearing: this goes into `controls`, which three trees read,
   * so a `prefetch` that changed identity would re-render all of them. It must therefore close
   * over refs only — closing over `request` or `script` would put those trees back on the beat
   * clock, which is exactly what splitting controls from playback exists to prevent.
   */
  const prefetch = useCallback((next: StoryRequest) => {
    if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
    warmTimerRef.current = setTimeout(() => {
      const warmDay = next.itinerary.days[next.dayIndex];
      if (!warmDay?.stops.length) return;
      void loadScript(
        cacheRef.current,
        {
          day: warmDay,
          dayIndex: next.dayIndex,
          dayCount: next.itinerary.days.length,
          destination: next.destination,
        },
        next.tripId
      );
    }, WARM_DWELL_MS);
  }, []);

  /**
   * Play one beat: aim the camera, say the words, and advance when the words are done.
   *
   * The cleanup is what makes Next, Pause and Exit all work by the same mechanism — each of them
   * only changes state, and the re-run tears down the sentence that was in progress. Nothing has
   * to cancel anything by hand.
   */
  useEffect(() => {
    if (!request || !script || !day || phase !== "playing") return;
    const beat = script.beats[beatIndex];
    if (!beat) return;

    if (beat.kind === "stop" && beat.stopIndex !== undefined) {
      const stop = day.stops[beat.stopIndex];
      if (stop) {
        setActiveIndex(dayOffset + beat.stopIndex);
        /**
         * Face the way the day is going, and take longer over a longer leg.
         *
         * Both of these are the retired Play tour's work (`tourPacing.ts`), inherited rather than
         * re-derived. They were written for a silent walk through a day's stops, and a narrated
         * one is the same journey: without a heading every stop is framed due north and four
         * arrivals in a row are the same frame, which is what made the tour read as a slideshow;
         * without distance in the flight, a twelve-kilometre hop is the same whip pan as a
         * two-hundred-metre one.
         *
         * `TOUR_HOLD_MS` is the one part that does not transfer, and it is the difference between
         * the two features: a tour needs to invent a hold, where a film already has one — the beat
         * lasts exactly as long as the sentence takes to say.
         *
         * A `null` bearing (a single-stop day, or a day at one coordinate) is left *undefined*
         * rather than sent as 0, which is due north and a claim; omitting it keeps the renderers'
         * existing `?? 0` fallback without pretending it was a decision.
         */
        const stops = day.stops;
        const heading = legBearingRad(stops, beat.stopIndex) ?? undefined;
        const previous = beat.stopIndex > 0 ? stops[beat.stopIndex - 1] : undefined;
        const previousHeading =
          beat.stopIndex > 0 ? legBearingRad(stops, beat.stopIndex - 1) : null;
        flyToStoryStop(stop.lat, stop.lng, {
          headingRad: heading,
          // Zero under `prefers-reduced-motion`: the camera arrives cut rather than flown, and the
          // beat keeps its full length, so the film runs the same wall-clock time with more
          // stillness. The same trade `useTripCamera` makes for the streaming camera — the framing
          // is the information, the flight is the decoration.
          durationS: prefersReducedMotion()
            ? 0
            : tourFlightSeconds(
                previous ? metresBetween(previous, stop) : 0,
                heading !== undefined && previousHeading !== null ? heading - previousHeading : 0
              ),
        });
      }
    } else if (beat.kind === "opening") {
      // The day alone, centred, with no panel to aim beside — the film's establishing shot. This
      // is also the one call that puts the route on the map for story mode, since the card's own
      // route effect stands down while `active` (see its `storyActive` prop).
      //
      // Stops without the arcs between them: set before the draw, because the flag is read at
      // draw time. See `setRouteConnectorsHidden` for why the film wants the places alone.
      setRouteConnectorsHidden(true);
      showTripRoute(routeDays, request.dayIndex, false, true);
    } else {
      // Closing: pull back off the last stop to the day's framing, and drop the highlight so the
      // final line is about the day rather than about one place in it.
      setActiveIndex(null);
      reframeRoute();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const advance = () => {
      if (beatIndex + 1 >= script.beats.length) setPhase("ended");
      else setBeatIndex(beatIndex + 1);
    };

    if (muted || !speaks) {
      timer = setTimeout(advance, estimateDurationMs(beat.text));
    } else {
      speakRef.current = speakOn(engine, beat.text, {
        onEnd: advance,
        // A voice that never started, or that died mid-beat, must not strand the film. Latching
        // `voiceBroken` re-runs this effect for the same beat down the timed path, so the line the
        // voice failed on is the one that gets played rather than skipped.
        onError: () => setVoiceBroken(true),
      });
    }

    return () => {
      clearTimeout(timer);
      speakRef.current?.cancel();
      speakRef.current = null;
    };
  }, [
    request,
    script,
    day,
    phase,
    beatIndex,
    muted,
    speaks,
    engine,
    dayOffset,
    routeDays,
    flyToStoryStop,
    setActiveIndex,
    showTripRoute,
    reframeRoute,
    setRouteConnectorsHidden,
  ]);

  const next = useCallback(() => {
    if (!script) return;
    if (beatIndex + 1 >= script.beats.length) {
      setPhase("ended");
      return;
    }
    setBeatIndex(beatIndex + 1);
    // Next while paused resumes: the traveller asked for the following place, not for a paused
    // view of it.
    setPhase("playing");
  }, [script, beatIndex]);

  const prev = useCallback(() => {
    if (!script) return;
    setBeatIndex(phase === "ended" ? script.beats.length - 1 : Math.max(0, beatIndex - 1));
    setPhase("playing");
  }, [script, beatIndex, phase]);

  /**
   * Pause, resume, or replay from the top once the film has ended.
   *
   * Resuming **re-speaks the current beat from its beginning** rather than picking up mid-sentence.
   * `speechSynthesis.pause()`/`resume()` exist, and are the obvious thing to reach for, but they
   * are unreliable across engines in exactly the way that matters here — a pause that does not take
   * leaves the voice talking over a stopped camera. Cancelling and re-reading a two-sentence beat
   * is three seconds of repetition and is the same on every platform.
   */
  const togglePlay = useCallback(() => {
    if (phase === "ended") {
      setBeatIndex(0);
      setPhase("playing");
    } else if (phase === "playing") setPhase("paused");
    else if (phase === "paused") setPhase("playing");
  }, [phase]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  /**
   * Choose a narrator, and start the download if that is what was chosen.
   *
   * The preference is stored immediately even though the voice is not ready for another minute —
   * it is a preference, not a state, and a traveller who turns it on and leaves should find it on
   * next time. Progress is reported into state so the toggle can count up rather than spin.
   */
  const setVoiceEngine = useCallback((next: VoiceEngine) => {
    setVoiceEngineState(next);
    storeVoiceEngine(next);
    if (next !== "natural") return;
    if (!naturalVoiceSupported()) {
      setNaturalStatus("unavailable");
      return;
    }
    setNaturalStatus((current) => (current === "ready" ? current : "loading"));
    setNaturalProgress(0);
    void loadNaturalVoice(setNaturalProgress).then((ok) =>
      setNaturalStatus(ok ? "ready" : "unavailable")
    );
  }, []);

  /**
   * Publish "a film is running" on the document element.
   *
   * For the chrome Story mode cannot reach from inside `AppShell`: `LlmTraceFab` mounts as a
   * sibling of `.app-shell` from the root layout, above `MapCameraProvider`, so it is an ancestor
   * of this provider and no context reaches it — the same structural problem `print:hidden` on that
   * button already documents. One attribute plus one rule in globals.css, rather than lifting a
   * provider that needs the map camera out of the tree that owns the map camera.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (!request) {
      delete root.dataset.storyMode;
      return;
    }
    root.dataset.storyMode = "true";
    return () => {
      delete root.dataset.storyMode;
    };
  }, [request]);

  /** Film controls on the keys a film has them on. Bound only while a story is up, so nothing
   *  here has to know what else on the page might want the space bar. */
  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (event.key === "Escape") exit();
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") prev();
      else if (event.key === " " || event.key === "Spacebar") {
        // The stage's own buttons keep their activation; this is for the rest of the screen,
        // which in story mode is map.
        if (target?.closest("button")) return;
        event.preventDefault();
        togglePlay();
      } else return;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [request, exit, next, prev, togglePlay]);

  const controls = useMemo<StoryControls>(
    () => ({
      active: !!request,
      dayIndex: request?.dayIndex ?? null,
      phase,
      start,
      prefetch,
      exit,
      togglePlay,
    }),
    [request, phase, start, prefetch, exit, togglePlay]
  );

  const playback = useMemo<StoryPlayback>(
    () => ({
      request,
      phase,
      script,
      beatIndex,
      muted,
      silentPlatform: !speaks,
      voiceEngine,
      naturalStatus,
      naturalProgress,
      setVoiceEngine,
      next,
      prev,
      togglePlay,
      toggleMute,
      playDay,
      exit,
    }),
    [
      request,
      phase,
      script,
      beatIndex,
      muted,
      speaks,
      voiceEngine,
      naturalStatus,
      naturalProgress,
      setVoiceEngine,
      next,
      prev,
      togglePlay,
      toggleMute,
      playDay,
      exit,
    ]
  );

  return (
    <ControlsContext.Provider value={controls}>
      <PlaybackContext.Provider value={playback}>{children}</PlaybackContext.Provider>
    </ControlsContext.Provider>
  );
}

/**
 * Start or stop the film, and know whether one is running.
 *
 * Returns an inert value outside the provider rather than throwing, so a surface that renders both
 * inside `AppShell` and on the print page (`ItineraryCard` does) needs no branch — its Play button
 * simply does nothing where there is no map to play on.
 */
export function useStoryControls(): StoryControls {
  return useContext(ControlsContext) ?? IDLE_CONTROLS;
}

/** Playback state and transport. Null outside the provider; only `StoryStage` consumes it. */
export function useStoryPlayback(): StoryPlayback | null {
  return useContext(PlaybackContext);
}
