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

import { usePathname } from "next/navigation";

import { markStoryFlight, storyFlightLeftMs, useMapCamera } from "@/lib/mapCamera";
import {
  fallbackScript,
  storyCacheKey,
  type CompactLeg,
  type StoryScript,
} from "@/lib/storyScript";
import { legBearingRad, tourFlightSeconds, travelGlideSeconds } from "@/lib/tourPacing";
import { metresBetween } from "@/lib/peekRange";
import { failureFromResponse, failureFromThrown, holdFromFailure, type Failure } from "@/lib/failure";
import {
  PROFILE_VERB,
  currentRouteProfile,
  meaningfulLeg,
  peekDayRoute,
} from "@/lib/dayRoutes";
import { formatDistance } from "@/lib/format";
import { track } from "@/lib/analytics/client";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import type { NaturalVoiceStatus } from "@/lib/kokoroVoice";
import { loadNaturalVoice, naturalVoiceReady, naturalVoiceSupported } from "@/lib/kokoroVoice";
import {
  estimateDurationMs,
  silence,
  setNarrationVolume,
  speakOn,
  speakSilently,
  splitForSpeech,
  warmOn,
  speechAvailable,
  warmVoices,
  type SpeakHandle,
  type VoiceEngine,
} from "@/lib/storyVoice";
import type { DayPlan, Itinerary, Stop } from "@/lib/types";

/** The spec's names for the narrators: `browser` is the platform's own voice. */
const voiceLabel = (mode: string) => (mode === "browser" ? "platform" : mode);

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
  /**
   * A page that can show a stop's detail registers how (the trip page's drawer), and the player
   * bar offers "Open this stop" only while one is registered. Pass null on the way out.
   */
  setStopOpener: (open: ((stop: Stop) => void) | null) => void;
}

export interface StoryPlayback {
  request: StoryRequest | null;
  phase: StoryPhase;
  script: StoryScript | null;
  /** Why a fallback script was read from the plan when the route was refused or never reached
   *  (copy rows T-94..T-96). Null for the route's own fallback (T-93) and for a written story. */
  scriptFailure: Failure | null;
  /** Index into `script.beats`. Meaningless while `script` is null. */
  beatIndex: number;
  /**
   * The sentence of the beat being heard (an index into `splitForSpeech(beat.text)`) and the
   * `performance.now()` its voice started it at, from the voice's own `onSentence` events. `startedAt`
   * is null while a sentence is queued but not yet audible (the lead-in, a resume, the natural voice
   * synthesising), so the subtitle waits with the voice rather than running ahead of it.
   */
  sentence: SentenceAt;
  muted: boolean;
  /**
   * True when no voice is going to speak here — either the API is absent (some Linux desktops,
   * locked-down webviews) or it is present and demonstrably mute (see `voiceBroken`). The film
   * still plays, on estimated beat lengths, and the stage says so rather than leaving somebody
   * waiting for a voice that is never coming.
   */
  silentPlatform: boolean;
  /**
   * The voice was present but proved mute (`START_GUARD_MS`). Distinct from `silentPlatform`, which is
   * also true for a browser with no speech API at all — Meri shows an error for this one only.
   */
  voiceBroken: boolean;
  /**
   * Where the natural voice is: `idle` (no film has started yet), `loading` (downloading the
   * model, `naturalProgress` is a 0-1 fraction), `ready`, or `unavailable` (it failed, or this
   * browser cannot run it).
   *
   * This used to sit beside a `voiceEngine` preference, because the natural voice was opt-in. It
   * is now simply the voice, so the only question left is whether it has arrived — during the
   * download, and forever on a browser that cannot run it, the platform voice narrates.
   */
  naturalStatus: NaturalVoiceStatus;
  naturalProgress: number;
  next: () => void;
  prev: () => void;
  /** Jump to a beat — the player bar's scrubber and its queue. Plays from that beat's start. */
  seek: (beatIndex: number) => void;
  togglePlay: () => void;
  toggleMute: () => void;
  /** Narrate a different day without leaving the film — the "next day" offer at the end. */
  playDay: (dayIndex: number) => void;
  /** The narration's volume, 0 to 1, separate from `muted` the way a player's slider and its mute
   *  are: muting keeps the level to come back to. */
  volume: number;
  /** Moves the level live, without restarting the beat; raising it from a mute unmutes. */
  setVolume: (volume: number) => void;
  /** What the page registered through `setStopOpener`, or null where no page shows a stop. */
  openStop: ((stop: Stop) => void) | null;
  exit: () => void;
}

/** See `StoryPlayback.sentence`. `intoMs` is how much of the sentence had been heard when it was last
 *  held (a pause, an unmute, a change of voice), which is where the voice picks it up; zero for a
 *  sentence not yet begun. Only meaningful while `startedAt` is null. */
export type SentenceAt = { index: number; startedAt: number | null; intoMs: number };

type ScriptParams = {
  day: DayPlan;
  dayIndex: number;
  dayCount: number;
  destination: string;
  legs?: (CompactLeg | null)[];
};

/**
 * Whatever the day's real routes look like *right now*, for the script call — never awaited.
 *
 * `peekDayRoute` reads the settled mirror synchronously, so a routing service that is slow or dead
 * can never delay a Play press: the legs that have landed become travel beats and the ones that
 * have not simply do not, which is the film exactly as it played before travel beats existed. The
 * panel fires the route fetch when a day is focused and `prefetch` waits `WARM_DWELL_MS` before
 * asking for a script, so in practice they are there.
 *
 * The legs reach `compactDay` and therefore both cache keys, which is what stops a travel-free
 * script being served over a day whose routes have since arrived.
 */
function legsFor(day: DayPlan): (CompactLeg | null)[] | undefined {
  const route = peekDayRoute(currentRouteProfile(), day.stops.map((s) => ({ lat: s.lat, lng: s.lng })));
  if (!route) return undefined;
  const verb = PROFILE_VERB[currentRouteProfile()];
  return route.map((leg) => {
    const real = meaningfulLeg(leg);
    return real
      ? { verb, minutes: Math.max(Math.round(real.durationS / 60), 1), distanceLabel: formatDistance(real.distanceM) }
      : null;
  });
}

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
    // A limit or the daily cap: rejected with what it was, so the stage can say so (T-95, T-96).
    if (!res.ok) throw await failureFromResponse(res, "story");
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


/**
 * How the film's camera reaches stop `i` of a day: facing along the day (`legBearingRad`, so the next
 * place is ahead on arrival), over a flight paced by the leg it covers (`tourFlightSeconds`), or by
 * `minS` when the beat has a line to fill. Zero under `prefers-reduced-motion`: the camera cuts and
 * the beat keeps its full length, the same trade `useTripCamera` makes for the streaming camera.
 *
 * A `null` bearing (a single-stop day, or a day at one coordinate) is left *undefined* rather than
 * sent as 0, which is due north and a claim; omitting it keeps the renderers' `?? 0` fallback.
 */
function glideTo(stops: readonly Stop[], i: number, narrationMs?: number): { headingRad?: number; durationS: number } {
  const heading = legBearingRad(stops, i) ?? undefined;
  const previous = i > 0 ? stops[i - 1] : undefined;
  const previousHeading = i > 0 ? legBearingRad(stops, i - 1) : null;
  const legM = previous ? metresBetween(previous, stops[i]) : 0;
  const turn = heading !== undefined && previousHeading !== null ? heading - previousHeading : 0;
  return {
    headingRad: heading,
    durationS: prefersReducedMotion()
      ? 0
      : narrationMs === undefined
        ? tourFlightSeconds(legM, turn)
        : travelGlideSeconds(legM, turn, narrationMs),
  };
}

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
  setStopOpener: () => {},
};

export function StoryModeProvider({ children }: { children: ReactNode }) {
  const {
    showTripRoute,
    flyToStoryStop,
    setActiveIndex,
    reframeRoute,
    setRouteConnectorsHidden,
    // Aliased: `engine` already means the *voice* engine throughout this file.
    engine: mapEngine,
  } =
    useMapCamera();

  const [request, setRequest] = useState<StoryRequest | null>(null);
  const [script, setScript] = useState<StoryScript | null>(null);
  const [scriptFailure, setScriptFailure] = useState<Failure | null>(null);
  const [phase, setPhase] = useState<StoryPhase>("loading");
  const [beatIndex, setBeatIndex] = useState(0);
  /**
   * Where in the beat the voice is, from its own sentence events (see `StoryPlayback.sentence`).
   *
   * The ref is what the voice effect reads to know where to pick a beat up; the state is what the
   * stage draws. Every way to a *different* beat resets it to the top (`markSentence(0, null)`);
   * pause/resume, mute/unmute and the natural voice arriving `holdSentence()` instead, which keeps
   * the sentence *and how far into it the voice was*, so each of those continues at the word it was
   * on rather than restarting the sentence — or, for the one- and two-sentence beats most scripts
   * are made of, the whole beat.
   */
  const sentenceRef = useRef<SentenceAt>({ index: 0, startedAt: null, intoMs: 0 });
  const [sentence, setSentence] = useState<SentenceAt>({ index: 0, startedAt: null, intoMs: 0 });
  const markSentence = useCallback((index: number, startedAt: number | null, intoMs = 0) => {
    sentenceRef.current = { index, startedAt, intoMs };
    setSentence(sentenceRef.current);
  }, []);
  /** Freeze the sentence where it is: unheard (`startedAt` null) until a voice picks it up again, at
   *  the point it had reached. What a pause, an unmute and a change of voice all do. */
  const holdSentence = useCallback(() => {
    const { index, startedAt, intoMs } = sentenceRef.current;
    markSentence(index, null, startedAt === null ? intoMs : performance.now() - startedAt);
  }, [markSentence]);
  const [muted, setMuted] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [stopOpener, setStopOpenerState] = useState<((stop: Stop) => void) | null>(null);
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
   * out — see `START_GUARD_MS` in storyVoice.ts. Set from a callback rather than an effect, and it
   * feeds `voiceMode`, so the voice effect immediately carries on silently from the sentence that
   * could not be said instead of stranding the film on it.
   *
   * Per film, not per session: `openDay` clears it, so a transient failure does not permanently
   * mute a browser that can in fact talk.
   */
  const [voiceBroken, setVoiceBroken] = useState(false);
  const speaks = voiceCapable && !voiceBroken;

  const [naturalStatus, setNaturalStatus] = useState<NaturalVoiceStatus>("idle");
  const [naturalProgress, setNaturalProgress] = useState(0);
  /**
   * The engine actually speaking right now.
   *
   * The natural voice with the model still downloading resolves to `browser`, so the film narrates
   * through the whole load rather than sitting silent — and because it feeds `voiceMode`, a
   * dependency of the voice effect, the moment the model lands the sentence being heard is re-said
   * in the new voice and the beat carries on from there. That is the upgrade arriving mid-film.
   *
   * This is the *only* remaining fork between the two engines. There used to be a stored
   * `voiceEngine` preference and a toggle in the stage as well, on the argument that a
   * hundreds-of-megabytes download should be asked for. The toggle went because the good voice is
   * plainly the one anybody wants and this line already covers every way it can fail to arrive —
   * so what the preference actually bought was a chance to be offered the worse narrator.
   */
  const engine: VoiceEngine = naturalStatus === "ready" ? "natural" : "browser";
  /**
   * What the voice effect speaks the beat with. A muted natural voice keeps speaking into a zero
   * gain (its volume reaches a sentence already playing, so nothing restarts); a muted platform voice
   * cannot be silenced mid-utterance, so a mute hands the beat to `speakSilently`, which keeps the
   * sentence clock running from the very word it was on. A platform that cannot speak is silent too.
   */
  const voiceMode: VoiceEngine | "silent" = !speaks || (muted && engine === "browser") ? "silent" : engine;
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

  /**
   * The stop a travel beat sent the camera gliding to, read once by the beat that follows: that stop
   * beat then has nowhere to fly, since the glide is the canonical `flyToStoryStop` to the same pose.
   * Without it the film arrived, paused, and re-arrived. A flight is never cancelled by Next, so a
   * skip mid-glide still lands where this says.
   */
  const arrivedStopRef = useRef<number | null>(null);
  /**
   * The beat (and map) whose camera has already been played, so a resume does not play it again.
   *
   * The camera effect re-runs on `phase`, and before this every resume re-shot the beat: a travel
   * beat walked its street again from the first metre and the opening re-framed the day, which read
   * as the film restarting even where the voice did not. Cleared by everything that means "from the
   * top" — a new day, a seek, a replay — so those still shoot.
   */
  const shotRef = useRef<string | null>(null);
  /**
   * The film being watched, for `story_film_finished`: the furthest beat reached and the script's
   * length. A ref, because the numbers are only read when the film ends and no render depends on them.
   */
  const filmRef = useRef<{ furthest: number; total: number } | null>(null);
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  /** Ends the film in progress, if any: Esc, Plan, a day change, leaving the page or closing the tab all come here, once. */
  const endFilm = useCallback(() => {
    const film = filmRef.current;
    filmRef.current = null;
    if (film) track("story_film_finished", { beats_heard: film.furthest + 1, beats_total: film.total, voice: voiceLabel(voiceModeRef.current) });
  }, []);
  useEffect(() => {
    window.addEventListener("pagehide", endFilm);
    return () => window.removeEventListener("pagehide", endFilm);
  }, [endFilm]);

  /**
   * Start the natural voice's download, if this browser can run it at all.
   *
   * Idempotent: `loadNaturalVoice` returns the running load to a second caller rather than starting
   * a second download, and the `naturalVoiceReady()` check keeps a completed one from having its
   * progress bar reset to zero underneath it.
   *
   * Two callers, deliberately — pressing the toggle, and *starting a film while the toggle is
   * already on*. See `openDay` for why the second one is not redundant.
   */
  const ensureNaturalVoice = useCallback(() => {
    if (!naturalVoiceSupported()) {
      setNaturalStatus("unavailable");
      return;
    }
    if (naturalVoiceReady()) {
      setNaturalStatus("ready");
      return;
    }
    setNaturalStatus("loading");
    setNaturalProgress(0);
    // Whole percents only. transformers.js reports every chunk of every shard, and each report was a
    // render of the whole player: measured at 76 commits a second for the length of the download,
    // against ~4 for the subtitle's own tick. The label shows a whole percent anyway.
    void loadNaturalVoice((fraction) => setNaturalProgress(Math.floor(fraction * 100) / 100)).then((ok) => {
      // The natural voice takes over at the word being heard, in its own voice: the rest of the
      // sentence waits, unlit, until that voice is actually saying it.
      if (ok) holdSentence();
      setNaturalStatus(ok ? "ready" : "unavailable");
    });
  }, [holdSentence]);

  /** Every entry point into a day — the first press and the "next day" offer at the end — resets
   *  the same four pieces of state. It happens in these handlers rather than in the fetch effect
   *  below so that no render is triggered from inside an effect body. */
  const openDay = useCallback(
    (next: StoryRequest) => {
      // The next day's film starts as the last one is left, and each is counted on its own.
      endFilm();
      filmRef.current = { furthest: -1, total: 0 };
      track("story_film_played", { voice: voiceLabel(voiceModeRef.current) });
      setRequest(next);
      setScript(null);
      setBeatIndex(0);
      markSentence(0, null);
      shotRef.current = null;
      setPhase("loading");
      setVoiceBroken(false);
      // **Here rather than on mount, and that is the whole reason this is not just a module-level
      // load.** The weights are hundreds of megabytes and an ORT session to hold them, and a page
      // nobody plays a film on should pay for neither — every other route in this app renders the
      // same provider. The film is the moment it is needed, and the platform voice covers the
      // first beat or two while it initialises, the same handover `engine` above describes.
      //
      // Idempotent: `ensureNaturalVoice` returns early once the model is ready, so pressing Play
      // on a second day costs nothing.
      ensureNaturalVoice();
    },
    [ensureNaturalVoice, markSentence, endFilm]
  );

  const start = openDay;

  const exit = useCallback(() => {
    endFilm();
    // Cleared before the card's own route effect re-runs (it depends on `story.active`), so the
    // redraw that restores the panel's framing restores the arcs with it.
    setRouteConnectorsHidden(false);
    silence();
    speakRef.current?.cancel();
    speakRef.current = null;
    setRequest(null);
    setScript(null);
    setBeatIndex(0);
    markSentence(0, null);
    setPhase("loading");
    setActiveIndex(null);
  }, [setActiveIndex, setRouteConnectorsHidden, markSentence, endFilm]);

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
      legs: legsFor(day),
    };
    // A cache hit still resolves a microtask later than it strictly could, which is a frame nobody
    // can see and which keeps every path out of this effect asynchronous — so none of them renders
    // from the effect body.
    loadScript(cacheRef.current, params, request.tripId)
      // The route degrades to `fallbackScript` on its own; this is the case where the route was
      // never reached at all (offline, a dev server restart mid-press). Applied *outside* the
      // cached promise on purpose — inside it, one dropped connection would make the read-aloud
      // fallback this day's script for the rest of the session.
      .then(
        (resolved) => ({ resolved, failure: null }),
        (e: unknown) => {
          const failure: Failure = e && typeof e === "object" && "kind" in e ? (e as Failure) : failureFromThrown(e);
          // Not to hold Play (it still plays), only so the stage can count the wait down.
          holdFromFailure(failure);
          return { resolved: fallbackScript(params), failure };
        }
      )
      .then(({ resolved, failure }) => {
        if (!alive) return;
        if (filmRef.current) filmRef.current.total = resolved.beats.length;
        setScript(resolved);
        setScriptFailure(failure);
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
          legs: legsFor(warmDay),
        },
        next.tripId
      );
    }, WARM_DWELL_MS);
  }, []);

  /**
   * Leaving the page ends the film.
   *
   * The provider and the stage live in `AppShell`, above every route, so nothing about a navigation
   * reaches them on its own: pressing a navbar link mid-film used to leave the subtitle, the "Next ·"
   * line and the player bar drawn over the next page, still narrating a trip that was no longer on
   * screen. The navbar stays usable during a film on purpose (see the note in `AppShell`), so this
   * is where leaving is made clean — any change of pathname is an exit, the same exit Esc and Plan
   * take. It runs as the outgoing path's cleanup, which still sees the film that was playing there.
   */
  const pathname = usePathname();
  const exitOnLeaveRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    exitOnLeaveRef.current = request ? exit : null;
  }, [request, exit]);
  useEffect(() => () => exitOnLeaveRef.current?.(), [pathname]);

  /**
   * Play one beat's camera: aim it at the place the beat is about. The words are the next effect's.
   *
   * **Two effects, because the voice changes for reasons the camera must not hear.** They were one,
   * and that one listed `muted` and the voice `engine` among its dependencies, so pressing mute, or
   * the natural voice finishing its download, re-ran the whole beat: the camera flew again and the
   * voice began the beat from the top while the subtitle, on its own clock, carried on. Now the
   * camera plays once per beat (`shotRef`) — a resume does not re-shoot it — and the voice re-runs
   * for a beat, a phase or a change of voice, and picks up at the word it was on.
   *
   * **Every move is one flight, `flyToStoryStop`.** Travel beats used to walk the camera along the
   * leg's street geometry, a frame-by-frame `restoreCamera` loop paced at no more than 150 m/s and
   * holding the beat open until it finished. On a Val d'Orcia drive that was a single "On to …" beat
   * of **123 seconds** of continuous street-level panning under a one-line sentence; the same day's
   * film now runs 132s instead of 160s, at 5,365 WebGL draw calls a second instead of 7,964. A travel
   * beat now glides straight to the stop it is about, the engine's own eased flight along the line
   * between the two, facing the way the day goes — so the stop beat that follows has already arrived.
   */
  useEffect(() => {
    if (!request || !script || !day || phase !== "playing") return;
    const beat = script.beats[beatIndex];
    if (!beat) return;
    const shot = `${beatIndex}|${mapEngine}`;
    if (shotRef.current === shot) return;
    shotRef.current = shot;

    // Read once and cleared immediately, so it can only ever excuse the single beat that follows
    // the glide — a replay of the same day starts with nothing owed.
    const arrivedAt = arrivedStopRef.current;
    arrivedStopRef.current = null;

    if (beat.kind === "stop" && beat.stopIndex !== undefined) {
      const stop = day.stops[beat.stopIndex];
      if (stop) {
        setActiveIndex(dayOffset + beat.stopIndex);
        /**
         * Face the way the day is going, and take longer over a longer leg — the retired Play tour's
         * work (`tourPacing.ts`), inherited rather than re-derived; see `glideTo`. Without a heading
         * every stop is framed due north and four arrivals in a row are the same frame; without
         * distance in the flight a twelve-kilometre hop is the same whip pan as a two-hundred-metre
         * one. `TOUR_HOLD_MS` is the one part that does not transfer: a film already has a hold —
         * the beat lasts exactly as long as the sentence takes to say.
         *
         * Not when a travel beat has just glided here: that was this exact call, so flying again
         * would be a second trip to somewhere the camera already is.
         */
        if (arrivedAt !== beat.stopIndex) flyToStoryStop(stop.lat, stop.lng, glideTo(day.stops, beat.stopIndex));
      }
    } else if (beat.kind === "travel" && beat.legIndex !== undefined) {
      // The highlight stays on the stop being *left*: this beat is about the going, and lighting the
      // destination before arriving is the spoiler the film already puts the arcs away to avoid.
      setActiveIndex(dayOffset + beat.legIndex);
      const arriving = day.stops[beat.legIndex + 1];
      if (arriving) {
        arrivedStopRef.current = beat.legIndex + 1;
        // Paced by the line as well as the leg (`travelGlideSeconds`), so the camera is still going
        // while the sentence about going is said, and lands about when it ends.
        flyToStoryStop(arriving.lat, arriving.lng, glideTo(day.stops, beat.legIndex + 1, estimateDurationMs(beat.text)));
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
    } else if (beat.kind === "closing") {
      // Closing: pull back off the last stop to the day's framing, and drop the highlight so the
      // final line is about the day rather than about one place in it.
      setActiveIndex(null);
      // A flight too, for Cesium's detail ceiling (`inStoryFlight`): the pull-back from 1200m to the
      // whole day crosses the most new ground of any move in the film. Measured A/B, two runs each,
      // this beat dropped 1 and 2 frames over 32ms with it against 14 and 3 without. 2.0 is
      // `frameRoute`'s own default flight.
      markStoryFlight(2.0);
      reframeRoute();
    }
    // Any other kind: hold the camera where the previous beat left it and just play the line.
    //
    // Tagged rather than left as the closing branch's `else`, which is what it used to be. A
    // catch-all meant a beat kind this dispatch had never heard of pulled the camera back to the
    // day's framing and cleared the highlight — the closing's behaviour, performed in the middle
    // of a film, with nothing to attribute it to. Holding is the honest no-op: an unknown beat
    // still gets narrated, and the camera says nothing rather than saying the wrong thing.
  }, [
    request,
    script,
    day,
    mapEngine,
    phase,
    beatIndex,
    dayOffset,
    routeDays,
    flyToStoryStop,
    setActiveIndex,
    showTripRoute,
    reframeRoute,
    setRouteConnectorsHidden,
  ]);

  /**
   * Say one beat, from the sentence the beat is on, and advance when the words are done.
   *
   * `sentenceRef` is the resume point: zero for a beat just arrived at, the sentence being heard for
   * everything that re-runs this without moving beat — a resume, a mute on the platform voice, the
   * natural voice arriving, a voice found to be mute. `onEnd` still fires once per beat: every run's
   * handle is cancelled by its cleanup before the next run's begins, and a cancelled handle never
   * calls back.
   */
  useEffect(() => {
    if (!request || !script || phase !== "playing") return;
    const beat = script.beats[beatIndex];
    if (!beat) return;
    if (filmRef.current) filmRef.current.furthest = Math.max(filmRef.current.furthest, beatIndex);

    const advance = () => {
      markSentence(0, null);
      if (beatIndex + 1 >= script.beats.length) setPhase("ended");
      else setBeatIndex(beatIndex + 1);
    };

    // A sentence still running (a mute of the platform voice) continues from now; a held one (a
    // resume, an unmute, a voice arriving or failing) from where it was held; a new beat from zero.
    const { index: from, startedAt, intoMs } = sentenceRef.current;
    const into = startedAt === null ? intoMs : performance.now() - startedAt;
    // Get the next beat's audio ready while the camera holds still: from this beat's last sentence,
    // once any flight still running is over. Synthesising when the next beat starts put the GPU
    // inference on top of its flight; synthesising at the last sentence of a one-line travel beat
    // put it on top of the glide that sentence is said over. See `warmNatural`.
    const last = splitForSpeech(beat.text).length - 1;
    const following = script.beats[beatIndex + 1]?.text;
    let warm: ReturnType<typeof setTimeout> | undefined;
    const handlers = {
      onEnd: advance,
      onSentence: (index: number, at: number) => {
        markSentence(index, at);
        if (index === last && following && voiceMode !== "silent") {
          warm = setTimeout(() => warmOn(voiceMode, following), storyFlightLeftMs());
        }
      },
      // A voice that never started, or that died mid-beat, must not strand the film. Latching
      // `voiceBroken` re-runs this effect down the silent path, at the word the voice failed on,
      // so that line is the one that gets played rather than skipped.
      onError: () => {
        holdSentence();
        setVoiceBroken(true);
      },
    };
    const handle =
      voiceMode === "silent" ? speakSilently(beat.text, handlers, from, into) : speakOn(voiceMode, beat.text, handlers, from, into);
    speakRef.current = handle;

    return () => {
      clearTimeout(warm);
      handle.cancel();
      if (speakRef.current === handle) speakRef.current = null;
    };
  }, [request, script, phase, beatIndex, voiceMode, markSentence, holdSentence]);

  /**
   * Move to a beat and play it from its top — Next, Previous and the scrubber's seek alike. Moving
   * while paused resumes: the traveller asked to hear that place, not for a paused view of it.
   * Asking for the beat already playing changes nothing, as it never did.
   */
  const goToBeat = useCallback(
    (target: number) => {
      if (target === beatIndex && phase === "playing") return;
      markSentence(0, null);
      shotRef.current = null;
      setBeatIndex(target);
      setPhase("playing");
    },
    [beatIndex, phase, markSentence]
  );

  const next = useCallback(() => {
    if (!script) return;
    if (beatIndex + 1 >= script.beats.length) {
      setPhase("ended");
      return;
    }
    goToBeat(beatIndex + 1);
  }, [script, beatIndex, goToBeat]);

  const prev = useCallback(() => {
    if (!script) return;
    goToBeat(phase === "ended" ? script.beats.length - 1 : Math.max(0, beatIndex - 1));
  }, [script, beatIndex, phase, goToBeat]);

  /** Jump to a beat — the scrubber and the chapters. See `goToBeat`. */
  const seek = useCallback(
    (target: number) => {
      if (!script) return;
      goToBeat(Math.max(0, Math.min(script.beats.length - 1, target)));
    },
    [script, goToBeat]
  );

  /**
   * Pause, resume, or replay from the top once the film has ended.
   *
   * Resuming **picks the sentence up at the word it was paused on**, not at its start. It used to
   * re-speak the sentence from its beginning, and since most beats are one or two long sentences that
   * was, to the ear, the beat starting over — measured on Val d'Orcia's opening, a pause 17 words in
   * resumed at word 0, three times out of three. `speechSynthesis.pause()`/`resume()` are still not
   * used: they are unreliable across engines in exactly the way that matters here, a pause that does
   * not take leaving the voice talking over a stopped film. So the beat is still cancelled and
   * re-spoken, from the sentence and the time into it that `holdSentence` kept: the platform voice
   * drops the words already lit (`resumePoint`, one word back), the natural voice starts the same
   * audio 0.3s before where it stopped, and the silent path continues on its estimate.
   */
  const togglePlay = useCallback(() => {
    if (phase === "ended") {
      markSentence(0, null);
      shotRef.current = null;
      setBeatIndex(0);
      setPhase("playing");
    } else if (phase === "playing") {
      // Held at the word: the caption stops on it, and the resume speaks from it.
      holdSentence();
      setPhase("paused");
    } else if (phase === "paused") setPhase("playing");
  }, [phase, markSentence, holdSentence]);

  /**
   * Mute is a volume, never a restart. The natural voice is silenced through its gain, mid-sentence,
   * and nothing re-runs. The platform voice's volume is fixed once an utterance is spoken, so muting
   * it moves the beat to `speakSilently` at the very word it was on, and unmuting hands it back to the
   * voice at the word the silence had reached (held here, so the rest waits for the voice).
   */
  const applyMute = useCallback(
    (nextMuted: boolean, level: number) => {
      setNarrationVolume(nextMuted ? 0 : level);
      if (!nextMuted && muted && engine === "browser" && speaks) holdSentence();
      setMuted(nextMuted);
    },
    [muted, engine, speaks, holdSentence]
  );
  const toggleMute = useCallback(() => applyMute(!muted, volume), [applyMute, muted, volume]);
  const setVolume = useCallback(
    (next: number) => {
      setVolumeState(next);
      applyMute(muted && next === 0, next);
    },
    [applyMute, muted]
  );
  // A function in state has to be set through the updater form, or React calls it.
  const setStopOpener = useCallback((open: ((stop: Stop) => void) | null) => setStopOpenerState(() => open), []);

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
      setStopOpener,
    }),
    [request, phase, start, prefetch, exit, togglePlay, setStopOpener]
  );

  const playback = useMemo<StoryPlayback>(
    () => ({
      request,
      phase,
      script,
      scriptFailure,
      beatIndex,
      sentence,
      muted,
      silentPlatform: !speaks,
      voiceBroken,
      naturalStatus,
      naturalProgress,
      next,
      prev,
      seek,
      togglePlay,
      toggleMute,
      playDay,
      exit,
      volume,
      setVolume,
      openStop: stopOpener,
    }),
    [
      request,
      phase,
      script,
      scriptFailure,
      beatIndex,
      sentence,
      muted,
      speaks,
      voiceBroken,
      naturalStatus,
      naturalProgress,
      next,
      prev,
      seek,
      togglePlay,
      toggleMute,
      playDay,
      exit,
      volume,
      setVolume,
      stopOpener,
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
