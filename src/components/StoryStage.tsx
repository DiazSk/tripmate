"use client";

import { useEffect, useRef } from "react";
import {
  AudioLines,
  Bike,
  Car,
  Footprints,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { beatOpacity, type StoryBeat } from "@/lib/storyScript";
import { useStoryPlayback } from "@/lib/storyMode";
import { devLabel } from "@/lib/devInspector";
import { useRouteProfile } from "@/lib/dayRoutes";
import type { Stop } from "@/lib/types";
import { StopAvatar } from "./StopList";

/**
 * Story mode's one piece of interface — the narration, in the docked column, directly under the
 * collapsed plan panel's capsule.
 *
 * **Where it sits is the design.** The capsule is the trip's single clean line (photo, destination,
 * length, day in focus) and it carries the film's play/pause button, so this panel deliberately
 * repeats **none** of that: no city, no day badge, no Play. It is the "and here is the part being
 * narrated" section beneath it, which is why its geometry is copied from `DockedPanel`'s collapsed
 * state rather than invented — same `right`/`left` insets, same `sm:w-96` / `sm:max-w-[520px]`,
 * offset down by the capsule's own `h-14` plus a gap. The two read as one stack in the place the
 * plan panel already occupies. An earlier revision floated this bottom-centre over the map, which
 * put the film's controls nowhere near the control that started it and covered the ground the
 * camera had just flown to.
 *
 * Mounted once in `AppShell`, beside the map chrome rather than inside the scrolling content
 * overlay, for the same reason `StopMarkerLayer` is: the page underneath is whatever route the
 * traveller was on, and the film is not part of it. Renders nothing until a story is running.
 *
 * **The Apple Music lyric ramp.** Only the line being spoken is at full weight; the next is legible
 * but plainly not it, and everything beyond that is a suggestion of text. The list does not scroll
 * — the inner column is translated so the spoken line sits at the top of the window and the lines
 * to come rise into it. That is a `transform`, so the whole animation is compositor work over a map
 * that is flying at the same time; a scrolling container would relayout every frame, and every
 * frame here also re-blurs this panel's own `backdrop-filter`.
 */
export default function StoryStage() {
  const playback = useStoryPlayback();
  const listRef = useRef<HTMLDivElement>(null);

  const request = playback?.request ?? null;
  const script = playback?.script ?? null;
  const beatIndex = playback?.beatIndex ?? 0;

  /**
   * Lift the beat column so the line being spoken sits at the top of the window.
   *
   * Measured from the DOM rather than computed from a row height: a beat is two to five lines of
   * wrapped prose and no two rows are the same height. Written straight onto the element rather
   * than through state, for the reason the collapsing itinerary header gives for the same choice —
   * this is one property write against the compositor, and a `useState` here would re-render the
   * whole stage (and re-run its measurement) to move a transform the browser was going to
   * interpolate anyway.
   */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-beat="${beatIndex}"]`);
    list.style.transform = `translateY(${-(row?.offsetTop ?? 0)}px)`;
    // `script` is a dependency as well as `beatIndex`: a new day's first beat is at offset 0, but
    // so is the old one's, so without it the column would keep the previous day's lift.
  }, [beatIndex, script]);

  if (!playback || !request) return null;

  const day = request.itinerary.days[request.dayIndex];
  if (!day) return null;

  const {
    phase,
    muted,
    silentPlatform,
    voiceEngine,
    naturalStatus,
    naturalProgress,
    setVoiceEngine,
    next,
    prev,
    toggleMute,
    playDay,
    exit,
  } = playback;
  const dayCount = request.itinerary.days.length;
  const hasNextDay = request.dayIndex + 1 < dayCount;
  const beats = script?.beats ?? [];
  const position = phase === "ended" ? beats.length : beatIndex + 1;

  return (
    // Geometry mirrored from `DockedPanel`'s collapsed branch, plus its `h-14` and a 0.75rem gap.
    // `z-10` matches the panel's, so this sits over the canvas and the marker cards exactly as the
    // capsule above it does.
    <div
      className="pointer-events-auto fixed top-[calc(var(--nav-h)+5.5rem)] right-4 left-4 z-10 sm:top-[calc(var(--nav-h)+5.75rem)] sm:right-6 sm:left-auto sm:w-96 sm:max-w-[520px]"
      {...devLabel("StoryStage")}
    >
      <div className="glass-itinerary rounded-[18px] px-4 py-3.5">
        {/* Transport. No Play — the capsule above owns that, and two of them would be two
            different ideas of whether the film is running. Prev/Next are the traveller's own way
            through the day; Mute and Close are the way out. */}
        <div className="flex items-center gap-1">
          <TransportButton label="Previous place" onClick={prev} disabled={!script}>
            <SkipBack className="h-4 w-4" strokeWidth={2} />
          </TransportButton>
          <TransportButton label="Next place" onClick={next} disabled={!script}>
            <SkipForward className="h-4 w-4" strokeWidth={2} />
          </TransportButton>
          <TransportButton
            label={muted ? "Unmute narration" : "Mute narration"}
            onClick={toggleMute}
            disabled={silentPlatform}
          >
            {muted || silentPlatform ? (
              <VolumeX className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Volume2 className="h-4 w-4" strokeWidth={2} />
            )}
          </TransportButton>

          {/* Beats, not minutes: nobody knows how long a narration is, and everybody understands
              "four of eleven". */}
          <span className="ml-1 flex-1 text-xs tabular-nums text-muted">
            {beats.length > 0 ? `${position} of ${beats.length}` : "…"}
          </span>

          <TransportButton label="Leave story mode" onClick={exit}>
            <X className="h-4 w-4" strokeWidth={2} />
          </TransportButton>
        </div>

        {beats.length > 0 && (
          <div
            className="mt-2.5 h-px w-full overflow-hidden rounded-full bg-white/15"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={beats.length}
            aria-valuenow={Math.min(position, beats.length)}
            aria-label="Story progress"
          >
            <div
              className="h-full bg-accent transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ width: `${(position / beats.length) * 100}%` }}
            />
          </div>
        )}

        {/* The lyric window. A fixed height, so the panel does not jump as beats of different
            lengths take the spotlight — the column moves, the frame does not. 15rem rather than
            13: a four-sentence beat is five lines at this width and filled a 13rem window on its
            own, leaving nothing of the line coming next, and the line coming next is half of what
            the ramp is for. */}
        <div className="relative mt-3 h-[15rem] overflow-hidden">
          {!script ? (
            <p className="animate-pulse text-sm text-muted">
              Writing the story of day {request.dayIndex + 1}…
            </p>
          ) : (
            <div ref={listRef} className="relative" style={{ transition: "transform 620ms cubic-bezier(0.16, 1, 0.3, 1)" }}>
              {beats.map((beat, index) => (
                <BeatRow
                  key={index}
                  beat={beat}
                  index={index}
                  activeIndex={beatIndex}
                  // Keyed on `kind`, not on `stopIndex` being present. `stopIndex` is documented
                  // as living on stop beats and only stop beats, but reading it that way made
                  // this component the second, quieter definition of what a stop beat is — and
                  // one that would disagree with `normaliseScript`'s (which filters on `kind`)
                  // the moment any other beat carried an index.
                  stop={beat.kind === "stop" && beat.stopIndex !== undefined ? day.stops[beat.stopIndex] : undefined}
                  dayIndex={request.dayIndex}
                />
              ))}
            </div>
          )}
          {/* The window's own fade-out, so the lines still to come dissolve into the panel instead
              of being cut off by its edge. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
            style={{
              background: "linear-gradient(to top, rgb(var(--surface-deep-rgb) / 0.62), transparent)",
            }}
          />
        </div>

        {/* The end of the day, and the only place the film offers to go anywhere. */}
        {phase === "ended" && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => playDay(request.dayIndex)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-card-border bg-white/10 px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-white/20"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={2} />
              Again
            </button>
            {hasNextDay && (
              <button
                type="button"
                onClick={() => playDay(request.dayIndex + 1)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-3.5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-[0.98]"
              >
                Day {request.dayIndex + 2}
                <SkipForward className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>
        )}

        {/* The narrator, and the one thing about it worth a control.
            *
            * A toggle rather than a picker: there are two engines and the difference between them
            * is "the good one, which costs a download" — a dropdown would be a menu with two
            * items, one of which is the answer. It counts the download up rather than spinning,
            * because a minute of unexplained waiting on a phone reads as broken; and the film
            * keeps narrating in the platform voice throughout, so the toggle costs nothing to
            * press mid-story. */}
        {!silentPlatform && (
          <button
            type="button"
            onClick={() => setVoiceEngine(voiceEngine === "natural" ? "browser" : "natural")}
            disabled={naturalStatus === "unavailable" && voiceEngine !== "natural"}
            aria-pressed={voiceEngine === "natural"}
            className={`mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
              voiceEngine === "natural"
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-card-border bg-white/5 text-muted hover:bg-white/10"
            }`}
          >
            <AudioLines className="h-3.5 w-3.5" strokeWidth={2} />
            {voiceEngine === "natural" && naturalStatus === "loading"
              ? `Natural voice · ${Math.round(naturalProgress * 100)}%`
              : "Natural voice"}
          </button>
        )}

        {/* Things the traveller is owed rather than left to wonder about. */}
        {voiceEngine === "natural" && naturalStatus === "loading" && (
          <p className="mt-1.5 text-[11px] text-muted/80">
            Downloading a better narrator — 88 MB, kept for next time; 326 MB on a GPU, which is
            too big for the browser to keep, so it comes down each session. The story keeps playing
            meanwhile.
          </p>
        )}
        {voiceEngine === "natural" && naturalStatus === "unavailable" && (
          <p className="mt-1.5 text-[11px] text-muted/80">
            The natural voice couldn&rsquo;t load — staying with this device&rsquo;s own voice.
          </p>
        )}
        {script?.source === "fallback" && (
          <p className="mt-2 text-xs text-muted/80">
            Read from your plan — the storyteller wasn&rsquo;t reachable this time.
          </p>
        )}
        {silentPlatform && (
          <p className="mt-1 text-xs text-muted/80">
            No voice is available here, so the story plays without sound.
          </p>
        )}

        {/* Inside the panel, not under it. Outside it this line sat directly on the map and was
            measured unreadable over pale terrain — and it is the panel's own instructions. */}
        <p className="mt-2 text-[11px] text-muted/70">
          Space to pause · arrows to move · Esc to leave
        </p>
      </div>

      {/* The line being spoken, once, for a screen reader. */}
      <div className="sr-only" aria-live="polite">
        {script ? beats[beatIndex]?.text : `Writing the story of day ${request.dayIndex + 1}`}
      </div>
    </div>
  );
}

/**
 * One beat: the place it is about, and the line being said about it.
 *
 * The stop's avatar, time and name are the panel's own row vocabulary — reused rather than
 * restyled (`StopAvatar` comes straight from `StopList`), because the film is showing the same
 * itinerary and a second visual language for the same object would read as a different plan. What
 * is new is the narration line under it, and the ramp that fades it.
 */
function BeatRow({
  beat,
  index,
  activeIndex,
  stop,
  dayIndex,
}: {
  beat: StoryBeat;
  index: number;
  activeIndex: number;
  stop?: Stop;
  dayIndex: number;
}) {
  const isActive = index === activeIndex;
  // Both of these used to be `beat.kind === "opening" ? … : <the closing's>`, so every kind that
  // was not the opening claimed to be the end of the day — a beat this component had never heard
  // of rendered as "★ End of the day" in the middle of a film. Named per kind instead, with an
  // unknown one falling through to no mark and no label: it still gets its narration, and the row
  // says nothing about what it is rather than saying something false.
  const mark = beat.kind === "opening" ? dayIndex + 1 : beat.kind === "closing" ? "★" : null;
  const label = beat.kind === "opening" ? `Day ${dayIndex + 1}` : beat.kind === "closing" ? "End of the day" : null;
  // A travel beat is the going, not a place — so it gets the mode's glyph rather than a photograph
  // or the day's mark, and no title line at all. The sentence is the whole content, and a label
  // above it would only repeat what the row already looks like.
  const travelling = beat.kind === "travel";
  return (
    <div
      data-beat={index}
      // 620ms, matching the column's own lift, so the line arriving at the top and the line
      // brightening are one movement rather than two.
      className="flex gap-3 pb-5"
      style={{
        opacity: beatOpacity(index, activeIndex),
        transition: "opacity 620ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      aria-current={isActive ? "true" : undefined}
    >
      <span className="w-10 shrink-0">
        {travelling ? (
          <span className="flex h-10 w-10 items-center justify-center">
            <TravelGlyph />
          </span>
        ) : stop ? (
          <StopAvatar name={stop.name} category={stop.category} />
        ) : (
          // The opening and the closing are about the day, so they get the day's own mark rather
          // than a place's photograph.
          mark !== null && (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
              {mark}
            </span>
          )
        )}
      </span>
      <span className="min-w-0 flex-1">
        {stop ? (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-foreground">{stop.name}</span>
            {stop.time && <span className="text-xs text-muted">{stop.time}</span>}
          </span>
        ) : (
          label !== null && (
            <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
          )
        )}
        {/* The narration itself, italic because it is being spoken rather than listed. */}
        <span
          className={`mt-0.5 block text-sm leading-relaxed italic ${
            isActive ? "text-foreground" : "text-foreground/90"
          }`}
        >
          {beat.text}
        </span>
      </span>
    </div>
  );
}

/** The mode glyph on a travel beat. Muted, and smaller than a stop's avatar, because the beat is
 *  the connective tissue between two places rather than a place of its own. */
function TravelGlyph() {
  const profile = useRouteProfile();
  const Icon = profile === "bike" ? Bike : profile === "drive" ? Car : Footprints;
  return <Icon className="h-4 w-4 text-muted" aria-hidden="true" />;
}

/** A round icon control in the film's chrome. */
function TransportButton({
  label,
  children,
  ...rest
}: { label: string } & React.ComponentPropsWithoutRef<"button">) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
