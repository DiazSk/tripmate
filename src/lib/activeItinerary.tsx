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
import type { Itinerary, Stop } from "@/lib/types";
import { newStop } from "@/lib/itineraryEdits";

/**
 * The plan currently on screen, and how to add something to it — for surfaces that live *outside*
 * the itinerary panel and still need to change it.
 *
 * There is exactly one of those today: the map's search control, which is mounted in `AppShell`
 * beside the map chrome because it belongs to the map, and which needs to put a café somebody
 * found into the day they are reading. Threading `itinerary` and `onItineraryChange` from
 * `TripView`/`HomeView` down through `AppShell` to get there would mean a prop on the shell for
 * every page that has a plan, which is the wrong shape — the shell does not know what a trip is
 * and should not learn.
 *
 * Deliberately **not** part of `MapCameraContext`, even though the search control uses both.
 * That context is about a camera and is consumed by a per-frame projection loop; this one changes
 * only when a plan does. Merging them would re-render the marker layer's subscribers on every
 * itinerary edit.
 *
 * Absent by default. A page with no plan — `/profile`, `/trips`, the landing form — provides
 * nothing, `useActiveItinerary()` returns null, and the search control does not render an "add"
 * action it could not honour.
 */
export interface ActiveItinerary {
  itinerary: Itinerary;
  /** Commit an edited plan. Each host already has one of these; it saves, or defers saving, on its
   *  own terms — the search control does not need to know which. */
  onChange: (next: Itinerary) => void;
}

interface Publisher {
  value: ActiveItinerary | null;
  publish: (itinerary: Itinerary | null, onChange?: (next: Itinerary) => void) => void;
}

const ActiveItineraryContext = createContext<Publisher | null>(null);

/**
 * Mounted in `AppShell`, **above** every page — because the consumer is up there too.
 *
 * The first shape of this was a provider inside `TripView` wrapping the page's own tree, which
 * cannot work and failed exactly as it should have: `MapSearchPanel` is mounted by the shell,
 * beside the map chrome, so it is an *ancestor* of the page and saw nothing. Verified by the
 * search finding three places, drawing three pins, and offering no way to add any of them.
 *
 * So the direction is inverted, the way `useGlobeOnScreen` already inverts it for the globe: the
 * surface that knows publishes upward, and unmounting withdraws it.
 */
export function ActiveItineraryProvider({ children }: { children: ReactNode }) {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  /**
   * The host's commit function, in a ref rather than in state.
   *
   * It is redeclared on every render of the page that owns it — a plain function declaration in
   * `TripView` — so storing it in state would publish on every render, re-render this provider,
   * and re-render the page under it. A ref makes its identity irrelevant, which is the honest
   * description of what it is: a callback whose *behaviour* never changes.
   */
  const onChangeRef = useRef<((next: Itinerary) => void) | null>(null);

  const publish = useCallback((next: Itinerary | null, onChange?: (n: Itinerary) => void) => {
    onChangeRef.current = onChange ?? null;
    // Identity comparison, so republishing the same plan is free. Every edit path in this app
    // builds a new object, which is the property `ItineraryCard`'s own dirty check relies on.
    setItinerary((current) => (current === next ? current : next));
  }, []);

  const commit = useCallback((next: Itinerary) => onChangeRef.current?.(next), []);

  const value = useMemo<Publisher>(
    () => ({
      // `commit` unconditionally, never `onChangeRef.current` — a ref cannot be read during
      // render, and there is nothing to read: `usePublishItinerary` takes both together, so a
      // published plan always has a commit function behind it, and `commit` no-ops if it somehow
      // does not.
      value: itinerary ? { itinerary, onChange: commit } : null,
      publish,
    }),
    [itinerary, publish, commit]
  );

  return (
    <ActiveItineraryContext.Provider value={value}>{children}</ActiveItineraryContext.Provider>
  );
}

/**
 * Declare the plan this surface is showing, for as long as it is mounted.
 *
 * Mirrors `useGlobeOnScreen`: the page that knows says so, and leaving it withdraws the claim —
 * so navigating from a trip to `/profile` takes the "add to itinerary" action away with it rather
 * than leaving it pointed at a plan nobody is looking at.
 */
export function usePublishItinerary(
  itinerary: Itinerary | null,
  onChange: (next: Itinerary) => void
) {
  const ctx = useContext(ActiveItineraryContext);
  const publish = ctx?.publish;
  useEffect(() => {
    if (!publish) return;
    publish(itinerary, onChange);
    return () => publish(null);
    // `onChange` is deliberately not a dependency — see `onChangeRef`. Including it would re-run
    // this on every render of the host, since it is a function declaration rather than a callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itinerary, publish]);
}

/** The plan on screen, or null where there is none. */
export function useActiveItinerary(): ActiveItinerary | null {
  return useContext(ActiveItineraryContext)?.value ?? null;
}

/**
 * Put a found place into a day, as a stop.
 *
 * Appended rather than slotted by clock time, and that is the honest choice: a searched place has
 * no time of its own, so there is nothing to sort it on, and guessing one would put a claim in the
 * plan that nobody made. It lands at the end of the day where the traveler can see it and give it
 * a time in the editor.
 *
 * Everything else comes from `newStop`'s defaults for the same reason — no cost, no note, no
 * duration. The name and the coordinates are what a search actually knows; the rest is the
 * traveler's to fill in.
 */
export function addPlaceToDay(
  itinerary: Itinerary,
  dayIndex: number,
  place: { name: string; lat: number; lng: number; category?: string }
): Itinerary {
  const day = itinerary.days[dayIndex];
  if (!day) return itinerary;
  const stop: Stop = {
    ...newStop(place.name, place.lat, place.lng),
    category: stopCategoryFor(place.category),
  };
  return {
    ...itinerary,
    days: itinerary.days.map((d, i) => (i === dayIndex ? { ...d, stops: [...d.stops, stop] } : d)),
  };
}

/**
 * A search category to one of the four a `Stop` has.
 *
 * The four exist to drive the day's spend tiles (`daySpendByCategory`), so this is really asking
 * "what kind of money is this" — a café and a restaurant are both `food`, a museum charges
 * `entry`, and a park costs nothing, which is `other` rather than a fifth category nobody totals.
 */
function stopCategoryFor(category: string | undefined): Stop["category"] {
  if (category === "cafe" || category === "restaurant" || category === "bar") return "food";
  if (category === "museum") return "entry";
  return "other";
}
