"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bike, Car, Footprints } from "lucide-react";

import { takeHandoffOrigin } from "@/lib/controlHandoff";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { useStoryPlayback, type StoryPlayback } from "@/lib/storyMode";
import { beatAt, beatDurations, beatTicks, clockLabel, elapsedMs, subtitleAt } from "@/lib/storyTimeline";
import { devLabel } from "@/lib/devInspector";
import { useRouteProfile } from "@/lib/dayRoutes";
import type { StoryBeat } from "@/lib/storyScript";
import type { DayPlan, Stop } from "@/lib/types";
import { meriForStory } from "@/lib/meri";
import { formatWait, heldUntil, useHold } from "@/lib/actionHolds";
import { formatResumeTime, type Failure } from "@/lib/failure";
import { formatClockTime, holdSentence, WAIT } from "@/lib/toastQueue";
import Meridian from "./Meridian";

import "@/components/polar/PolarLanding.css";
import "@/components/polar/StoryPlayer.css";

/**
 * Story mode's interface: a now-playing bar docked along the foot of the map, the way a music
 * player's is, and the two panels it opens over the map: the narration as lyrics, and Up next.
 *
 * **Along the foot, because the map is the picture.** The film flies the camera down to each stop;
 * the controls belong where a player keeps them, out of the frame's middle, and the lines being
 * spoken sit on the map's left where the camera leaves room. The bar replaces the panel that used
 * to dock under the plan's capsule: the trip page's plan is a board along the foot that stands down
 * while a film runs, so a column on the right was guarding nothing.
 *
 * **The scrubber is the day's film, estimated.** A beat lasts as long as its sentence takes to say
 * and only the voice knows when that is, so the bar runs on `estimateDurationMs` (the same estimate
 * the controller times a muted beat with, see `storyTimeline.ts`) and snaps to the real boundary
 * when a beat advances. A seek lands on a beat's start: a sentence is spoken from its beginning.
 *
 * Mounted once in `AppShell`, beside the map chrome, for the reason `StopMarkerLayer` is: the page
 * underneath is whatever route the traveller was on, and the film is not part of it. Renders nothing
 * until a story is running.
 */
const ENTER = { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const };
const EXIT = { duration: 0.18, ease: [0.4, 0, 1, 1] as const };

/** Copy rows T-93..T-96: why this day is read from the plan. It never blocks: Play still plays. */
function FallbackNote({ failure }: { failure: Failure | null }) {
  const { secondsLeft } = useHold("story");
  if (failure?.kind === "offline") {
    return <p className="sp-note">Read from your plan. You&rsquo;re offline, so the storyteller couldn&rsquo;t write this day.</p>;
  }
  if (failure?.kind === "daily_cap") {
    return (
      <p className="sp-note">
        Read from your plan. New stories are paused for everyone until {formatResumeTime(failure.resumesAt)}; it isn&rsquo;t anything you
        did. Days you&rsquo;ve already played keep theirs.
      </p>
    );
  }
  if (failure?.kind === "rate_limited") {
    // Once the wait is over the countdown has nothing left to say; the day is still read from the plan.
    if (secondsLeft === null) return <p className="sp-note">Read from your plan.</p>;
    const text = `Read from your plan. You’ve started 6 new stories in the last 10 minutes, which is the limit; written stories are back in ${WAIT}. Days you’ve already played keep theirs.`;
    return (
      <p className="sp-note">
        <span aria-hidden="true">{text.replace(WAIT, formatWait(secondsLeft))}</span>
        <span className="sr-only">{holdSentence(text, formatClockTime(heldUntil("story") ?? 0))}</span>
      </p>
    );
  }
  // SV-24. The server's own sentence (SV-17) asks for something shorter, which Play can't send.
  if (failure?.kind === "refused") {
    return <p className="sp-note">Read from your plan: this day has more than TripMate can narrate at once.</p>;
  }
  return <p className="sp-note">Read from your plan. The storyteller wasn&rsquo;t reachable this time.</p>;
}

export default function StoryStage() {
  const playback = useStoryPlayback();
  const request = playback?.request ?? null;
  const day = request ? request.itinerary.days[request.dayIndex] : undefined;

  /**
   * The presence gate, and the only reason this component is split in two. `exit()` clears the
   * request synchronously (the plan's route effect depends on `story.active`), so nothing would be
   * left to draw by the time an exit animation runs. `AnimatePresence` holds the element it was last
   * given, props and all, which is exactly the frame the film ended on.
   */
  return (
    <AnimatePresence>
      {playback && request && day && <StoryPlayerBody key="story-player" playback={playback} request={request} day={day} />}
    </AnimatePresence>
  );
}

const stopOf = (beat: StoryBeat | undefined, day: DayPlan): Stop | undefined =>
  beat?.kind === "stop" && beat.stopIndex !== undefined ? day.stops[beat.stopIndex] : undefined;

/** What a beat is called in the bar and the queue: its place, or what kind of moment it is. */
function beatTitle(beat: StoryBeat | undefined, day: DayPlan, dayIndex: number): string {
  if (!beat) return "";
  if (beat.kind === "stop") return stopOf(beat, day)?.name ?? "";
  if (beat.kind === "opening") return `Day ${dayIndex + 1}`;
  if (beat.kind === "closing") return "End of the day";
  if (beat.kind === "travel") {
    const to = beat.legIndex !== undefined ? day.stops[beat.legIndex + 1]?.name : undefined;
    return to ? `On to ${to}` : "On the way";
  }
  return "";
}

function StoryPlayerBody({
  playback,
  request,
  day,
}: {
  playback: StoryPlayback;
  request: NonNullable<StoryPlayback["request"]>;
  day: DayPlan;
}) {
  const { phase, muted, silentPlatform, voiceBroken, naturalStatus, naturalProgress, next, prev, seek, toggleMute, playDay, exit, volume, setVolume, openStop } = playback;
  const script = playback.script;
  const beats = useMemo(() => script?.beats ?? [], [script]);
  const beatIndex = Math.min(playback.beatIndex, Math.max(0, beats.length - 1));
  const ended = phase === "ended";
  const dayIndex = request.dayIndex;
  const hasNextDay = dayIndex + 1 < request.itinerary.days.length;
  const durations = useMemo(() => beatDurations(beats), [beats]);
  const total = durations.reduce((sum, d) => sum + d, 0);
  const [subs, setSubs] = useState(true);
  const [chapters, setChapters] = useState(false);
  const [peek, setPeek] = useState<number | null>(null);
  // C shows or hides the subtitles, as a player's caption key does. The controller owns Space, the
  // arrows and Esc; this is the stage's own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "c") return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
      setSubs((on) => !on);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Time into the current beat, ticked from the clock while playing and keyed by beat, so a pause
  // holds where it stopped and a new beat starts from nothing. A resumed beat is re-spoken from its
  // start (see `togglePlay` in the controller), which is why resuming restarts the count.
  const [clock, setClock] = useState({ beat: -1, ms: 0 });
  useEffect(() => {
    if (phase !== "playing") return;
    const start = performance.now();
    const id = window.setInterval(() => setClock({ beat: beatIndex, ms: performance.now() - start }), 250);
    return () => window.clearInterval(id);
  }, [phase, beatIndex, script]);
  const within = clock.beat === beatIndex ? clock.ms : 0;
  const elapsed = script ? elapsedMs(durations, beatIndex, within, ended) : 0;
  const fraction = total > 0 ? elapsed / total : 0;

  const current = beats[beatIndex];
  const currentStop = stopOf(current, day);
  const playLabel = phase === "playing" ? "Pause the story" : ended ? "Play the day again" : "Resume the story";

  // The scrubber: click or drag anywhere to land on the beat that point falls in.
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const seekFrom = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || !script) return;
    seek(beatAt(durations, (clientX - box.left) / box.width));
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => seekFrom(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  /**
   * If Play was just pressed on the plan, fly the play disc down from there. One-way, as before
   * (`src/lib/controlHandoff.ts`): the button leaves the plan and takes its post in the bar.
   * Layout effect, so the disc is never painted in its slot for a frame first.
   */
  const playRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const button = playRef.current;
    const from = takeHandoffOrigin();
    if (!button || !from || prefersReducedMotion()) return;
    const to = button.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    button.style.willChange = "transform";
    const flight = button.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
      duration: 420,
      easing: "ease-in-out",
    });
    const release = () => {
      button.style.willChange = "";
    };
    flight.finished.then(release, release);
    return () => flight.cancel();
  }, []);

  const voiceLine =
    naturalStatus === "loading"
      ? `Natural voice ${Math.round(naturalProgress * 100)}%`
      : naturalStatus === "ready"
        ? "Natural voice"
        : silentPlatform
          ? "No voice here"
          : "Device voice";
  const voiceTitle =
    naturalStatus === "loading"
      ? "Fetching a better narrator: 88 MB, kept for next time; 326 MB on a GPU, which comes down each session. The story plays in this device's own voice meanwhile."
      : naturalStatus === "unavailable" && !silentPlatform
        ? "The natural voice couldn't load, so it's staying with this device's own voice."
        : silentPlatform
          ? "No voice is available here, so the story plays without sound."
          : "Narrated by the natural voice.";

  const hasDayAfter = hasNextDay ? request.itinerary.days[dayIndex + 1] : undefined;
  const sub = current ? subtitleAt(current.text, durations[beatIndex] ? within / durations[beatIndex] : 0) : null;
  const nextBeat = beats[beatIndex + 1];
  const nextStop = stopOf(nextBeat, day);
  const starts = durations.map((_, i) => durations.slice(0, i).reduce((a, b) => a + b, 0));

  return (
    <motion.div
      className={`tm story-player${chapters ? " has-chapters" : ""}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: EXIT }}
      transition={ENTER}
      {...devLabel("StoryStage")}
    >
      {/* The night that holds the words: no box over the shot, a rise from the foot. */}
      {subs && <div className="sp-scrim" aria-hidden="true" />}

      {/* The subtitle stands on whatever is under it: the bar, or the chapters when they are open. */}
      <div className="sp-stack">
      {subs && (
        <section className="sp-subs" aria-label="Narration">
          <button type="button" className="sp-icon sp-subs-x" aria-label="Hide the subtitles" title="Hide the subtitles (C)" onClick={() => setSubs(false)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          {!script ? (
            <p className="sp-wait">Writing the story of day {dayIndex + 1}…</p>
          ) : ended ? (
            <div className="sp-end">
              <p className="sp-sub-line is-done">Day {dayIndex + 1} is done.</p>
              <div className="sp-end-actions">
                <button type="button" className="sp-pill" onClick={() => playDay(dayIndex)}>
                  <ReplayIcon /> Again
                </button>
                {hasDayAfter && (
                  <button type="button" className="sp-pill is-go" onClick={() => playDay(dayIndex + 1)}>
                    Day {dayIndex + 2}
                    {hasDayAfter.title || hasDayAfter.theme ? ` · ${hasDayAfter.title || hasDayAfter.theme}` : ""} ▸
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <p className="sp-sub-eyebrow">
                {beatTitle(current, day, dayIndex)}
                {currentStop?.time ? ` · ${currentStop.time}` : ""}
              </p>
              {/* One sentence at a time, its words lighting as the voice reaches them. */}
              <p className="sp-sub-line" key={`${beatIndex}-${sub?.index}`}>
                {sub?.words.map((word, i) => (
                  <span key={i} className={i < sub.said ? "is-said" : undefined}>
                    {word}{" "}
                  </span>
                ))}
              </p>
              {nextBeat && (
                <p className="sp-sub-next">
                  Next · {beatTitle(nextBeat, day, dayIndex)}
                  {nextStop?.time && <span>{nextStop.time}</span>}
                </p>
              )}
            </>
          )}
          {script?.source === "fallback" && <FallbackNote failure={playback.scriptFailure} />}
          {/* T-90: said on the stage, not only in the voice chip's tooltip (which phones don't show). */}
          {naturalStatus === "unavailable" && !silentPlatform && (
            <p className="sp-note">The natural voice couldn&rsquo;t load, so it&rsquo;s staying with this device&rsquo;s own voice.</p>
          )}
        </section>
      )}

      {/* Up next, as chapters: every beat of the day in a strip above the bar. */}
      {chapters && (
        <section className="sp-chapters" aria-label="Up next">
          <header>
            <b>Chapters · Day {dayIndex + 1}</b>
            <span>{day.title || day.theme}</span>
            <button type="button" className="sp-icon" aria-label="Close chapters" onClick={() => setChapters(false)}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          {!script ? (
            <p className="sp-wait is-small">Writing the story of day {dayIndex + 1}…</p>
          ) : (
            <ol>
              {beats.map((beat, i) => {
                const stop = stopOf(beat, day);
                const on = i === beatIndex && !ended;
                return (
                  <li key={i}>
                    <button type="button" className={`sp-chapter${on ? " is-on" : i < beatIndex || ended ? " is-past" : ""}`} onClick={() => seek(i)} aria-current={on ? "true" : undefined}>
                      <NowArt stop={stop} beat={beat} dayIndex={dayIndex} />
                      <span className="sp-chapter-n">{String(i + 1).padStart(2, "0")}</span>
                      <b>{beatTitle(beat, day, dayIndex)}</b>
                      <span>{[stop?.time, clockLabel(durations[i] ?? 0)].filter(Boolean).join(" · ")}</span>
                    </button>
                  </li>
                );
              })}
              {hasDayAfter && (
                <li>
                  <button type="button" className="sp-chapter is-day" onClick={() => playDay(dayIndex + 1)}>
                    <span className="sp-chapter-n">Then</span>
                    <b>Day {dayIndex + 2}</b>
                    <span>{hasDayAfter.title || hasDayAfter.theme || "Next day"} ▸</span>
                  </button>
                </li>
              )}
            </ol>
          )}
        </section>
      )}
      </div>

      <motion.section
        className="sp-bar"
        aria-label={`Day ${dayIndex + 1} as a story`}
        initial={{ y: 24 }}
        animate={{ y: 0 }}
        exit={{ y: 16, transition: EXIT }}
        transition={ENTER}
      >
        {/* Now playing */}
        <div className="sp-now">
          <NowArt stop={currentStop} beat={current} dayIndex={dayIndex} />
          <div className="sp-now-text">
            <b>{!script ? `Writing day ${dayIndex + 1}…` : ended ? `Day ${dayIndex + 1} is done` : beatTitle(current, day, dayIndex)}</b>
            <span>
              {request.destination.split(",")[0]} · Day {dayIndex + 1}
              {day.title || day.theme ? ` · ${day.title || day.theme}` : ""}
            </span>
          </div>
          {/* Where a page can show a stop (the trip page's drawer), the place being narrated opens
              beside the film: the camera stays on the beat, the sheet stands above the bar. */}
          {openStop && currentStop && !ended && (
            <button type="button" className="sp-icon sp-details" aria-label={`Open ${currentStop.name}`} title="Open this stop" onClick={() => openStop(currentStop)}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Transport and the day's scrubber */}
        <div className="sp-center">
          <div className="sp-transport">
            <button type="button" className="sp-icon" aria-label="Play the day again" title="Again" onClick={() => playDay(dayIndex)} disabled={!script}>
              <ReplayIcon />
            </button>
            <button type="button" className="sp-icon" aria-label="Previous place" title="Previous place" onClick={prev} disabled={!script}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M12.5 3.5L6 8l6.5 4.5zM3.5 3v10" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            </button>
            <button ref={playRef} type="button" className="sp-play" aria-label={playLabel} title={playLabel} onClick={playback.togglePlay} disabled={!script}>
              {phase === "playing" ? (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M5 3v10l8.5-5z" fill="currentColor" />
                </svg>
              )}
            </button>
            <button type="button" className="sp-icon" aria-label="Next place" title="Next place" onClick={next} disabled={!script}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M3.5 3.5L10 8l-6.5 4.5zM12.5 3v10" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            </button>
            {hasNextDay ? (
              <button type="button" className="sp-icon sp-nextday" aria-label={`Play day ${dayIndex + 2}`} title={`Day ${dayIndex + 2}`} onClick={() => playDay(dayIndex + 1)}>
                D{dayIndex + 2}
              </button>
            ) : (
              <span className="sp-icon-gap" />
            )}
          </div>
          <div className="sp-scrub">
            <span className="sp-time">{clockLabel(elapsed)}</span>
            <div
              ref={track}
              className={`sp-track${dragging ? " is-drag" : ""}`}
              role="slider"
              tabIndex={0}
              aria-label="Position in the day's story"
              aria-valuemin={0}
              aria-valuemax={Math.round(total / 1000)}
              aria-valuenow={Math.round(elapsed / 1000)}
              aria-valuetext={`${clockLabel(elapsed)} of ${clockLabel(total)}${current ? `, ${beatTitle(current, day, dayIndex)}` : ""}`}
              onPointerDown={(e) => {
                seekFrom(e.clientX);
                setDragging(true);
              }}
              onPointerMove={(e) => {
                if (!script || e.pointerType === "touch") return;
                const box = e.currentTarget.getBoundingClientRect();
                setPeek(beatAt(durations, (e.clientX - box.left) / box.width));
              }}
              onPointerLeave={() => setPeek(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  next();
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  prev();
                }
              }}
            >
              <span className="sp-fill" style={{ width: `${fraction * 100}%` }} />
              {beatTicks(durations).map((at, i) => (
                <i key={i} className="sp-tick" style={{ left: `${at * 100}%` }} />
              ))}
              <span className="sp-knob" style={{ left: `${fraction * 100}%` }} />
              {/* The chapter under the pointer, as a video scrubber previews a frame. */}
              {peek !== null && beats[peek] && total > 0 && (
                <span className="sp-peek" style={{ left: `${((starts[peek] + (durations[peek] ?? 0) / 2) / total) * 100}%` }} aria-hidden="true">
                  <NowArt stop={stopOf(beats[peek], day)} beat={beats[peek]} dayIndex={dayIndex} />
                  <b>{beatTitle(beats[peek], day, dayIndex)}</b>
                  <span>{stopOf(beats[peek], day)?.time ?? clockLabel(durations[peek] ?? 0)}</span>
                </span>
              )}
            </div>
            <span className="sp-time">{script ? clockLabel(total) : "…"}</span>
          </div>
        </div>

        {/* Voice, subtitles, chapters, volume, and back to the plan */}
        <div className="sp-right">
          {/* Meri, beside the voice it is speaking in: its motion is the film's state. */}
          <span className={`sp-voice${naturalStatus === "ready" ? " is-ready" : ""}`} title={voiceTitle}>
            <Meridian size={14} state={meriForStory({ phase, voiceBroken, muted, silentPlatform })} />
            {voiceLine}
          </span>
          <button type="button" className={`sp-icon${subs ? " is-on" : ""}`} aria-pressed={subs} aria-label="Subtitles" title="Subtitles (C)" onClick={() => setSubs(!subs)}>
            <svg viewBox="0 0 18 16" width="17" height="15" aria-hidden="true">
              <rect x="1.5" y="2.5" width="15" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M7.6 6.4a2 2 0 1 0 0 3.2M13 6.4a2 2 0 1 0 0 3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className={`sp-icon${chapters ? " is-on" : ""}`} aria-pressed={chapters} aria-label="Up next" title="Chapters" onClick={() => setChapters(!chapters)}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M2.5 3.5h11M2.5 7.5h11M2.5 11.5h6M11 10v4l3-2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="sp-vol">
            <button
              type="button"
              className="sp-icon"
              aria-label={muted || volume === 0 ? "Unmute narration" : "Mute narration"}
              title={muted || volume === 0 ? "Unmute narration" : "Mute narration"}
              // Unmuting a slider dragged to nothing brings the level back up, or the button does nothing.
              onClick={() => (volume === 0 ? setVolume(1) : toggleMute())}
              disabled={silentPlatform}
            >
              {muted || silentPlatform || volume === 0 ? (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M3 6h2.5L9 3v10L5.5 10H3zM11 6l3 4M14 6l-3 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M3 6h2.5L9 3v10L5.5 10H3zM11.5 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((muted || silentPlatform ? 0 : volume) * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              disabled={silentPlatform}
              aria-label="Narration volume"
              style={{ ["--v" as string]: `${(muted || silentPlatform ? 0 : volume) * 100}%` }}
            />
          </div>
          {/* Leaving is how the plan comes back: the board returns the moment the film ends. */}
          <button type="button" className="sp-plan" onClick={exit} aria-label="Leave story mode and show the plan" title="Back to the plan (Esc)">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <rect x="2" y="8.5" width="12" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5 5.5L8 2.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Plan
          </button>
        </div>
      </motion.section>

      <p className="sp-keys">Space to pause · ← → to move · C for subtitles · Esc for the plan</p>

      {/* The beat being spoken, once, for a screen reader: the subtitle changes word by word. */}
      <div className="sr-only" aria-live="polite">
        {script ? beats[beatIndex]?.text : `Writing the story of day ${dayIndex + 1}`}
      </div>
    </motion.div>
  );
}

function ReplayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v2.5h2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The bar's artwork: the stop's photograph, the day's number on the opening, ★ at the close, the
 *  mode's glyph on the way between. Never a grey box. */
function NowArt({ stop, beat, dayIndex }: { stop?: Stop; beat?: StoryBeat; dayIndex: number }) {
  const photo = usePlacePhoto(stop?.name ?? "");
  return (
    <span className="sp-art" aria-hidden="true">
      {stop && photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary Wikipedia originals; next/image throws on an unconfigured host
        <img key={photo} src={photo} alt="" className="value-in" />
      ) : beat?.kind === "travel" ? (
        <TravelGlyph />
      ) : (
        <b>{beat?.kind === "closing" ? "★" : stop ? stop.name.slice(0, 1) : dayIndex + 1}</b>
      )}
    </span>
  );
}

function TravelGlyph() {
  const profile = useRouteProfile();
  const Icon = profile === "bike" ? Bike : profile === "drive" ? Car : Footprints;
  return <Icon className="h-4 w-4" aria-hidden="true" />;
}
