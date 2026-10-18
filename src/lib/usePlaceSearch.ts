"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMapCamera } from "@/lib/mapCamera";
import { metresBetween } from "@/lib/peekRange";
import type { CameraState } from "@/lib/mapRenderer";
import { useActiveItinerary } from "@/lib/activeItinerary";
import type { FoundPlace, PlaceCategory } from "@/lib/placeSearch";
import { rememberSearch } from "@/lib/searchHistory";
import { failureFromThrown } from "@/lib/failure";
import { encodePolygon, searchAreaFor, type LatLng } from "@/lib/searchArea";
import { isTilePlace, placeFromTilePoi, placesFromTiles } from "@/lib/tilePlaces";

/**
 * The map's place search, without its interface: what `MapSearchPanel` (the map chrome's search)
 * and `TripSpotlight` (the trip page's) both ask the map with. Moved here from the panel unchanged,
 * so the two answer the same question the same way: tiles first, then `/api/place-search`, around
 * what is on screen, re-asked when the view moves.
 *
 * Results are debounced but not live-per-keystroke: the free provider behind this is a shared
 * community Overpass instance that rate-limits exactly the traffic a live search box generates,
 * and being throttled is reported as "search is busy" rather than as "nothing found" — see
 * `placeSearch.ts` for why that distinction is load-bearing here.
 *
 * Each caller draws its own pins from `visiblePlaces`, because they draw them differently (the
 * trip page numbers them in its own order).
 */
const DEBOUNCE_MS = 450;

/** How far the view must travel before it is worth asking again, as a fraction of the camera's
 *  distance to the ground — so it means the same thing over a city and over a street. */
const MOVE_TO_RESEARCH = 0.25;

/** The route clamps `radius` to a 200m floor, so this is already the smallest query it will run. */
const FACTS_RADIUS_M = 200;
/** A tile POI and its OSM node are the same object, so they agree to within metres. Anything this
 *  far off is a different venue that happens to share part of a name. */
const FACTS_MAX_DRIFT_M = 120;

export type PlaceSearchState = "idle" | "searching" | "empty" | "throttled";

export function usePlaceSearch({
  open,
  fallbackCategories,
  factsDwellMs = 0,
}: {
  /** Whether the search is on screen. Nothing is asked, and no map click is listened to, while not. */
  open: boolean;
  /** Asked for when nothing is typed and no category is pressed: the trip page's chosen gap is a
   *  question on its own ("what suits 3 PM?"). Without it, no question means no search. */
  fallbackCategories?: PlaceCategory[];
  /**
   * How long a place must stay selected before its missing facts are looked up. Zero where a
   * selection is a click; the trip page selects as the arrow keys move, and a key held down would
   * otherwise spend one Overpass request per row it passes.
   */
  factsDwellMs?: number;
}) {
  const { rendererRef, ready } = useMapCamera();
  const active = useActiveItinerary();

  const [query, setQuery] = useState("");
  /**
   * The categories currently asked for — a union, and empty on open.
   *
   * A set rather than a single value, because "cafés and bars near here" is one question a traveler
   * has and used to take two searches that overwrote each other. Empty on open: nothing is
   * pre-selected, so nothing is searched until asked.
   */
  const [categories, setCategories] = useState<PlaceCategory[]>([]);
  const [places, setPlaces] = useState<FoundPlace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [state, setState] = useState<PlaceSearchState>("idle");
  /** Why `state` is "throttled": the index turned the search away, the traveller is offline, or the
   *  route didn't answer (copy rows T-38..T-40). */
  const [throttledBy, setThrottledBy] = useState<"busy" | "offline" | "server">("busy");
  const [provider, setProvider] = useState<"google" | "osm">("osm");
  const [history, setHistory] = useState<string[]>([]);

  /** The camera position the current results describe. See the idle effect. */
  const lastSearchedRef = useRef<CameraState | null>(null);
  /** Until when a camera stop is the caller's own flight rather than the traveller moving the view. */
  const idleHoldUntilRef = useRef(0);
  /**
   * Which search is the live one.
   *
   * The same `drawGeneration` guard the renderer uses, and needed here for the same reason: two
   * searches can be in flight and they do not land in order. It became visible the moment the tiles
   * became the first index asked — a tile answer is instant, so an Overpass call from the *previous*
   * view is still open when it arrives, and 25 seconds later its "search is busy" landed on top of
   * a list that was already on screen and correct. Panning away from a throttled area and back into
   * a dense one showed it every time.
   */
  const searchGenerationRef = useRef(0);

  const asked = categories.length ? categories : query.trim() ? [] : (fallbackCategories ?? []);
  // A stable key for the categories actually asked, so a fresh fallback array each render is not a
  // fresh search.
  const askedKey = asked.join(",");

  /** There is a question to ask when something has been typed or a category pressed (or a fallback
   *  given). Both the debounce and the empty state hang off this. */
  const hasQuery = query.trim().length > 0 || asked.length > 0;

  /**
   * The one place the traveler opened by clicking the basemap, when there is no question on screen.
   *
   * A click **is** a question — about that place, specifically — but it sets no query and presses no
   * chip, so `hasQuery` stays false and the gate below would throw the answer away. Held as an id
   * rather than a place so it stays a view of `places`: the row, the pin, the day picker and
   * `addedDays` all key off the same object either way.
   */
  const [clickedId, setClickedId] = useState<string | null>(null);

  /**
   * What the list is actually showing.
   *
   * Clearing the box all the way back to empty has to put the panel back in its opening state, and
   * the obvious way to do that — an effect that empties `places` when the query goes blank — is a
   * cascading render to express something that is already derivable. Gating here instead means the
   * last answer is simply not rendered while there is no question, and typing the query back in
   * shows it again with no refetch.
   *
   * Memoised so the `[]` branch is a stable reference. Without it the pin effects re-run on every
   * render while the query is empty, pushing an identical empty collection at the renderer.
   */
  const visiblePlaces = useMemo(
    () => (hasQuery ? places : places.filter((p) => p.id === clickedId)),
    [hasQuery, places, clickedId]
  );

  /**
   * Clicking a pin selects its place, exactly as clicking its row does.
   *
   * `selectedId` is the whole of it — no second piece of state for "which place the card is about".
   * The row already sets it, `runSearch` already clears it, and the caller's pins already enlarge
   * whichever pin it names, so one value keeps the map, the list and the card agreeing about which
   * place is live, and a fresh search closes the card for free.
   *
   * No camera move. The traveller just clicked something they could see; flying the ground out from
   * under a click is the one thing that reliably reads as broken.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive() || !open) return;
    return renderer.onSearchPinClick(setSelectedId);
  }, [rendererRef, ready, open]);

  /**
   * **Clicking a name the basemap drew opens its card.**
   *
   * The map is already a list of places — Liberty labels thousands of them — and until now pointing
   * at one did nothing unless a search had happened to return it. This closes that: the thing the
   * traveller can see is the thing they can act on.
   *
   * The clicked place is folded into `places` rather than shown some other way. `openPlace` is
   * derived from the result list, `addedDays` and `tileFacts` key off the id, and the day picker
   * reads the same row — so a clicked place that lived anywhere else would need every one of those
   * paths duplicated. `placeFromTilePoi` mints the same id `placesFromTiles` would, which is what
   * makes the fold idempotent: click a pin that *is* already in the list and it matches by id
   * rather than arriving twice.
   *
   * Prepended, because a place somebody just pointed at outranks the nearest-first ordering — it is
   * the one row they are looking for.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive() || !open) return;
    return renderer.onBasemapPoiClick((poi) => {
      const place = placeFromTilePoi(poi);
      setPlaces((current) =>
        current.some((p) => p.id === place.id) ? current : [place, ...current]
      );
      setSelectedId(place.id);
      setClickedId(place.id);
      // A click is an answer, so the panel must stop saying it found nothing — the click can land
      // while the list is empty, throttled, or mid-search.
      setState("idle");
    });
  }, [rendererRef, ready, open]);

  /** The place the card is about, derived rather than stored — see the effect above. */
  const openPlace = useMemo(
    () => visiblePlaces.find((p) => p.id === selectedId) ?? null,
    [visiblePlaces, selectedId]
  );

  /**
   * The facts a vector tile cannot carry, filled in for the one place whose card is open.
   *
   * A tile POI is four fields — name, class, subclass, rank — and no id, so there is no handle to
   * look anything else up by. What there *is* is a name and a coordinate, which is exactly the
   * question `/api/place-search` already answers: `q=<name>` inside `around:200`. No new route, no
   * new server code, and the same fail-soft contract as every other search.
   *
   * **This is what inverts the load.** Overpass used to answer every chip press over a
   * neighbourhood; now it answers one tiny query for the one place somebody actually looked at.
   *
   * Keyed by place id and kept for the life of the panel, so pointing back at a pin is free.
   * An empty object is the recorded answer for "asked, found nothing" — the card is built to look
   * finished without any of this, so a miss is a shape rather than a failure.
   */
  const [tileFacts, setTileFacts] = useState<Record<string, Partial<FoundPlace>>>({});

  useEffect(() => {
    const place = openPlace;
    if (!place || !isTilePlace(place) || tileFacts[place.id]) return;
    let alive = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        lat: String(place.lat),
        lng: String(place.lng),
        q: place.name,
        radius: String(FACTS_RADIUS_M),
      });
      // Narrowed to the tile's own category where it has one, which both shrinks the query and
      // stops a café's card being filled in by a restaurant two doors down with a similar name.
      if (place.category !== "place") params.set("category", place.category);
      fetch(`/api/place-search?${params}`)
        .then((r) => r.json())
        .then((data: { places?: FoundPlace[] }) => {
          if (!alive) return;
          // Overpass already matched the name; this is the second half of the trust boundary.
          // These are somebody's opening hours and phone number, and attaching them to the wrong
          // venue is worse than showing none — so a hit further away than a building is discarded.
          const match = data.places?.find(
            (candidate) => metresBetween(place, candidate) <= FACTS_MAX_DRIFT_M
          );
          setTileFacts((prev) => ({
            ...prev,
            // Field by field, never a spread of `match`: its `id` is Overpass's, and adopting it
            // would detach the card from the pin it is anchored to and from `addedDays`, which is
            // keyed by the tile's id and is what keeps "Added · Day 3" on the row.
            [place.id]: match
              ? {
                  address: match.address,
                  website: match.website,
                  phone: match.phone,
                  openingHours: match.openingHours,
                  cuisine: match.cuisine,
                  wheelchair: match.wheelchair,
                  outdoorSeating: match.outdoorSeating,
                  wikidataId: match.wikidataId,
                }
              : {},
          }));
        })
        .catch(() => {
          if (alive) setTileFacts((prev) => ({ ...prev, [place.id]: {} }));
        });
    }, factsDwellMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [openPlace, tileFacts, factsDwellMs]);

  /** The open place with whatever the lookup above found folded in. Identical to `openPlace` for
   *  anything that came from a provider, which already arrives complete. */
  const selectedPlace = useMemo(
    () => (openPlace ? { ...openPlace, ...tileFacts[openPlace.id] } : null),
    [openPlace, tileFacts]
  );

  /** Facts folded in for any place already looked up, for a caller that reads more than the open one. */
  const withFacts = useCallback((place: FoundPlace) => ({ ...place, ...tileFacts[place.id] }), [tileFacts]);

  const runSearch = useCallback(async () => {
    const renderer = rendererRef.current;
    const centre = renderer?.cameraState();
    if (!centre || !renderer) return;
    // Claimed before anything else, so every earlier search — including one already awaiting a
    // response — is superseded from this line on.
    const generation = ++searchGenerationRef.current;
    // Where this answer is *about*, so the idle handler below can tell a real move from a nudge.
    // Written before the request rather than after it: two searches must not race into one another
    // because the first had not recorded itself yet.
    lastSearchedRef.current = centre;

    const trimmed = query.trim();
    const askedCategories = (askedKey ? askedKey.split(",") : []) as PlaceCategory[];

    // The area, computed rather than assumed. The footprint is the ground the camera can
    // actually see; the stops inside it are joined into a hull and pushed out by a kilometre-
    // scale buffer, and *that* is what gets searched. `searchAreaFor` falls back to the bare
    // footprint when no stop is on screen, and the route falls back to a circle if the shape
    // fails to parse — so every layer below has a sensible answer for "no shape".
    //
    // Hoisted out of the request builder because both indexes want it now: the tile search below
    // filters against the same polygon, so the two paths answer about the same piece of ground.
    let area: LatLng[] | undefined;
    const footprint = renderer.visibleFootprint();
    if (footprint.length >= 3) {
      const stops = (active?.itinerary.days ?? []).flatMap((d) =>
        d.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }))
      );
      const hull = searchAreaFor(footprint, stops);
      if (hull.length >= 3) area = hull;
    }

    /**
     * **Ask the map before asking the internet.**
     *
     * The vector tiles under the camera already carry every POI the basemap draws a label for —
     * they arrived with the streets — so this is a walk over objects already in memory: no request,
     * no latency, and nothing a shared community Overpass server can rate-limit. Measured on the
     * nine z14 tiles around Siena: 4,727 named POIs, 161 of them cafés.
     *
     * Falling through on an empty answer is the whole of the hybrid. The tiles' `poi` layer is
     * unpopulated below z14, so a trip-overview framing genuinely has nothing to offer and Overpass
     * still answers it — and a neighbourhood with no cafés looks identical either way, which is
     * fine: an Overpass search that also finds none reports the same honest empty state.
     *
     * ponytail: any tile hit wins, however thin. A z14 search that turns up two obscure matches
     * beats Overpass to the answer and stops there, where Overpass might have found eight. Raise
     * the bar to a count if that shows up in use; a threshold guessed now is a threshold nobody
     * measured.
     */
    const fromTiles = placesFromTiles(renderer.queryVisiblePois(), {
      centre: { lat: centre.lat, lng: centre.lng },
      query: trimmed,
      categories: askedCategories,
      area,
    });
    if (fromTiles.length) {
      setPlaces(fromTiles);
      setClickedId(null);
      // Honest: OpenMapTiles builds these tiles from OpenStreetMap, so the attribution the panel
      // already prints is the right one and does not need a third case.
      setProvider("osm");
      setSelectedId(null);
      setState("idle");
      if (trimmed) setHistory(rememberSearch(query));
      return;
    }

    setState("searching");
    try {
      const params = new URLSearchParams({ lat: String(centre.lat), lng: String(centre.lng) });
      if (area) params.set("area", encodePolygon(area));
      if (trimmed) params.set("q", trimmed);
      if (askedCategories.length) params.set("category", askedCategories.join(","));
      const res = await fetch(`/api/place-search?${params}`);
      // An error body has no places in it, and would otherwise read as an honest "nothing here".
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        places?: FoundPlace[];
        provider?: "google" | "osm";
        available?: boolean;
      };
      if (generation !== searchGenerationRef.current) return;
      const found = data.places ?? [];
      setPlaces(found);
      setClickedId(null);
      setProvider(data.provider ?? "osm");
      setSelectedId(null);
      setThrottledBy("busy");
      setState(data.available === false ? "throttled" : found.length ? "idle" : "empty");
      // Recorded on the answer rather than the keystroke, so the history is searches that actually
      // ran — not every prefix the debounce happened to catch on the way to one.
      if (trimmed && data.available !== false) setHistory(rememberSearch(query));
    } catch (e) {
      // Same fail-soft contract the route has: the traveler gets a state they can act on
      // (try again) rather than an error dialog — but only if this is still the search anybody is
      // waiting on. A failure belonging to a view that has been panned away from is not news.
      if (generation !== searchGenerationRef.current) return;
      setPlaces([]);
      setThrottledBy(failureFromThrown(e).kind === "offline" ? "offline" : "server");
      setState("throttled");
    }
    // `active` whole, not `active?.itinerary`. The React Compiler infers the dependency at the
    // coarsest property it sees read and refuses to keep a manual memo whose declared deps are
    // *narrower* than the inferred one — a real check, since a narrower dep is a callback that can
    // go stale. The itinerary is the only thing read either way.
  }, [query, askedKey, rendererRef, active]);

  /**
   * Debounced, only while open, and **only once there is something to search for**.
   *
   * The last clause is what keeps the empty state empty. With neither a query nor a category there
   * is no question to ask, and firing anyway is how the panel used to open straight into a list of
   * cafés nobody requested.
   */
  useEffect(() => {
    if (!open || !hasQuery) return;
    const timer = setTimeout(runSearch, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, hasQuery, runSearch]);

  /**
   * **Drag the map and the suggestions follow it.**
   *
   * The placeholder has always said "Search near this view…", and it was half true: the *first*
   * search was near the view, and everything after it was a set of pins stuck to wherever the
   * camera happened to be at the time. Panning somewhere else left them behind, describing a
   * neighbourhood no longer on screen.
   *
   * Two guards, and both exist because the index behind this is a shared community Overpass server
   * that rate-limits exactly this traffic:
   *
   * - **`onCameraIdle`, not `onFrame`.** One look per gesture, once the camera has stopped *and*
   *   the tiles for the new view have parsed — see the note on the MapLibre implementation for why
   *   the second half of that is load-bearing now that the tiles are the first index asked.
   * - **A movement floor scaled to the camera's own range.** Nudging the map by a few pixels, or
   *   the framing correction that runs when a stop is added, must not spend a request. A quarter of
   *   the camera's distance to the ground is roughly "the view is meaningfully somewhere else" at
   *   any zoom, which a fixed metre threshold cannot be. It is also what keeps the idle event's
   *   non-camera firings — a source write, a style repaint — free.
   *
   * A third, for the trip page: a flight the caller made to show a result (`holdResearch`) moves
   * the view without anybody asking about the new one, so its stop only re-bases the floor.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive() || !open || !hasQuery) return;
    return renderer.onCameraIdle(() => {
      const now = rendererRef.current?.cameraState();
      if (!now) return;
      if (performance.now() < idleHoldUntilRef.current) {
        lastSearchedRef.current = now;
        return;
      }
      const last = lastSearchedRef.current;
      if (last && metresBetween(last, now) < now.rangeM * MOVE_TO_RESEARCH) return;
      void runSearch();
    });
  }, [rendererRef, ready, open, hasQuery, runSearch]);

  /** The camera is about to move on the caller's account: don't treat where it lands as a new view. */
  const holdResearch = useCallback((ms: number) => {
    idleHoldUntilRef.current = performance.now() + ms;
  }, []);

  return {
    query,
    setQuery,
    categories,
    setCategories,
    asked,
    hasQuery,
    visiblePlaces,
    selectedId,
    setSelectedId,
    hoveredId,
    setHoveredId,
    selectedPlace,
    withFacts,
    state,
    throttledBy,
    provider,
    history,
    setHistory,
    runSearch,
    holdResearch,
  };
}
