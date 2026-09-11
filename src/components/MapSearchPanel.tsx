"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, ChevronLeft, Clock, Loader2, MapPin, Plus, Search, Sparkles, X } from "lucide-react";
import { useMapCamera } from "@/lib/mapCamera";
import { addPlaceToDay, useActiveItinerary } from "@/lib/activeItinerary";
import { PLACE_CATEGORIES, type FoundPlace, type PlaceCategory } from "@/lib/placeSearch";
import { suggestDayForPlace, type DayShape } from "@/lib/dayFit";
import { planSlot, suggestTimeOfDay } from "@/lib/daySlotting";
import { TIME_OF_DAY_ORDER, type TimeOfDay } from "@/lib/timeOfDay";
import type { Stop } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";
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
const SEARCH_SPRING = { type: "spring", stiffness: 320, damping: 32 } as const;

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

  const runSearch = useCallback(async () => {
    const renderer = rendererRef.current;
    const centre = renderer?.cameraState();
    if (!centre || !renderer) return;
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
          transition={SEARCH_SPRING}
          className="glass-control pointer-events-auto flex max-h-[min(70vh,640px)] w-[22rem] flex-col overflow-hidden rounded-2xl"
        >
          {/* Everything inside fades in once the box has somewhere to be. Framer scales a layout
              child's box during the morph, so content that is fully opaque from frame one is
              content the traveler watches get squeezed out of a 44px circle. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16, delay: 0.06 }}
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
                  if (e.key === "Escape") {
                    if (query) clearQuery();
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

              **Each chip wears its own pin colour, and that is the legend.** With several
              categories on the map at once the traveler has to be able to tell a café pin from a
              bar pin, and a separate key somewhere else in the panel would be a second thing to
              read and a second thing to keep in step. The control that turns a colour on is the
              only honest place to show what that colour is. */}
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
                  style={
                    on
                      ? { backgroundColor: SEARCH_COLOURS[c], color: "#10151c" }
                      : { boxShadow: `inset 0 0 0 1px ${SEARCH_COLOURS[c]}66` }
                  }
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    on ? "" : "bg-white/5 text-muted hover:text-foreground"
                  }`}
                >
                  {/* The swatch is what an unselected chip has instead of a fill: the colour still
                      has to be legible before it is switched on, or picking a second category is a
                      guess about what will appear on the map. */}
                  {!on && (
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: SEARCH_COLOURS[c] }}
                    />
                  )}
                  {CATEGORY_LABELS[c]}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!hasQuery && state !== "searching" && emptyState}
            {hasQuery && state === "throttled" && (
              <p className="px-3 py-4 text-xs text-amber-200">
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
              const suggestion = suggestDayForPlace(place, dayShapes);
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

                    {active &&
                      (isAdded ? (
                        // Terminal, and not a button. The place is in the plan; the itinerary is
                        // where it gets moved or removed, and offering a second half-editor here
                        // would be a second place for the same state to be wrong.
                        <span
                          className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-accent/20 px-2 py-1 text-[11px] font-medium text-accent"
                          title={`Already added to Day ${addedTo + 1}`}
                        >
                          <Check className="h-3 w-3" strokeWidth={3} />
                          Added · D{addedTo + 1}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setPickingFor((current) => {
                              setPickedDay(null);
                              return current === place.id ? null : place.id;
                            })
                          }
                          aria-expanded={pickingFor === place.id}
                          aria-label={`Choose a day for ${place.name}`}
                          className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-white/20 hover:text-foreground"
                        >
                          <Plus className="h-3 w-3" />
                          Add
                        </button>
                      ))}
                  </div>

                  {/* Two questions, asked one at a time: which day, then which part of it. Every
                      option in both is pickable — each recommendation is a label on one row, never
                      a filter over the others. */}
                  {pickingFor === place.id && active && (
                    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-1">
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
                            {active.itinerary.days.map((day, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setPickedDay(i)}
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
                          stops={active.itinerary.days[pickedDay]?.stops ?? []}
                          dayNumber={pickedDay + 1}
                          onBack={() => setPickedDay(null)}
                          onPick={(slot) => addPlace(place, pickedDay, slot)}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Attribution, and an honest statement of which index answered. Both providers require
              it, and it is also the fastest way to tell whether a key is actually in play. */}
          <p className="shrink-0 border-t border-card-border px-3 py-1.5 text-[10px] text-white/40">
            {provider === "google" ? "Places by Google" : "Places by OpenStreetMap"}
          </p>
          </motion.div>
        </motion.div>
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
