"use client";

import { useMapCamera } from "@/lib/mapCamera";
import { setStoredMapEngine, type MapEngine } from "@/lib/mapEngine";

/**
 * Map / Satellite, in the corner under the wordmark.
 *
 * It sits where the dev container inspector used to — a badge that named whichever `devLabel`ed
 * box the pointer was over. That was a debugging aid on a surface whose whole argument is the
 * imagery, and this is a better use of the same 40 pixels.
 *
 * **"Satellite" is Cesium and "Map" is MapLibre**, and the labels are the honest names for what
 * each one actually shows: Google Photorealistic 3D Tiles against OpenFreeMap vector tiles with a
 * terrain DEM. Neither label mentions an engine, because the traveler is choosing a *view*.
 *
 * The switch keeps the view — see `setEngine` in `mapCamera.tsx`. It does not reload, and it does
 * not refetch the trip: the incoming engine is handed the outgoing one's camera and the geometry,
 * highways, city outline and pin it already had.
 *
 * The choice is also written to storage, so the next page load opens on it. That is deliberate and
 * not merely convenient: rebuilding Cesium's tileset costs seconds and 800 requests, so a traveler
 * who prefers satellite should not pay for the vector map first on every navigation.
 *
 * **It stays live while the map search is open**, and that is a reversal. It used to fade out and
 * leave the pointer and focus paths for the duration, on the reasoning that search is a Map-only
 * surface and the switch's only effect mid-search is to throw the search away. Two things make
 * that wrong. The first is that it is not true any more: `open` in `MapSearchPanel` survives the
 * engine change — only the derived `isOpen` goes false — so Satellite and back returns the panel
 * with its query and its categories intact, and the switch costs a round trip rather than the
 * question. The second is that it never read as a considered refusal: the two controls share a
 * gutter and nothing else, so one of them dimming as the other opens reads as chrome breaking.
 * The panel sits *below* this pill and has never covered it, which is the whole reason the fade
 * had to be argued for in prose rather than being visible on screen.
 */
export default function MapEngineToggle() {
  const { engine, setEngine, globeWanted } = useMapCamera();

  // Nothing to toggle where there is no map. The same predicate the engines themselves use, so
  // this appears and disappears exactly with the thing it controls rather than on a path list.
  if (!globeWanted) return null;

  const choose = (next: MapEngine) => {
    if (next === engine) return;
    setStoredMapEngine(next);
    setEngine(next);
  };

  return (
    // Under the navbar and inset by the same gutter the docked panel uses on the other side.
    // `z-20` puts it over the marker cards at z-5 and the content overlay at z-10, matching
    // `MapControls` — this is map chrome, and map chrome sits above the world it describes.
    // Hidden below `sm`, where the panel goes full-bleed and there is no map to look at anyway.
    <div className="pointer-events-none fixed top-[calc(var(--nav-h)+1.5rem)] left-6 z-20 hidden sm:block print:hidden">
      <div
        className="glass-control pointer-events-auto flex overflow-hidden rounded-full p-1"
        role="group"
        aria-label="Map view"
      >
        <Choice label="Map" active={engine === "maplibre"} onClick={() => choose("maplibre")} />
        <Choice label="Satellite" active={engine === "cesium"} onClick={() => choose("cesium")} />
      </div>
    </div>
  );
}

/**
 * One half of the segmented control.
 *
 * `aria-pressed` rather than a radio group: these are two buttons that change the map immediately,
 * not a form input with a value to submit, and a toggle button is what that is.
 *
 * The selected fill is written as an inline `bg-*` utility and it *works* here, unlike on
 * `.glass-control` itself — that class sets `background` as an unlayered rule in globals.css and
 * outranks every `@layer utilities` declaration, which is why four controls once shipped with dead
 * hover states. This element is a child of the glass pill, not the pill, so its own background is
 * uncontested.
 */
function Choice({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-200 ${
        active ? "bg-white/20 text-white" : "text-white/60 hover:text-white/90"
      }`}
    >
      {label}
    </button>
  );
}
