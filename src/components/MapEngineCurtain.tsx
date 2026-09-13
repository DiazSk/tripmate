"use client";

import { useMapCamera } from "@/lib/mapCamera";
import { devLabel } from "@/lib/devInspector";

/**
 * The sheet that covers the world while Map and Satellite trade places.
 *
 * **A curtain rather than a crossfade, and specifically because it has a held state.** Pressing
 * Satellite for the first time asks Cesium to build a viewer, import its module, fetch a Google
 * tileset and stream a city's photogrammetry — seconds of work whose finish nothing in the app used
 * to wait for. `ready` means "a renderer object exists", which is true the instant the tileset is
 * added to a scene where `globe.show` has already been set false, so the swap used to reveal an
 * empty planet with the day's route arcs hanging over nothing. A crossfade cannot fix that: it has
 * no moment where it is safe to be slow. A curtain is nothing *but* that moment.
 *
 * `DESIGN.md` settled the principle next door. **"The globe is covered, not switched off"** — The
 * Wait sits opaque over Cesium while it boots, because the import and first tiles are free inside a
 * wait that long. This is the same trade for a wait nobody planned.
 *
 * **The map only.** It mounts inside the `z-0` map box, so the navbar, the plan panel and the
 * toggle itself are untouched: the one thing that changed is the one thing covered, and the button
 * you pressed stays visible and stays pressed, so the gesture keeps its thread.
 *
 * The motion is a `clip-path` band with a slanted leading edge, which is the mechanism behind the
 * curtain in Motion's own page-transition set — measured off their running demo rather than guessed
 * at, down to the constant 150px offset between the top and bottom corners that *is* the slant. It
 * needs no library: CSS interpolates that polygon on its own, and the easing their curtain lands on
 * is indistinguishable from this app's house curve, so nothing new enters the type of motion here.
 */
export default function MapEngineCurtain() {
  const { engineSwap, advanceEngineSwap } = useMapCamera();
  const { phase, direction } = engineSwap;

  // Nothing at rest. The sheet is not a hidden element waiting to be shown — while there is no swap
  // running there is no node, so there is nothing in the hit path over a map somebody is dragging.
  if (phase === "idle") return null;

  return (
    <div
      // `covering` and `held` are the same geometry — fully closed — so they share a data value and
      // the CSS has two states rather than three. What separates them is only what is *on* the
      // sheet, and how long it stays.
      data-curtain={phase === "revealing" ? "leaving" : "closed"}
      data-toward={direction}
      // Sequenced on the real end of the sweep rather than a `setTimeout` matched to its duration.
      // That is not fastidiousness: under `prefers-reduced-motion` the blanket rule in `globals.css`
      // drives every duration to `0.01ms` rather than `none` *precisely* so these still fire, so a
      // reduced-motion visitor runs this identical sequence instantly — losing the sweep and
      // keeping the load gate, which is the half that matters.
      //
      // `e.target === e.currentTarget` because the note inside arrives on an animation of its own,
      // whose `animationend` bubbles through here and would otherwise advance the machine mid-hold.
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) advanceEngineSwap();
      }}
      className="map-curtain"
      // Announced rather than silent, because for several seconds this *is* the map to anyone not
      // looking at it. Polite, so it waits for a gap rather than interrupting.
      role="status"
      aria-live="polite"
      {...devLabel("MapEngineCurtain")}
    >
      {/* Mounted for the whole held beat, and invisible for the first 700ms of it.

          **The delay is the animation's, not a timer's.** A `setTimeout` into state needs a reset
          when the hold ends, and that reset is a `setState` during an effect, which this codebase
          refuses — correctly. An `animation-delay` with a `backwards` fill holds the element at
          opacity zero until the wait has actually become one, and the element unmounts with the
          sheet, so there is nothing to put back.

          It is also the better answer for a screen reader, which gets no benefit from the visual
          restraint: the live region carries the text from the start of the hold, so the
          announcement lands when the map starts changing rather than 700ms into it. */}
      {phase === "held" && (
        <p className="map-curtain-note">
          {direction === "cesium" ? "Bringing the satellite view in…" : "Bringing the map back…"}
        </p>
      )}
    </div>
  );
}
