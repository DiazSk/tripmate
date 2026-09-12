"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronLeft, Clock, Loader2, MapPin, Search, Sparkles, X } from "lucide-react";
import { useMapCamera } from "@/lib/mapCamera";
import { metresBetween } from "@/lib/peekRange";
import type { CameraState } from "@/lib/mapRenderer";
import { addPlaceToDay, useActiveItinerary } from "@/lib/activeItinerary";
import { PLACE_CATEGORIES, type FoundPlace, type PlaceCategory } from "@/lib/placeSearch";
import { suggestDayForPlace, type DayShape } from "@/lib/dayFit";
import { planSlot, suggestTimeOfDay } from "@/lib/daySlotting";
import { TIME_OF_DAY_ORDER, type TimeOfDay } from "@/lib/timeOfDay";
import type { Itinerary, Stop } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";
import SearchPinCard, { AddToDayButton } from "@/components/SearchPinCard";
import { useAnchoredToMap } from "@/lib/useAnchoredToMap";
import {
  forgetSearch,
  itineraryHighlights,
  recentSearches,
  rememberSearch,
} from "@/lib/searchHistory";
import { useToast } from "@/lib/toast";
import { encodePolygon, searchAreaFor } from "@/lib/searchArea";
import { SEARCH_COLOURS, searchColourFor } from "@/lib/searchPalette";

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
 *
 * **Nothing is selected when it opens, and nothing is searched.** A category pre-selected on mount
 * fires a request the traveler did not ask for, against a rate-limited shared index, and answers a
 * question ("cafés?") they may not have been asking — then makes the *real* first search compete
 * with it. The panel opens on its own empty state instead: what this traveler searched for before,
 * and what their plan already contains.
 */
const DEBOUNCE_MS = 450;

/**
 * The morph between the collapsed icon and the expanded panel.
 *
 * One `layoutId` on both halves is the whole mechanism: Framer sees the same identity leave one
 * box and arrive in another within a single commit, and interpolates position, width and height
 * between them rather than cross-fading two unrelated elements. Under `MotionConfig
 * reducedMotion="user"` — set once in `AppShell` — a reduced-motion profile skips straight to the
 * end state, so this needs no `prefers-reduced-motion` branch of its own.
 */
const SEARCH_LAYOUT_ID = "search-container";

/**
 * How long the card survives the pointer leaving its pin.
 *
 * 260ms was measured against a synthetic event and is nowhere near a hand: reaching the card means
 * crossing a gap, and a person who pauses on the way — to read the thing they are reaching for —
 * takes longer than that, so the card closed before it could be used. The gap itself is now bridged
 * in CSS (`.search-pin-card::after`), which is the actual fix; this is the backstop for the paths
 * the bridge does not cover, like the pointer leaving the map entirely.
 */
const CARD_GRACE_MS = 600;

/** How far the view must travel before it is worth asking again, as a fraction of the camera's
 *  distance to the ground — so it means the same thing over a city and over a street. */
const MOVE_TO_RESEARCH = 0.25;
const SEARCH_SPRING = { type: "spring", stiffness: 320, damping: 32 } as const;

/**
 * The *resize*, which is a different motion from the morph and used to borrow its spring.
 *
 * A morph is one object becoming another and wants to arrive: 44px circle to 352px panel in about
 * 320ms is right. A resize is the panel already on screen changing its mind about how tall it is —
 * unselecting a category drops it from the 640px cap to 322px — and at the morph's stiffness that
 * is a snap. Measured on the way in: 1.37 scaleY on the first frame, back to 1.0 by 360ms, with
 * more than half the travel spent in the first 120ms. That front-loading is what reads as a jerk.
 *
 * Critically damped on purpose (damping 30 against a critical 29.7 at this stiffness and mass), so
 * it settles rather than bouncing — a bounce on a box full of text is a second thing to watch. It
 * lands around 490ms, which is slower than the morph and should be: nothing is arriving, the panel
 * is just taking up less room.
 */
const RESIZE_SPRING = { type: "spring", stiffness: 200, damping: 30, mass: 1.1 } as const;

const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  cafe: "Cafés",
  restaurant: "Food",
  bar: "Bars",
  museum: "Museums",
  park: "Parks",
  shop: "Shops",
  place: "Places",
};

/** Metres → the short form the day picker uses. Below a kilometre people think in hundreds of
 *  metres; above it, one decimal is all anybody reads off a suggestion. */
function shortDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres / 10) * 10}m` : `${(metres / 1000).toFixed(1)}km`;
}

export default function MapSearchPanel({
  onOpenChange,
}: {
  /** Told whenever the panel expands or collapses, so the shell can stand the overlapping map
   *  controls down. See the note where `AppShell` renders the two. */
  onOpenChange?: (open: boolean) => void;
}) {
  const { engine, rendererRef, ready, globeWanted, flyToSearchResult } = useMapCamera();
  const active = useActiveItinerary();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * The categories currently asked for — a union, and empty on open.
   *
   * A set rather than a single value, because "cafés and bars near here" is one question a traveler
   * has and used to take two searches that overwrote each other. Empty on open for the reason in
   * this file's header: nothing is pre-selected, so nothing is searched until asked.
   */
  const [categories, setCategories] = useState<PlaceCategory[]>([]);
  const [places, setPlaces] = useState<FoundPlace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "empty" | "throttled">("idle");
  const [provider, setProvider] = useState<"google" | "osm">("osm");
  /** The row whose day picker is open, if any. One at a time: two open dropdowns in a 320px column
   *  is a menu, not a choice. */
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  /**
   * The day chosen for the place being added, while the second question is on screen.
   *
   * Two questions, two steps, rather than a grid of day x part-of-day: a seven-day trip would be
   * twenty-one buttons in a 384px column, and the two answers are not equally weighted — the day
   * is the decision, the part of the day is a default the traveler usually accepts.
   */
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  /**
   * Places already put into the plan this session, mapped to the day they went to.
   *
   * Keyed by the provider's place id and **never cleared** while the panel lives, which is the
   * whole point: the row has to keep saying "Added · Day 3" through a re-search, a category change
   * and a scroll away and back. Deriving it from the itinerary instead was the obvious alternative
   * and is wrong — a searched café and the `Stop` it becomes share only a name and a coordinate, so
   * matching them back up is a fuzzy join that would light up the wrong row as often as the right
   * one.
   */
  const [addedDays, setAddedDays] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  /** The anchored detail card's own node — the anchoring hook moves it, React only fills it. */
  const cardRef = useRef<HTMLElement | null>(null);
  /** The armed "pointer has left the pin" close, cancelled when the card itself is pointed at. */
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The camera position the current results describe. See the idle effect. */
  const lastSearchedRef = useRef<CameraState | null>(null);
  /**
   * Whether the entry morph is behind us, so a later layout change can take the slower spring.
   *
   * State rather than a ref, and not by preference: `transition` is read during render, and a ref
   * read during render is what `react-hooks/refs` refuses — correctly, since the compiler is free
   * to skip the render that would have observed the new value. One extra render when the morph
   * lands is the whole cost.
   *
   * Cleared where the morph is *started* — the press that opens the panel — rather than where it
   * ends. The panel element unmounts on close but this component does not, so the flag has to be
   * put back somewhere, and the open press is the one place that is true by construction and needs
   * no effect to observe it. The Satellite round trip skips it and is right to: the panel returns
   * with no partner element on screen to morph out of, so Framer runs no layout animation there and
   * a stale `true` governs nothing.
   */
  const [morphed, setMorphed] = useState(false);

  const shown = engine === "maplibre" && globeWanted;
  // Derived, not stored. Toggling to Satellite has to put the search away — the pins belong to a
  // surface that is no longer on screen — and deriving it means there is no second source of truth
  // to keep in step, and no `setState` inside an effect reacting to the engine changing.
  const isOpen = open && shown;

  /** There is a question to ask when something has been typed or a category pressed. Both the
   *  debounce and the empty state hang off this. */
  const hasQuery = query.trim().length > 0 || categories.length > 0;

  /**
   * What the list is actually showing.
   *
   * Clearing the box all the way back to empty has to put the panel back in its opening state, and
   * the obvious way to do that — an effect that empties `places` when the query goes blank — is a
   * cascading render to express something that is already derivable. Gating here instead means the
   * last answer is simply not rendered while there is no question, and typing the query back in
   * shows it again with no refetch.
   */
  // Memoised so the `[]` branch is a stable reference. Without it the pin effect below re-runs on
  // every render while the query is empty, pushing an identical empty collection at the renderer.
  const visiblePlaces = useMemo(() => (hasQuery ? places : []), [hasQuery, places]);


  // The shell watches this to stand the zoom / 2D / tilt stack down. Reported from an effect on the
  // *derived* value rather than from the button's onClick, so the Satellite toggle closing the
  // panel is reported too — that path never goes through a click here.
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // Unmounting with the controls still suspended would leave them dead for the rest of the session.
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);

  /** Push the current pins at the renderer. Selection and hover are both part of the pin, so this
   *  also runs when the traveler points at a row — the map is how the list answers "which one". */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive()) return;
    renderer.showSearchResults(
      isOpen
        ? visiblePlaces.map((p) => ({
            ...p,
            selected: p.id === selectedId,
            hovered: p.id === hoveredId,
            // Resolved from the result's own category, not from what was asked for — with several
            // categories selected the request no longer identifies which one a venue is.
            colorHex: searchColourFor(p.category),
          }))
        : []
    );
  }, [visiblePlaces, selectedId, hoveredId, isOpen, rendererRef, ready]);

  /**
   * Clicking a pin selects its place, exactly as clicking its row does.
   *
   * `selectedId` is the whole of it — no second piece of state for "which place the card is about".
   * The row already sets it, `runSearch` already clears it, and `showSearchResults` above already
   * enlarges whichever pin it names, so one value keeps the map, the list and the card agreeing
   * about which place is live, and a fresh search closes the card for free.
   *
   * No camera move. The traveller just clicked something they could see; flying the ground out from
   * under a click is the one thing that reliably reads as broken, and the card places itself
   * against whatever is on screen rather than needing the map arranged for it.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive() || !isOpen) return;
    return renderer.onSearchPinClick(setSelectedId);
  }, [rendererRef, ready, isOpen]);

  /**
   * **Pointing at a pin opens its card; leaving closes it.**
   *
   * That is the gesture — the click above is what a keyboard and a finger get, not the main way in.
   * It also means the card needs no dismiss control of its own: moving the pointer away *is* the
   * dismissal, which is why there is no ✕ on it.
   *
   * The grace period is the whole trick. Without it the card would vanish the instant the pointer
   * left the 13px halo, which is to say before it could ever reach the card to press anything. So
   * leaving a pin only *arms* a close, and the card cancels it by being pointed at — see
   * `onMouseEnter` where it is rendered. 260ms is long enough to cross the gap from a dot to the
   * card above it and short enough that a deliberate move away feels like a dismissal.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive() || !isOpen) return;
    const unsubscribe = renderer.onSearchPinHover((id) => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (id) setSelectedId(id);
      else closeTimerRef.current = setTimeout(() => setSelectedId(null), CARD_GRACE_MS);
    });
    return () => {
      unsubscribe();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [rendererRef, ready, isOpen]);

  /** The place the card is about, derived rather than stored — see the effect above. */
  const selectedPlace = useMemo(
    () => visiblePlaces.find((p) => p.id === selectedId) ?? null,
    [visiblePlaces, selectedId]
  );

  /**
   * Keep the card on its pin.
   *
   * The left edge it is given is the search panel's own right edge, so a card whose place sits
   * behind the list slides clear of it instead of hiding underneath — the panel stays put and the
   * card works around it, which is the one arrangement where you can read the card and keep
   * scanning the list at the same time.
   */
  useAnchoredToMap(
    cardRef,
    rendererRef,
    selectedPlace,
    ready,
    // 24px gutter (`left-6`) + the panel's 22rem, when it is on screen to be avoided.
    24 + 22 * 16 + 12
  );

  const runSearch = useCallback(async () => {
    const renderer = rendererRef.current;
    const centre = renderer?.cameraState();
    if (!centre || !renderer) return;
    // Where this answer is *about*, so the idle handler above can tell a real move from a nudge.
    // Written before the request rather than after it: two searches must not race into one another
    // because the first had not recorded itself yet.
    lastSearchedRef.current = centre;
    setState("searching");
    try {
      const params = new URLSearchParams({ lat: String(centre.lat), lng: String(centre.lng) });
      // The area, computed rather than assumed. The footprint is the ground the camera can
      // actually see; the stops inside it are joined into a hull and pushed out by a kilometre-
      // scale buffer, and *that* is what gets searched. `searchAreaFor` falls back to the bare
      // footprint when no stop is on screen, and the route falls back to a circle if the shape
      // fails to parse — so every layer below has a sensible answer for "no shape".
      const footprint = renderer.visibleFootprint();
      if (footprint.length >= 3) {
        const stops = (active?.itinerary.days ?? []).flatMap((d) =>
          d.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }))
        );
        const area = searchAreaFor(footprint, stops);
        if (area.length >= 3) params.set("area", encodePolygon(area));
      }
      if (query.trim()) params.set("q", query.trim());
      if (categories.length) params.set("category", categories.join(","));
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
      // Recorded on the answer rather than the keystroke, so the history is searches that actually
      // ran — not every prefix the debounce happened to catch on the way to one.
      if (query.trim() && data.available !== false) setHistory(rememberSearch(query));
    } catch {
      // Same fail-soft contract the route has: the traveler gets a state they can act on
      // (try again) rather than an error dialog.
      setPlaces([]);
      setState("throttled");
    }
    // `active` whole, not `active?.itinerary`. The React Compiler infers the dependency at the
    // coarsest property it sees read and refuses to keep a manual memo whose declared deps are
    // *narrower* than the inferred one — a real check, since a narrower dep is a callback that can
    // go stale. The itinerary is the only thing read either way.
  }, [query, categories, rendererRef, active]);

  /**
   * Debounced, only while open, and **only once there is something to search for**.
   *
   * The last clause is what keeps the empty state empty. With neither a query nor a category there
   * is no question to ask, and firing anyway is how the panel used to open straight into a list of
   * cafés nobody requested.
   */
  useEffect(() => {
    if (!isOpen || !hasQuery) return;
    const timer = setTimeout(runSearch, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isOpen, hasQuery, runSearch]);

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
   * - **`onCameraIdle`, not `onFrame`.** One request per gesture, after inertia settles, rather
   *   than one per frame of a drag.
   * - **A movement floor scaled to the camera's own range.** Nudging the map by a few pixels, or
   *   the framing correction that runs when a stop is added, must not spend a request. A quarter of
   *   the camera's distance to the ground is roughly "the view is meaningfully somewhere else" at
   *   any zoom, which a fixed metre threshold cannot be.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isAlive() || !isOpen || !hasQuery) return;
    return renderer.onCameraIdle(() => {
      const now = rendererRef.current?.cameraState();
      if (!now) return;
      const last = lastSearchedRef.current;
      if (last && metresBetween(last, now) < now.rangeM * MOVE_TO_RESEARCH) return;
      void runSearch();
    });
  }, [rendererRef, ready, isOpen, hasQuery, runSearch]);

  /** The trip's days as shapes, for the coordinate-only day suggestion. Memoised on the itinerary
   *  because it is recomputed for every row that opens a picker. */
  const dayShapes: DayShape[] = useMemo(
    () =>
      (active?.itinerary.days ?? []).map((day, i) => ({
        day: i,
        stops: day.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
      })),
    [active?.itinerary]
  );

  const highlights = useMemo(
    () => itineraryHighlights(active?.itinerary.days ?? []),
    [active?.itinerary]
  );

  if (!shown) return null;

  /** The same "closest to Day N" read the result rows carry, for whichever place the card is about.
   *  Plain arithmetic over one day's stops, so it needs no memo of its own. */
  const cardSuggestion = selectedPlace ? suggestDayForPlace(selectedPlace, dayShapes) : null;

  /**
   * Empty the text box, and only the text box.
   *
   * A pressed category deliberately survives: it is a separate statement of intent, and clearing
   * it here would make the small cancel quietly do the big cancel's job. Focus goes back to the
   * input because the reason anybody clears a search field is to type a different one.
   */
  const clearQuery = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  const close = () => {
    setOpen(false);
    setPickingFor(null);
    setPickedDay(null);
    setHoveredId(null);
    // The card is anchored to a pin this is about to stop drawing, so it goes too.
    setSelectedId(null);
  };

  const addPlace = (place: FoundPlace, dayIndex: number, slot: TimeOfDay) => {
    if (!active) return;
    const day = active.itinerary.days[dayIndex];
    // Computed here as well as inside `addPlaceToDay` so the toast can say the time it actually
    // got. Cheap (arithmetic over one day's stops) and deterministic, so the two cannot disagree.
    const plan = day ? planSlot(day.stops, slot) : null;
    active.onChange(addPlaceToDay(active.itinerary, dayIndex, place, slot));
    setAddedDays((current) => ({ ...current, [place.id]: dayIndex }));
    setPickingFor(null);
    setPickedDay(null);
    // The plan is usually scrolled elsewhere or behind the map when this happens, so the row's own
    // badge is not enough on its own — the toast is the part that says *where* it went. It now says
    // *when* too, because that is the answer the traveler just gave and the one they will look for.
    toast.show(
      `${place.name} added`,
      plan
        ? `Day ${dayIndex + 1} · ${plan.time}${plan.tight ? " · tight fit" : ""}`
        : `Day ${dayIndex + 1}`
    );
  };

  const runHistoryQuery = (entry: string) => {
    setQuery(entry);
    inputRef.current?.focus();
  };

  /** The opening state: what was searched before, and what the plan already holds. Only rendered
   *  when there is no question in flight, so it never competes with a result list. */
  const emptyState = (
    <div className="px-3 py-3">
      {history.length > 0 && (
        <>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
            <Clock className="h-3 w-3" /> Recent
          </p>
          <div className="mb-3 flex flex-col">
            {history.map((entry) => (
              <div key={entry} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => runHistoryQuery(entry)}
                  className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-sm text-foreground/90 transition-colors hover:bg-white/5"
                >
                  {entry}
                </button>
                <button
                  type="button"
                  onClick={() => setHistory(forgetSearch(entry))}
                  aria-label={`Remove "${entry}" from recent searches`}
                  className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {highlights.length > 0 && (
        <>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
            <Sparkles className="h-3 w-3" /> In your plan
          </p>
          <div className="flex flex-wrap gap-1.5">
            {highlights.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => runHistoryQuery(name)}
                className="max-w-full truncate rounded-full bg-white/10 px-2.5 py-1 text-xs text-muted transition-colors hover:bg-white/20 hover:text-foreground"
              >
                {name}
              </button>
            ))}
          </div>
        </>
      )}
      {history.length === 0 && highlights.length === 0 && (
        <p className="py-2 text-xs text-muted">
          Search for a place by name, or pick a category above to see what is near this view.
        </p>
      )}
    </div>
  );

  return (
    // Under the Map/Satellite toggle, sharing its gutter — the two are the same kind of control
    // (this is what the map can do) and belong in the same column.
    <div className="pointer-events-none fixed top-[calc(var(--nav-h)+4.5rem)] left-6 z-20 hidden sm:block print:hidden">
      {!isOpen ? (
        <motion.button
          layoutId={SEARCH_LAYOUT_ID}
          transition={SEARCH_SPRING}
          type="button"
          onClick={() => {
            // Read on the press rather than from an effect watching `isOpen`: another tab may have
            // searched since this one loaded, and this is the moment the list is about to be
            // looked at. Doing it here also keeps it out of an effect, which for a plain read of
            // an external store is a cascading render for no reason.
            setHistory(recentSearches());
            setMorphed(false);
            setOpen(true);
          }}
          aria-label="Search the map for places"
          title="Search the map"
          className="glass-control pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition-transform duration-200 ease-out active:scale-[0.92]"
        >
          {/* The icon is its own layout child so the morph scales the *container* and leaves the
              glyph its natural size — without this Framer stretches the SVG to the panel's
              proportions on the way up, which reads as the icon smearing. */}
          <motion.span layout="position" transition={SEARCH_SPRING}>
            <Search className="h-4.5 w-4.5" strokeWidth={2.2} />
          </motion.span>
        </motion.button>
      ) : (
        <motion.div
          layoutId={SEARCH_LAYOUT_ID}
          transition={morphed ? RESIZE_SPRING : SEARCH_SPRING}
          onLayoutAnimationComplete={() => setMorphed(true)}
          className="glass-control pointer-events-auto flex max-h-[min(70vh,640px)] w-[22rem] flex-col overflow-hidden rounded-2xl"
        >
          {/* **`layout="position"` is the scale correction, and without it everything in here is
              drawn stretched.** Framer animates a layout change with a transform, so while the
              panel travels from 640px to 322px it is a 322px box scaled to 1.37 on Y alone —
              measured, on the first frame — and every child inherits that. Pills become ovals, the
              search field grows a chin, text gains a third of its height and loses none of its
              width. Framer only counter-scales children that are projection nodes themselves,
              which is what this makes it: the wrapper keeps its true size and the `overflow-hidden`
              above simply closes down over it. Position rather than full `layout` because the
              wrapper's *size* is the thing being corrected — animating that too would re-introduce
              the scale one level down.

              The fade stays, and still earns its keep: on the way in the content is now crisp
              instead of squeezed, but it is crisp at full size inside a 44px circle, which without
              the fade is a panel's worth of type appearing through a keyhole. */}
          <motion.div
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              layout: morphed ? RESIZE_SPRING : SEARCH_SPRING,
              duration: 0.16,
              delay: 0.06,
            }}
            className="flex min-h-0 flex-col"
          >
          {/* The grabber. A sheet handle rather than a labelled button: it names itself by shape,
              costs no horizontal room in a row that now has to hold a growing field, and puts the
              dismiss at the panel's own edge rather than beside the text the ✕ acts on — which is
              what stops the two cancels from reading as a pair.

              A real `<button>` with an accessible name, not a decorative bar. The shape is a
              convention a sighted pointer user reads instantly and a screen reader cannot see at
              all, so the name is what makes it the same control for both. */}
          <button
            type="button"
            onClick={close}
            aria-label="Collapse search"
            title="Collapse"
            className="group flex w-full shrink-0 cursor-pointer items-center justify-center pt-2 pb-1.5 focus-visible:outline-none"
          >
            <span className="h-1 w-9 rounded-full bg-white/25 transition-colors group-hover:bg-white/45 group-focus-visible:bg-accent" />
          </button>
          {/* **Two cancels, because there are two things to cancel.** One ✕ doing both jobs made
              the cheaper one unreachable: a traveler who mistyped had to throw the whole panel away
              and reopen it to try again. The field owns a clear button that empties only the text;
              the grabber above dismisses the view.

              Both are platform search conventions rather than anyone's property — a clear button in
              a text input predates iOS by years and ships today in Android, Windows and every major
              browser's own search UI. What would be a problem is shipping Apple's *assets* (SF
              Symbols glyphs, the SF typeface), and none of those are here: the ✕ is lucide's and the
              grabber is a span with a border radius. */}
          <div className="flex items-center gap-2 border-b border-card-border px-3 pb-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1.5">
              <Search className="h-4 w-4 shrink-0 text-muted" />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                  // Escape empties a field that has something in it, and dismisses one that does
                  // not — the same two-step the rest of this row is built around, on the keyboard.
                  // Mapping it straight to dismiss would leave the keyboard with only the
                  // destructive half of a choice the pointer gets both halves of.
                  // Three rungs now, in the order a traveller means them: the card in front of
                  // everything, then the text, then the panel. An open card used to be skipped
                  // entirely — Escape would clear the search behind it, or shut the whole list,
                  // to dismiss a card sitting on top.
                  if (e.key === "Escape") {
                    if (selectedId) setSelectedId(null);
                    else if (query) clearQuery();
                    else close();
                  }
                }}
                placeholder="Search near this view…"
                aria-label="Search the map for places"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted/60 focus:outline-none"
              />
              {state === "searching" && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" aria-hidden="true" />
              )}
              {query && (
                <button
                  type="button"
                  onClick={clearQuery}
                  aria-label="Clear search text"
                  title="Clear"
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/25 text-foreground/80 transition-colors hover:bg-white/40 hover:text-foreground"
                >
                  <X className="h-2.5 w-2.5" strokeWidth={3.5} />
                </button>
              )}
            </div>
          </div>

          {/* **Wrapped, not scrolled.** This was a single `overflow-x-auto` row, and six chips do
              not fit a 320px panel — so two of them lived permanently off the right edge behind a
              hidden scrollbar, reachable on a trackpad only by a horizontal gesture and on a mouse
              only by shift-wheel. Nothing signalled they were there. Wrapping shows all six at
              once in two rows, which is both the fix and one fewer interaction to discover.

              **Each chip carries its pin colour as a swatch, and that swatch is the legend.** With
              several categories on the map at once the traveler has to be able to tell a café pin
              from a bar pin, and a separate key somewhere else in the panel would be a second thing
              to read and a second thing to keep in step. The control that turns a colour on is the
              only honest place to show what that colour is.

              **The swatch is where the pin colour stops, though.** A pressed chip used to be
              *filled* with it — a 6px dot's worth of map-native paint blown up to a 64px pill — and
              six of those wrapped across two rows inside a glass panel turned the filter row into
              the loudest thing on the screen, in a set of hues picked to survive aerial photography
              rather than to sit beside `--accent`. That is the rule `globals.css` states for the
              day palette ("never in a panel, chip or button") applied to the search palette, which
              is the same kind of colour for the same reason. So the chip's *state* is told in the
              interface palette — the accent fill every other multi-select in this app uses, see
              `InterestPicker` — and the category is told by the swatch, which now stays on through
              both states instead of disappearing exactly when its colour arrives on the map. The
              dark hairline around it is what keeps a green park dot legible on the green accent. */}
          <div className="flex flex-wrap gap-1.5 border-b border-card-border px-3 py-2">
            {PLACE_CATEGORIES.map((c) => {
              const on = categories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    setCategories((current) =>
                      current.includes(c) ? current.filter((x) => x !== c) : [...current, c]
                    )
                  }
                  aria-pressed={on}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    on
                      ? "bg-accent text-accent-foreground hover:bg-accent-hover"
                      : "bg-white/10 text-muted hover:bg-white/20 hover:text-foreground"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: SEARCH_COLOURS[c],
                      // Only on the fill, and in the chip's own ink rather than a fixed colour, so
                      // it follows the accent if that is ever re-tuned. On the glass the swatch
                      // needs no rim — the ground is dark and every one of these hues is vivid —
                      // and ringing it there only dulls the colour it exists to name.
                      boxShadow: on ? "0 0 0 1px currentColor" : undefined,
                    }}
                  />
                  {CATEGORY_LABELS[c]}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!hasQuery && state !== "searching" && emptyState}
            {hasQuery && state === "throttled" && (
              <p className="px-3 py-4 text-xs text-alert/75">
                Search is busy right now — the free places index rate-limits. Try again in a moment.
              </p>
            )}
            {hasQuery && state === "empty" && (
              <p className="px-3 py-4 text-xs text-muted">
                Nothing of that kind near this view. Pan somewhere else, or widen the search.
              </p>
            )}
            {visiblePlaces.map((place) => {
              const addedTo = addedDays[place.id];
              const isAdded = addedTo !== undefined;
              return (
                <div
                  key={place.id}
                  // Hover drives the map's highlight, so it is on the row rather than on the
                  // button inside it — the whole row is what the pointer is reading.
                  onMouseEnter={() => setHoveredId(place.id)}
                  onMouseLeave={() => setHoveredId((id) => (id === place.id ? null : id))}
                  className={`border-b border-white/5 px-3 py-2.5 transition-colors last:border-b-0 ${
                    selectedId === place.id ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(place.id);
                        // A bounded frame around the candidate rather than a dive onto it, so the
                        // answer to "is this near anything else I'm doing" is on screen. The
                        // renderer takes the panel's own width out of the box it fits, which is
                        // what keeps the result out from behind the itinerary.
                        flyToSearchResult(place.lat, place.lng);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        {/* The same colour its pin is wearing. Without it the map is the only place
                            the category is legible, and matching a row to a dot on the map means
                            reading the category name and recalling which chip carried that colour. */}
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: searchColourFor(place.category) }}
                        />
                        <span className="min-w-0 truncate text-sm text-foreground">{place.name}</span>
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {CATEGORY_LABELS[place.category]}
                        {place.rating ? ` · ${place.rating.toFixed(1)}★` : ""}
                        {place.address ? ` · ${place.address}` : ""}
                      </span>
                    </button>

                    {/* **A readout, not an action.** Adding happens in the card the row opens, and
                        only there — one place to choose a day means one place for that choice to be
                        wrong, and a list of fifteen rows each carrying a collapsed two-step picker
                        was a list that could open fifteen of them. What stays is the answer to "is
                        this already in the plan", which a scanner needs and cannot get elsewhere. */}
                    {active && isAdded && (
                      <span
                        className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-accent/20 px-2 py-1 text-[11px] font-medium text-accent"
                        title={`Already added to Day ${addedTo + 1}`}
                      >
                        <Check className="h-3 w-3" strokeWidth={3} />
                        Added · D{addedTo + 1}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Attribution, and an honest statement of which index answered. Both providers require
              it, and it is also the fastest way to tell whether a key is actually in play. */}
          <p className="shrink-0 border-t border-card-border px-3 py-1.5 text-[0.6875rem] text-white/40">
            {provider === "google" ? "Places by Google" : "Places by OpenStreetMap"}
          </p>
          </motion.div>
        </motion.div>
      )}

      {/* **A sibling of the panel, never a child of it.** That box is `overflow-hidden` and carries
          the framer `layoutId` projection, which writes a transform to it and counter-scales its
          children — a `position: fixed` card inside it would be clipped, squashed, *and* positioned
          against the panel rather than the viewport. Out here, the only ancestor is this container,
          which sets no transform, so `fixed` means what it says and nothing clips.

          Rendered on `selectedId` alone. There is no separate "card is open" state: the pin sets
          it, the row sets it, a fresh search clears it, and `showSearchResults` already enlarges
          whichever pin it names — so one value keeps the map, the list and the card agreeing about
          which place is live. */}
      {isOpen && selectedPlace && (
        <SearchPinCard
            cardRef={cardRef}
            place={selectedPlace}
            addedDay={addedDays[selectedPlace.id]}
            suggestionText={
              cardSuggestion && pickingFor !== selectedPlace.id
                ? `Closest to Day ${cardSuggestion.day + 1} — ${shortDistance(
                    cardSuggestion.distanceM
                  )} from its other stops`
                : undefined
            }
            onHoldOpen={() => {
              if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
            }}
            onRelease={() => {
              if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
              closeTimerRef.current = setTimeout(() => setSelectedId(null), CARD_GRACE_MS);
            }}
            onClose={() => setSelectedId(null)}
            action={
              active && (
                <AddToDayButton
                  name={selectedPlace.name}
                  expanded={pickingFor === selectedPlace.id}
                  onClick={() => {
                    setPickedDay(null);
                    setPickingFor((current) =>
                      current === selectedPlace.id ? null : selectedPlace.id
                    );
                  }}
                />
              )
            }
          >
            {active && pickingFor === selectedPlace.id && (
              <AddToDayPicker
                place={selectedPlace}
                itinerary={active.itinerary}
                suggestion={cardSuggestion}
                pickedDay={pickedDay}
                onPickDay={setPickedDay}
                onAdd={addPlace}
                className="mt-2"
              />
            )}
          </SearchPinCard>
      )}
    </div>
  );
}

/**
 * The second question: which part of the day.
 *
 * Three options, always all three, with the place's own default marked — `suggestTimeOfDay` reads
 * the place (a café is a morning thing, a bar often is not open before evening) and never the day,
 * because "when is this place good" and "when does this day have room" are different questions.
 * The second is `planSlot`'s, and its answer is shown on each row as the actual clock time the
 * stop would get. That is the part worth the extra render: "Afternoon" is a category, "2:30 PM"
 * is what will be in the plan, and a traveler comparing three options should be comparing the
 * consequences rather than the labels.
 *
 * A day too full for a clean gap is marked rather than hidden. All three stay pickable — the
 * traveler may well want the stop there anyway and will move something else — and "tight" is the
 * honest word for what will happen.
 */
/**
 * Two questions, asked one at a time: which day, then which part of it.
 *
 * Every option in both is pickable — each recommendation is a label on one row, never a filter over
 * the others.
 *
 * Extracted rather than left inline because there are now two places to add a place from: the
 * result row and the detail card anchored to its pin. The row's own note about a second half-editor
 * being "a second place for the same state to be wrong" applies at least as hard to the question
 * that *creates* the state, so both hosts ask it with this.
 */
function AddToDayPicker({
  place,
  itinerary,
  suggestion,
  pickedDay,
  onPickDay,
  onAdd,
  className = "",
}: {
  place: FoundPlace;
  itinerary: Itinerary;
  suggestion: { day: number; distanceM: number } | null;
  pickedDay: number | null;
  onPickDay: (day: number | null) => void;
  onAdd: (place: FoundPlace, dayIndex: number, slot: TimeOfDay) => void;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-white/10 bg-black/20 p-1 ${className}`}>
      {pickedDay === null ? (
        <>
          {suggestion && (
            <p className="px-1.5 pt-1 pb-1.5 text-[10px] text-muted">
              Closest to <span className="text-accent">Day {suggestion.day + 1}</span> —{" "}
              {shortDistance(suggestion.distanceM)} from its other stops
            </p>
          )}
          <div
            className="flex max-h-40 flex-col overflow-y-auto"
            {...devLabel("MapSearchPanel.DayPicker")}
          >
            {itinerary.days.map((day, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onPickDay(i)}
                className={`flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-white/10 ${
                  suggestion?.day === i ? "text-foreground" : "text-muted"
                }`}
              >
                <span className="truncate">
                  Day {i + 1}
                  <span className="ml-1.5 text-[10px] text-muted">
                    {day.stops.length} {day.stops.length === 1 ? "stop" : "stops"}
                  </span>
                </span>
                {suggestion?.day === i && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    <MapPin className="h-2.5 w-2.5" />
                    Suggested
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      ) : (
        <SlotPicker
          place={place}
          stops={itinerary.days[pickedDay]?.stops ?? []}
          dayNumber={pickedDay + 1}
          onBack={() => onPickDay(null)}
          onPick={(slot) => onAdd(place, pickedDay, slot)}
        />
      )}
    </div>
  );
}

function SlotPicker({
  place,
  stops,
  dayNumber,
  onBack,
  onPick,
}: {
  place: FoundPlace;
  stops: Stop[];
  dayNumber: number;
  onBack: () => void;
  onPick: (slot: TimeOfDay) => void;
}) {
  const suggested = suggestTimeOfDay(place);
  // One `planSlot` per option, recomputed only when the day or the place changes. Each is a walk
  // over one day's stops — cheaper than the render it informs.
  const options = useMemo(
    () => TIME_OF_DAY_ORDER.map((slot) => ({ slot, plan: planSlot(stops, slot) })),
    [stops]
  );

  return (
    <>
      <div className="flex items-center gap-1 px-0.5 pt-0.5 pb-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to the day list"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <p className="min-w-0 flex-1 truncate text-[10px] text-muted">
          Day {dayNumber} — when?
        </p>
      </div>
      <div className="flex flex-col" {...devLabel("MapSearchPanel.SlotPicker")}>
        {options.map(({ slot, plan }) => (
          <button
            key={slot}
            type="button"
            onClick={() => onPick(slot)}
            className={`flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-white/10 ${
              slot === suggested ? "text-foreground" : "text-muted"
            }`}
          >
            <span className="truncate">
              {slot}
              {/* The consequence, not the category — this is the time the stop will actually
                  carry. */}
              <span className="ml-1.5 text-[10px] tabular-nums text-muted">{plan.time}</span>
              {plan.tight && <span className="ml-1.5 text-[10px] text-amber-200/80">tight</span>}
            </span>
            {slot === suggested && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                <Clock className="h-2.5 w-2.5" />
                Suggested
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
