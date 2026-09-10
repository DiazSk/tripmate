"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import { useMapCamera } from "@/lib/mapCamera";
import { addPlaceToDay, useActiveItinerary } from "@/lib/activeItinerary";
import { PLACE_CATEGORIES, type FoundPlace, type PlaceCategory } from "@/lib/placeSearch";

/**
 * Explore the map: find cafés, restaurants, museums near what you are looking at, and put one
 * into the plan.
 *
 * **Map only, never Satellite**, and that is a product decision rather than a limitation. The
 * vector map is the surface with street names, venue labels and a legible neighbourhood — it is
 * what exploring *means* here. Satellite is for looking at a plan that already exists, and a place
 * added from here becomes a `Stop`, so it is drawn on both engines from that moment on. Switching
 * to Satellite closes this and clears its pins; switching back does not restore them, because a
 * search is a question in progress rather than state worth persisting.
 *
 * **It searches around what is on screen, not around the trip.** The camera centre is the query's
 * origin, so panning somewhere and searching asks about *there* — which is the whole gesture. A
 * search anchored to the destination would answer the same way wherever you looked.
 *
 * Results are debounced but not live-per-keystroke: the free provider behind this is a shared
 * community Overpass instance that rate-limits exactly the traffic a live search box generates,
 * and being throttled is reported as "search is busy" rather than as "nothing found" — see
 * `placeSearch.ts` for why that distinction is load-bearing here.
 */
const DEBOUNCE_MS = 450;

const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  cafe: "Cafés",
  restaurant: "Food",
  bar: "Bars",
  museum: "Museums",
  park: "Parks",
  shop: "Shops",
  place: "Places",
};

export default function MapSearchPanel() {
  const { engine, rendererRef, ready, globeWanted, focusedDay, flyToPlace } = useMapCamera();
  const active = useActiveItinerary();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PlaceCategory | null>("cafe");
  const [places, setPlaces] = useState<FoundPlace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "empty" | "throttled">("idle");
  const [provider, setProvider] = useState<"google" | "osm">("osm");
  const [addedId, setAddedId] = useState<string | null>(null);

  const shown = engine === "maplibre" && globeWanted;
  // Derived, not stored. Toggling to Satellite has to put the search away — the pins belong to a
  // surface that is no longer on screen — and deriving it means there is no second source of truth
  // to keep in step, and no `setState` inside an effect reacting to the engine changing.
  const isOpen = open && shown;

  /** Push the current pins at the renderer. Selection is part of the pin, so this also runs when
   *  the traveler picks a row — the amber halo is how the list and the map agree. */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive()) return;
    renderer.showSearchResults(
      isOpen ? places.map((p) => ({ ...p, selected: p.id === selectedId })) : []
    );
  }, [places, selectedId, isOpen, rendererRef, ready]);

  const runSearch = useCallback(async () => {
    const renderer = rendererRef.current;
    const centre = renderer?.cameraState();
    if (!centre) return;
    setState("searching");
    try {
      const params = new URLSearchParams({ lat: String(centre.lat), lng: String(centre.lng) });
      if (query.trim()) params.set("q", query.trim());
      if (category) params.set("category", category);
      const res = await fetch(`/api/place-search?${params}`);
      const data = (await res.json()) as {
        places?: FoundPlace[];
        provider?: "google" | "osm";
        available?: boolean;
      };
      const found = data.places ?? [];
      setPlaces(found);
      setProvider(data.provider ?? "osm");
      setSelectedId(null);
      setState(data.available === false ? "throttled" : found.length ? "idle" : "empty");
    } catch {
      // Same fail-soft contract the route has: the traveler gets a state they can act on
      // (try again) rather than an error dialog.
      setPlaces([]);
      setState("throttled");
    }
  }, [query, category, rendererRef]);

  // Debounced, and only while open. A closed panel does not search, and neither does a change to
  // a field nobody can see.
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(runSearch, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isOpen, runSearch]);

  if (!shown) return null;

  const targetDay = focusedDay ?? 0;
  const dayLabel = `Day ${targetDay + 1}`;

  const addPlace = (place: FoundPlace) => {
    if (!active) return;
    active.onChange(addPlaceToDay(active.itinerary, targetDay, place));
    setAddedId(place.id);
    // Long enough to read as an acknowledgement, short enough that adding three places in a row
    // does not leave three rows claiming to be the most recent.
    setTimeout(() => setAddedId((id) => (id === place.id ? null : id)), 2200);
  };

  return (
    // Under the Map/Satellite toggle, sharing its gutter — the two are the same kind of control
    // (this is what the map can do) and belong in the same column.
    <div className="pointer-events-none fixed top-[calc(var(--nav-h)+4.5rem)] left-6 z-20 hidden sm:block print:hidden">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search the map for places"
          title="Search the map"
          className="glass-control pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition-transform duration-200 ease-out active:scale-[0.92]"
        >
          <Search className="h-4.5 w-4.5" strokeWidth={2.2} />
        </button>
      ) : (
        <div className="glass-control pointer-events-auto flex max-h-[min(70vh,640px)] w-80 flex-col overflow-hidden rounded-2xl">
          <div className="flex items-center gap-2 border-b border-card-border px-3 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search near this view…"
              aria-label="Search the map for places"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted/60 focus:outline-none"
            />
            {state === "searching" && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" aria-hidden="true" />
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close search"
              className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="scrollbar-none flex gap-1.5 overflow-x-auto border-b border-card-border px-3 py-2">
            {PLACE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory((current) => (current === c ? null : c))}
                aria-pressed={category === c}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  category === c
                    ? "bg-accent text-accent-foreground"
                    : "bg-white/10 text-muted hover:text-foreground"
                }`}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {state === "throttled" && (
              <p className="px-3 py-4 text-xs text-alert/75">
                Search is busy right now — the free places index rate-limits. Try again in a moment.
              </p>
            )}
            {state === "empty" && (
              <p className="px-3 py-4 text-xs text-muted">
                Nothing of that kind near this view. Pan somewhere else, or widen the search.
              </p>
            )}
            {places.map((place) => (
              <div
                key={place.id}
                className={`flex items-start gap-2 border-b border-white/5 px-3 py-2.5 transition-colors last:border-b-0 ${
                  selectedId === place.id ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(place.id);
                    // Same flight a stop gets — the neighbourhood around it, framed in the strip
                    // the panel leaves. No label passed, so this drops no search pin of its own.
                    flyToPlace(place.lat, place.lng);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm text-foreground">{place.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {CATEGORY_LABELS[place.category]}
                    {place.rating ? ` · ${place.rating.toFixed(1)}★` : ""}
                    {place.address ? ` · ${place.address}` : ""}
                  </span>
                </button>
                {active && (
                  <button
                    type="button"
                    onClick={() => addPlace(place)}
                    aria-label={`Add ${place.name} to ${dayLabel}`}
                    title={`Add to ${dayLabel}`}
                    className={`mt-0.5 flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[0.6875rem] font-medium transition-colors ${
                      addedId === place.id
                        ? "bg-accent/20 text-accent"
                        : "bg-white/10 text-muted hover:bg-white/20 hover:text-foreground"
                    }`}
                  >
                    {addedId === place.id ? (
                      "Added"
                    ) : (
                      <>
                        <Plus className="h-3 w-3" />
                        {dayLabel}
                      </>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Attribution, and an honest statement of which index answered. Both providers require
              it, and it is also the fastest way to tell whether a key is actually in play. */}
          <p className="shrink-0 border-t border-card-border px-3 py-1.5 text-[0.6875rem] text-white/40">
            {provider === "google" ? "Places by Google" : "Places by OpenStreetMap"}
          </p>
        </div>
      )}
    </div>
  );
}
