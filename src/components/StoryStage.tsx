"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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

import { PauseIcon, PlayIcon } from "@/components/icons";
import { beatOpacity, type StoryBeat } from "@/lib/storyScript";
import { takeHandoffOrigin } from "@/lib/controlHandoff";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { useStoryPlayback, type StoryPlayback } from "@/lib/storyMode";
import { devLabel } from "@/lib/devInspector";
import { useRouteProfile } from "@/lib/dayRoutes";
import type { DayPlan, Stop } from "@/lib/types";
import { StopAvatar } from "./StopList";

/**
 * The stage's arrival and its departure, and they are deliberately not mirror images.
 *
 * Arriving is the house curve at the house duration — it is the film opening, and the panel is
 * what the eye should follow. Leaving is shorter and takes an `ease-in` (`0.4, 0, 1, 1`): a
 * dismissal should get out of the way rather than linger, and the thing worth watching on the way
 * out is the map the panel was covering. Both are plain tweens with a bezier, which is what lets
 * Framer run them through the Web Animations API rather than its own rAF loop — see the note on
 * the transport row about why that matters here specifically.
 */
const STAGE_ENTER = { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const };
const STAGE_EXIT = { duration: 0.18, ease: [0.4, 0, 1, 1] as const };

/**
 * Story mode's one piece of interface — the narration, in the docked column, directly under the
 * collapsed plan panel's capsule.
 *
 * **Where it sits is the design.** The capsule is the trip's single clean line (photo, destination,
 * length, day in focus), so this panel deliberately repeats **none** of it: no city, no day badge.
 * It is the "and here is the part being narrated" section beneath it, which is why its geometry is
 * copied from `DockedPanel`'s collapsed state rather than invented — same `right`/`left` insets,
 * same `sm:w-96` / `sm:max-w-[520px]`, offset down by the capsule's own `h-14` plus a gap. The two
 * read as one stack in the place the plan panel already occupies. An earlier revision floated this
 * bottom-centre over the map, which put the film's controls nowhere near the control that started
 * it and covered the ground the camera had just flown to.
 *
 * **Play is the capsule's until it is pressed, and then it is this panel's.** The capsule carries
 * it while there is no film, because that is the one thing worth reaching for while the plan is
 * shut. The moment there *is* a film, a play button up there and a transport row down here are two
 * different ideas of where the controls live — so the button leaves the capsule and takes its post
 * between Previous and Next, which is where every transport it has ever resembled puts it. It
 * travels rather than teleports: see `flyPlayIntoPlace` below.
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
  const request = playback?.request ?? null;
  const day = request ? request.itinerary.days[request.dayIndex] : undefined;

  /**
   * The presence gate, and the only reason this component is split in two.
   *
   * `exit()` clears the request synchronously — it has to, because `ItineraryCard`'s route effect
   * depends on `story.active` and the day's arcs must come back with the panel's framing. So there
   * is nothing left to draw by the time an exit animation would want to run. `AnimatePresence`
   * holds the *element it was last given*, props and all, which is exactly the frame the film
   * ended on; the body below therefore takes a non-null request as a prop rather than reading a
   * context that has already been emptied.
   */
  return (
    <AnimatePresence>
      {playback && request && day && (
        <StoryStageBody key="story-stage" playback={playback} request={request} day={day} />
      )}
    </AnimatePresence>
  );
}

function StoryStageBody({
  playback,
  request,
  day,
}: {
  playback: StoryPlayback;
  request: NonNullable<StoryPlayback["request"]>;
  day: DayPlan;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const playSlotRef = useRef<HTMLSpanElement>(null);

  const script = playback.script;
  const beatIndex = playback.beatIndex;

  /**
   * Put the play button in its slot, and — if it was just pressed up in the capsule — fly it down
   * from there.
   *
   * **The slot is read off `offsetLeft`/`offsetTop`, not off a rect.** The card is mid-entrance at
   * this exact moment and the stage is a few pixels low; a `getBoundingClientRect()` here would
   * bake that transient offset into the button's resting place and leave it a hair high forever.
   * Offsets are layout, and layout does not know about transforms.
   *
   * The flight itself is `Element.animate` rather than a transition or a Framer `layoutId`. A
   * transition needs the from-state painted first, and `layoutId` — which this codebase does use
   * for the map search morph — is symmetric, which this hand-off must not be: the capsule is
   * clipped (`.docked-panel` and `.docked-panel-capsule` both carry `overflow-hidden`, and the
   * collapsed panel's fold depends on it), so a return flight would spend most of its path behind
   * that clip and the rest sliding across the trip's own name. Leaving is a journey; coming back
   * is a cut. See `src/lib/controlHandoff.ts`.
   *
   * Layout effect, not `useEffect`: after paint the button would already have been drawn in its
   * slot for a frame, and the flight would start by throwing it back up to the capsule. Safe
   * without an isomorphic wrapper — `AppShell` imports this `ssr: false`, so no server pass ever
   * calls the hook.
   */
  useLayoutEffect(() => {
    const button = playRef.current;
    const slot = playSlotRef.current;
    if (!button || !slot) return;
    button.style.left = `${slot.offsetLeft}px`;
    button.style.top = `${slot.offsetTop}px`;

    const from = takeHandoffOrigin();
    if (!from || prefersReducedMotion()) return;
    const to = button.getBoundingClientRect();
    // Centre to centre, so the 44px capsule control and the 44px transport control agree about
    // what "the same button" means even if one of those sizes ever changes.
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    // Opacity rides along, and on a cold script it is doing real work. The button is `disabled`
    // until there are words to play — the same gate Prev/Next/Mute sit behind — so its resting
    // state on arrival is `disabled:opacity-40`, and without this it would leave the capsule by
    // *dimming*, which is the one thing that reads as "a different button". Instead it leaves at
    // full strength and settles into not-yet-ready. A warm script resolves this to 1 → 1.
    const settled = getComputedStyle(button).opacity;
    // **Promoted for the length of the flight, and on this screen that is the difference between
    // an animation and a stutter.** Measured on Cesium, the first 2.5s of a film is ~1.2s of
    // long tasks — the photorealistic tileset decoding a burst of new tiles on the main thread as
    // the camera dives. A main-thread animation freezes solid through a 160ms task of that kind;
    // a composited one keeps running. `will-change` is what guarantees the layer, and it is
    // cleared the moment the flight ends, because a permanent one is a permanent layer.
    button.style.willChange = "transform, opacity";
    const flight = button.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, opacity: "1" },
        { transform: "translate(0px, 0px)", opacity: settled },
      ],
      // `ease-in-out`, not the house `cubic-bezier(0.16, 1, 0.3, 1)` — and for exactly the reason
      // `DockedPanel` gives for the same swap on its own fold. That curve is enormously
      // front-loaded, which is what makes it right on a 12px nudge and wrong here: measured on
      // this flight, it was **84% of the way across at a third of the duration**, so a 267px
      // journey read as a snap with a long soft landing rather than as the button travelling.
      // 420ms, so it arrives just after the card behind it has finished its own 260ms `value-in`
      // — the stage materialises, then the control takes its post in it.
      { duration: 420, easing: "ease-in-out" }
    );
    const release = () => {
      button.style.willChange = "";
    };
    flight.finished.then(release, release);
    return () => flight.cancel();
  }, []);

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
  const playLabel =
    phase === "playing" ? "Pause the story" : phase === "ended" ? "Play the day again" : "Resume the story";

  return (
    // Geometry mirrored from `DockedPanel`'s collapsed branch, plus its `h-14` and a 0.75rem gap.
    // `z-10` matches the panel's, so this sits over the canvas and the marker cards exactly as the
    // capsule above it does.
    //
    // **The rise lives here and the fade lives on the card, and the split is deliberate.** This
    // element is the flying play button's ancestor, so an opacity animation on it would dim the
    // button through the first third of its journey — exactly the stretch where the eye has to
    // believe it is the same object that just left the capsule. A `transform` does not: the button
    // simply rides up with the row it is landing in, so the two stay aligned the whole way.
    // Leaving is the one time the whole thing may fade, because the button is leaving with it.
    <motion.div
      initial={{ y: 6 }}
      animate={{ y: 0 }}
      exit={{ y: 4, opacity: 0, transition: STAGE_EXIT }}
      transition={STAGE_ENTER}
      className="pointer-events-auto fixed top-[calc(var(--nav-h)+5.5rem)] right-4 left-4 z-10 sm:top-[calc(var(--nav-h)+5.75rem)] sm:right-6 sm:left-auto sm:w-96 sm:max-w-[520px]"
      {...devLabel("StoryStage")}
    >
      {/* The film's play/pause — and a **sibling** of the card rather than a child of the row it
          appears to sit in, which is the one structural oddity here and is load-bearing. The card
          fades itself in with `value-in`, and an ancestor's opacity applies to every descendant:
          inside it, this button would leave the capsule solid and then dissolve for the first
          260ms of its flight, which is exactly the stretch where the eye has to believe it is the
          same object. Absolute positioning does not care about DOM parentage — only about the
          nearest positioned ancestor, which is the fixed container — so it can be a sibling and
          still land in the gap the row leaves for it.

          First in the DOM, so the primary control is also first in the tab order; `z-10` because
          the card's `backdrop-filter` gives it a stacking context of its own and tree order would
          otherwise paint this behind it. */}
      <button
        ref={playRef}
        type="button"
        onClick={playback.togglePlay}
        disabled={!script}
        aria-label={playLabel}
        title={playLabel}
        className="absolute z-10 inline-flex h-11 w-11 items-center justify-center rounded-full text-accent transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:opacity-40"
      >
        {phase === "playing" ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
      </button>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={STAGE_ENTER}
        className="glass-itinerary rounded-[18px] px-4 py-3.5"
      >
        {/* Transport. Prev/Next are the traveller's own way through the day, Play/Pause between
            them is the film's own clock, and Mute and Close are the way out. */}
        <div className="flex items-center gap-1">
          <TransportButton label="Previous place" onClick={prev} disabled={!script}>
            <SkipBack className="h-4 w-4" strokeWidth={2} />
          </TransportButton>
          {/* Play's place in the row, kept open for the sibling above. 44px rather than the 40 of
              its neighbours: it is both the primary control here and the same size it was in the
              capsule, so the flight is a move and not also a resize. */}
          <span ref={playSlotRef} aria-hidden="true" className="h-11 w-11 shrink-0" />
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
            {/* `scaleX`, not `width`. Width is a layout property: the browser cannot hand it to
                the compositor, so a 500ms width transition relaid out and repainted this row on
                every frame — inside a panel whose `backdrop-filter` re-blurs on every one of
                those, on a screen where the tileset is already spending ~1.2s of the film's first
                2.5s on the main thread. A transform is free by comparison, and the bar is a
                1px rule whose only job is to be the right length. */}
            <div
              className="h-full w-full origin-left bg-accent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ transform: `scaleX(${position / beats.length})` }}
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

        <BeatPlate beats={beats} beatIndex={beatIndex} day={day} />

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
      </motion.div>

      {/* The line being spoken, once, for a screen reader. */}
      <div className="sr-only" aria-live="polite">
        {script ? beats[beatIndex]?.text : `Writing the story of day ${request.dayIndex + 1}`}
      </div>
    </motion.div>
  );
}

/**
 * The place the film is looking at, as a photograph.
 *
 * **Why one picture and not a carousel.** The ask was 3-4 per stop. There is no free source for
 * the second one, and the repo had already measured that: `placePhotos.ts` records 2 of 8 Siena
 * names resolving and 0 of 4 museums, and 0%/0%/1% `wikidata`/`wikimedia_commons`/`image` across
 * 60 named cafés. `/api/place-photo` returns Wikipedia's single lead image by design — `imageUrl`
 * and `thumbnailUrl` are two sizes of it, not two pictures. The two obvious ways to get more were
 * tested and both fail on the material rather than on the plumbing: an article's own image list is
 * alphabetical and uncurated (Jardin du Luxembourg's first four are a photo, an Edelfelt painting,
 * a boat basin and a postcard; Capitol Hill's include a *map*, inside a film whose whole premise is
 * a map), and Commons geosearch at a stop's coordinates returns whatever was photographed nearby —
 * for "Lunch around Saint-Germain-des-Prés", four portraits of strangers.
 *
 * **And why the pictures cannot pace the film.** The other half of the ask was to hold a stop until
 * its pictures had played. That is the fixed interval `useStopTour` was deleted for: the beat is the
 * clock, and a second one means the sentence and the slideshow disagree about when to leave. So this
 * has no duration of its own — it shows whatever the beat being spoken is about, and changes when
 * the beat does.
 *
 * **Outside the lyric column, deliberately.** The obvious home is `BeatRow`'s existing `StopAvatar`,
 * grown. It cannot go there: the column is positioned by a *measured*
 * `translateY(-row.offsetTop)` computed once per beat, and an image inside a row changes every
 * following row's `offsetTop` asynchronously as it decodes — after that measurement has run. The
 * ramp would drift with no error anywhere.
 *
 * **It grows; it is not reserved. That is the correction the built version forced.** The first cut
 * held a fixed 112px band open at the top of the card, on the lyric window's own reasoning that the
 * panel must not jump between beats. Then coverage was measured across a 20-stop Paris trip and it
 * is **3 in 20**, not the half that was assumed — Musée d'Orsay, Sacré-Cœur and Luxembourg Gardens
 * all miss, the last because `resolveTitle`'s containment check will not accept "Jardin du
 * Luxembourg" for it. A band reserved for a picture that arrives one beat in seven is a hole, which
 * is the exact thing `placePhotos.ts` says not to build, and on screen it read as an image that had
 * failed to load.
 *
 * So the band opens only when there is something in it, and it sits **below the lyric window** so
 * that opening moves nothing anyone is using: the transport row, the play button's measured slot
 * and the narration all hold their positions, and only the voice toggle and the keyboard hint below
 * are pushed down. A beat with no picture is then exactly the panel that shipped before this
 * existed — the feature costs nothing when it has nothing to say.
 *
 * `sm:` and up. On a 667px phone the panel already leaves ~118px of map and the `ended` state
 * spends 52 of it, and there the map is the scarcer thing. Same line the full map-control set
 * already draws.
 */
/** `mt-3` (12px) plus the plate's own `h-28` (112px). Written out because `height: auto` cannot
 *  be interpolated, so the open state has to state a number. */
const PLATE_BOX_PX = 124;

function BeatPlate({
  beats,
  beatIndex,
  day,
}: {
  beats: StoryBeat[];
  beatIndex: number;
  day: DayPlan;
}) {
  // Keyed on `kind`, the same rule `BeatRow` follows and for the same reason — `stopIndex` being
  // present is a second, quieter definition of a stop beat that would eventually disagree.
  const stopOf = (beat?: StoryBeat) =>
    beat?.kind === "stop" && beat.stopIndex !== undefined ? day.stops[beat.stopIndex] : undefined;

  /**
   * `"thumb"`, not `"full"`, and that is the whole prefetch strategy.
   *
   * This started as `"full"` with an `Image()` warm one stop ahead, on the reasoning that a decode
   * should not land on the frame the camera is diving on. Measured, the originals are 989x1961 for
   * Sainte-Chapelle and **3840x1613** for the Louvre — six megapixels, decoded to be drawn 350px
   * wide. The thumbnail is 330px, which is the size of this box, and every `BeatRow` below has
   * *already* fetched and decoded exactly that image for its own `StopAvatar` the moment the stage
   * mounted. So there is nothing left to warm: the picture is in the browser before the film starts.
   *
   * (Neither the warm nor the full original was measurable against Cesium's noise on this screen —
   * six beat advances came out at 44 dropped frames with the plate and 44 with it deleted. It is
   * removed for being obviously wasteful, not because it showed up.)
   */
  const photo = usePlacePhoto(stopOf(beats[beatIndex])?.name ?? "");
  const [failed, setFailed] = useState<string | null>(null);
  const shown = photo && photo !== failed ? photo : null;

  return (
    // Decorative: the narration names the place, and the beat row above it names it again in text.
    // A screen reader gets nothing new from this and an `alt` would be a third repetition.
    //
    // `height` is a layout property and this is the one place in the film's chrome that animates
    // one — deliberately, and it is affordable where the progress bar's `width` was not. That ran
    // for 500ms on *every* beat; this runs on the handful that have a picture, and it is a real
    // reflow either way because the panel genuinely changes size. An explicit 124px rather than
    // `auto` so the value is interpolable at all.
    <div
      aria-hidden="true"
      className="hidden overflow-hidden transition-[height,opacity] duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] sm:block"
      style={{ height: shown ? PLATE_BOX_PX : 0, opacity: shown ? 1 : 0 }}
    >
      <div className="relative mt-3 h-28 overflow-hidden rounded-lg bg-white/5">
        {shown && (
          // Keyed on the URL so each stop's picture is its own element and arrives on `value-in` —
          // the same 260ms settle `StopAvatar` uses when its own lookup lands, so the two
          // photographs of one place appear the same way.
          //
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia originals; next/image *throws* on an unconfigured host, which once took the whole of /trip/[id] down
          <img
            key={shown}
            src={shown}
            alt=""
            onError={() => setFailed(shown)}
            className="value-in absolute inset-0 h-full w-full object-cover"
          />
        )}
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
