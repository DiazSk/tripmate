"use client";

import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { useRouter } from "next/navigation";
import ErrorDialog from "@/components/ErrorDialog";
import { useToast } from "@/lib/toast";
import { failureFromResponse, failureFromThrown, formatResumeTime, holdFromFailure, isAbort, type Failure } from "@/lib/failure";
import { fitMessage } from "@/components/AnchorReceipt";
import { useStoryControls } from "@/lib/storyMode";
import FocusEditMode from "@/components/FocusEditMode";
import SplitEditor from "@/components/SplitEditor";
import { useFocusEdit } from "@/lib/useFocusEdit";
import { usePublishItinerary } from "@/lib/activeItinerary";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import TripBoard, { BoardInsets, type BoardShape, type Note } from "@/components/polar/trip/TripBoard";
import TripSpotlight from "@/components/polar/trip/TripSpotlight";
import { Itinerary, Stop, Trip } from "@/lib/types";
import { useTripCamera } from "@/lib/useTripCamera";
import { useGlobeOnScreen } from "@/lib/mapCamera";
import { DEFAULT_MAP_ENGINE, MAPLIBRE_STYLE_URL } from "@/lib/mapEngine";
import { dayPlanned, daySpend, findStopLocation, upcomingStopsAfter } from "@/lib/itinerary";
import { devLabel } from "@/lib/devInspector";
import { changedDayNumbers, clearUnseenDay, markUnseenDays } from "@/lib/unseenChanges";
import { onDraftRevision } from "@/lib/draftRevision";
import { track } from "@/lib/analytics/client";
import { attemptFor, notePath, previousPath, tripSource } from "@/lib/analytics/flow";
import { todayInZone, tripPhase } from "@/lib/analytics/tripPhase";

import "@/components/polar/PolarLanding.css";
import "@/components/polar/trip/TripBoard.css";
import "@/components/polar/trip/TripDrawer.css";
import "@/components/polar/trip/TripSpotlight.css";

/** Who made an edit, for the analytics event the server fires; the server treats anything else as a hand edit. */
type EditBy = "chat" | "hand" | "search";

/** Thrown by this page's requests so the catch knows what failed, never a sentence to print. */
class RequestError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.kind);
  }
}
const failureOf = (e: unknown): Failure => (e instanceof RequestError ? e.failure : failureFromThrown(e));

/** Fetch that throws a `RequestError` for a refused request or a failed connection. */
async function request(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw isAbort(e) ? e : new RequestError(failureFromThrown(e));
  }
  if (!res.ok) throw new RequestError(await failureFromResponse(res, "edit"));
  return res;
}

/** The first stop the server's itinerary check refuses: one with no place on the map. */
function stopWithoutPlace(plan: Itinerary): { stop: Stop; day: number } | null {
  for (const [d, day] of plan.days.entries()) {
    const stop = day.stops.find((x) => !Number.isFinite(x.lat) || !Number.isFinite(x.lng));
    if (stop) return { stop, day: d + 1 };
  }
  return null;
}

/** Copy rows T-09..T-14: a rebalance that didn't land. The plan on screen is the one from before. */
function rebalanceNote(f: Failure, span: string): Note {
  switch (f.kind) {
    case "offline":
      return { text: "You’re offline, so the rest of the trip wasn’t rebalanced. Your plan is unchanged. Press Rebalance when you’re back online." };
    case "timeout":
      return { text: `Rebalancing ${span} took longer than TripMate allows, so it stopped. Your plan is unchanged. Press Rebalance to try again.` };
    case "rate_limited":
      return {
        text: "You’ve asked TripMate for 6 changes in the last 10 minutes, which is the limit. Your plan is unchanged. You can rebalance in {mm:ss}.",
        hold: { bucket: f.bucket, resolved: "You can ask for changes again." },
      };
    case "daily_cap":
      return {
        text: `Rebalancing is paused for everyone until ${formatResumeTime(f.resumesAt)}. TripMate has reached its limit for the day; it isn’t anything you did. You can still move stops and change costs by hand.`,
      };
    // The server wrote this sentence (copy rows SV-14..SV-17, SV-20); shown as it is, with nothing to retry.
    case "refused":
      return { text: f.message };
    case "invalid":
      return { text: "TripMate couldn’t read the days left to rebalance. Reload the trip and press Rebalance again." };
    default:
      return { text: `TripMate hit a problem rebalancing ${span}. Your plan is unchanged. Press Rebalance to try again.` };
  }
}

type ActualCostTarget = "lodging" | number;

/** When the itinerary has stops, TripBoard's own effect frames the day's route — so the
 *  destination flight must be suppressed or it lands second and clobbers that framing. */
const hasStops = (itinerary?: Itinerary | null) =>
  !!itinerary?.days.some((d) => d.stops.length > 0);

/** The `costNote` key of a stop's actual amount. */
function stopCostKey(itinerary: Itinerary, stop: Stop): string | null {
  const loc = findStopLocation(itinerary, stop);
  return loc ? `${loc.dayIndex}:${loc.stopIndex}` : null;
}


export default function TripView({
  id,
  initialTrip,
}: {
  id: string;
  /** Read server-side by this route's page component. Null only for `/trip/preview`, whose
   *  fixture is not in the database and is loaded below instead. */
  initialTrip: Trip | null;
}) {
  // The map's base style, requested from the HTML instead of at the end of the chain that reaches
  // it (hydration, then the dynamic MapLibre chunk, then `buildStyle`'s fetch). Measured on throttled
  // mobile, the map's first drawn stop arrives ~0.6s sooner. Gated on the build default because
  // the server cannot see a visitor's stored engine choice; a Cesium session wastes ~6KB.
  // `crossOrigin: "anonymous"` matches `buildStyle`'s plain `fetch()`, so the preload is reused.
  if (DEFAULT_MAP_ENGINE === "maplibre") {
    preload(MAPLIBRE_STYLE_URL, { as: "fetch", crossOrigin: "anonymous" });
  }
  const [trip, setTrip] = useState<Trip | null>(initialTrip);
  const [itinerary, setItinerary] = useState<Itinerary | null>(initialTrip?.itinerary ?? null);
  const router = useRouter();
  const { showError } = useToast();
  /** Copy rows T-06/T-07, beside Keep this trip. */
  const [keepNote, setKeepNote] = useState("");
  /** Copy rows T-09..T-14, in the overspend strip. */
  const [rebalanceFailure, setRebalanceFailure] = useState<Note | null>(null);
  /** Copy row T-05, under the amount that didn't save. `key` is `${dayIndex}:${stopIndex | "lodging"}`. */
  const [costNote, setCostNote] = useState<{ key: string; text: string } | null>(null);
  /** Copy row T-04: a save found the row gone, so the plan on screen is the only copy. */
  const [tripGone, setTripGone] = useState(false);
  const [dismissedDays, setDismissedDays] = useState<Set<number>>(new Set());
  const [rebalancingDay, setRebalancingDay] = useState<number | null>(null);
  // Owned here, not inside ItineraryCard: opening a stop's detail unmounts the card, so local
  // state there would reset the view to Day 1 on the way back.
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  /** The board shut to its ticket: the map then shows the whole trip, each day in its colour. The
   *  board opens on arrival, because it sits along the foot and leaves the map above it clear. */
  const [planShut, setPlanShut] = useState(false);
  /** The full editor, open as the right-hand drawer. */
  const [editOpen, setEditOpen] = useState(false);
  /** The map search open across the top. The board steps aside while it is, so the map between the
   *  two is the results' rather than the plan's. */
  const [searchOpen, setSearchOpen] = useState(false);
  // Story mode, for the capsule's Play button. Read from context rather than owned here — there
  // is one film at a time and it belongs to the app (`storyMode.tsx`), so this and the card's own
  // Play button are the same control reached from two places.
  const story = useStoryControls();
  const { prefetch: warmStory } = story;
  /** 0-based days a chat turn changed while the traveler was reading a different one. Owned here
   *  rather than in the card because the chat that produces them lives beside it, not inside it. */
  const [unseenChangedDays, setUnseenChangedDays] = useState<number[]>([]);
  // Step 7 edit session. Unlike the pre-save view, every accepted edit here is persisted.
  const focus = useFocusEdit(itinerary);
  // Publishes the plan to surfaces mounted outside this tree. The map's own search now lives on this
  // page (`TripSpotlight`, handed `handleRearrange` directly); this still feeds the search's area,
  // which hugs the trip's stops. `handleRearrange` is the commit path the board's drag-and-drop uses.
  usePublishItinerary(itinerary, (next) => handleRearrange(next, undefined, "search"));
  const [savingFocus, setSavingFocus] = useState(false);
  const [keeping, setKeeping] = useState(false);

  const {
    flyToDestinationByName,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  } = useTripCamera(trip?.destination ?? "", trip?.id);

  // While a film plays, the player bar's "Open this stop" shows the stop in the drawer, leaving the
  // film's camera where the beat put it.
  const { setStopOpener } = story;
  useEffect(() => {
    setStopOpener((stop) => selectStop(stop, { stayPut: true }));
    return () => setStopOpener(null);
  }, [setStopOpener, selectStop]);

  // This route is the globe, for its whole life. `not-found.tsx` and `/trip/latest`'s empty-DB
  // card are separate components that never mount this one — which is exactly why the gate is a
  // mounted-component declaration rather than a `/trip/` path prefix.
  useGlobeOnScreen(true);

  // The trip itself already arrived as a prop; this effect only has to move the camera. The
  // `/api/trips/[id]` fetch that used to live here was a second read of a row the server had
  // just read to render this very component.
  useEffect(() => {
    if (id === "preview") {
      // Kept out of this route's client bundle: the fixture lives in its own module,
      // loaded with a dynamic import so real trips don't pay for it. It is also the one
      // trip with no database row, which is why it cannot arrive as a prop.
      import("@/lib/previewTrip").then(({ PREVIEW_TRIP }) => {
        setTrip(PREVIEW_TRIP);
        setItinerary(PREVIEW_TRIP.itinerary);
        flyToDestinationByName(PREVIEW_TRIP.destination, !hasStops(PREVIEW_TRIP.itinerary));
      });
      return;
    }
    if (initialTrip) {
      flyToDestinationByName(initialTrip.destination, !hasStops(initialTrip.itinerary));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Once per mount of a real trip page, with where it was opened from and whether it is ahead of,
  // under way or behind the traveller. The deps are the id alone: a keep or an edit swaps `trip`
  // and must not count as another visit.
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    // The ref survives development's simulated remount, which would otherwise count the visit twice.
    if (!initialTrip || id === "preview" || openedRef.current === id) return;
    openedRef.current = id;
    notePath(location.pathname);
    let referrer: string | null = null;
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.origin === location.origin) referrer = ref.pathname;
    } catch {
      // An unparseable referrer is a link.
    }
    const { startDate, endDate, timezone } = initialTrip;
    track("trip_opened", {
      source: tripSource(previousPath(), referrer),
      phase: startDate && endDate ? tripPhase(startDate, endDate, todayInZone(timezone)) : null,
      offline: navigator.onLine === false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /**
   * Warm the narration for the day on screen, so pressing Play starts a film instead of a wait.
   * There is no half-written plan here, only a trip that may still be loading (the `/preview`
   * fixture arrives from the dynamic import above).
   *
   * One day, not all of them: `MAX_TRIP_DAYS` is 30 and the CLI transport spawns a subprocess per
   * call, so warming a whole trip would be half an hour of serialised Sonnet for films nobody has
   * asked for. The dependency is the destructured `prefetch`, not `story`: the controls object
   * changes identity when a film starts, pauses and ends, and depending on all of it would re-arm
   * the warm mid-playback.
   *
   * `trip.id` is passed as-is, `"preview"` included — `/api/trip-story` already filters that, so
   * one place decides what a cacheable trip is. The dwell is in `story.prefetch`.
   */
  useEffect(() => {
    if (!trip || !itinerary) return;
    // Clamped the way `ItineraryCard` clamps it: a chat turn that removes days leaves
    // `activeDayIndex` past the end for a render, and an unclamped warm fetches a key no Play
    // button will ever ask for.
    const dayIndex = Math.min(activeDayIndex, itinerary.days.length - 1);
    if (!itinerary.days[dayIndex]?.stops.length) return;
    warmStory({ itinerary, dayIndex, destination: trip.destination, tripId: trip.id });
  }, [trip, itinerary, activeDayIndex, warmStory]);

  /** Set by the first write from this page: from then on a late critique revision is older than
   *  what the traveller has, and is dropped (see the effect below). */
  const editedRef = useRef(false);
  /** The last plan sent, so Try again saves what is on screen now: each save sends the whole plan. */
  const latestPlanRef = useRef<Itinerary | null>(null);

  async function persist(updated: Itinerary, by: EditBy = "hand") {
    if (id === "preview") return;
    editedRef.current = true;
    latestPlanRef.current = updated;
    const res = await request(`/api/trips/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Edit-By": by },
      body: JSON.stringify({ itinerary: updated }),
    });
    // The whole plan just saved, so an amount that hadn't now has.
    setCostNote(null);

    // An edit can now change the trip's LENGTH (the chat can add or remove days), which moves the
    // end date. The route recomputes it from the saved itinerary, so take its answer rather than
    // deriving a second one here — otherwise the header keeps showing the old date range until a
    // reload.
    const saved = await res.json().catch(() => null);
    if (saved?.endDate) {
      setTrip((prev) => (prev && prev.endDate !== saved.endDate ? { ...prev, endDate: saved.endDate } : prev));
    }
  }

  /**
   * A critique revision for a plan that has just opened here, still being checked when it did.
   *
   * The server has already written it to this row, unless the row had been edited first
   * (`applyRevisionIfUnedited`), and `announceDraftRevision` is how the stream that carried it says
   * so. The row is re-read rather than the stream's days trusted, because the row is what holds:
   * an edit made in another tab, or one that beat the revision there, is what it shows. The days it
   * differs on from the plan on screen get the dots a chat turn leaves. A write from this page since
   * it opened outranks it, since that write may still be on its way and is the later intent.
   */
  useEffect(
    () =>
      onDraftRevision(id, () => {
        if (editedRef.current || !itinerary) return;
        fetch(`/api/trips/${id}`)
          .then((r) => (r.ok ? (r.json() as Promise<Trip>) : null))
          .then((row) => {
            if (!row?.itinerary || editedRef.current) return;
            const changed = changedDayNumbers(itinerary.days, row.itinerary.days);
            setTrip(row);
            setItinerary(row.itinerary);
            if (changed.length) setUnseenChangedDays((prev) => markUnseenDays(changed, activeDayIndex, prev));
          })
          .catch((e) => console.error("[trip] revised plan re-read failed", e));
      }),
    // Re-subscribed as these change, so the handler always compares against the plan on screen.
    // Safe: the mailbox holds a revision while nobody is subscribed.
    [id, itinerary, activeDayIndex]
  );

  /**
   * Promotes the draft this page is showing to a kept trip.
   *
   * A draft opens here as a fully working trip — the chat, the drag board, the cost inputs and
   * `persist` above all key off the row, not off its status — so the only thing missing was a way
   * to say "keep this" from the page the traveler actually lands on when they reopen a draft.
   * Sends the status alone. Every edit on this page is already persisted as it is made, so the row
   * holds the plan; sending this page's copy as well could write the old plan over a critique
   * revision that landed on the row a moment before this page heard about it.
   */
  /**
   * Saves the plan and says what didn't save if it fails (copy rows T-01..T-04, T-15). `what` is the
   * copy table's `{whatDidntSave}`. Nothing is reverted: the plan stays on screen, and Try again sends
   * whatever is on screen by then.
   */
  function save(plan: Itinerary, what: string, by: EditBy = "hand"): Promise<void> {
    return persist(plan, by).catch((e) => {
      if (isAbort(e)) return;
      const f = failureOf(e);
      if (f.kind === "not_found") return setTripGone(true);
      const bad = f.kind === "invalid" ? stopWithoutPlace(plan) : null;
      if (bad) {
        showError({
          title: `${what} didn’t save: ${bad.stop.name} on day ${bad.day} has no place on the map.`,
          detail: "Remove or replace that stop and it will save.",
        });
        return;
      }
      const again = { label: "Try again", onClick: () => save(latestPlanRef.current ?? plan, what, by) };
      if (f.kind === "offline") {
        // Mid-sentence, so "Your new stop order" reads "your new stop order"; a place name keeps its capital.
        const inline = what.replace(/^(Your|The) /, (m) => m.toLowerCase());
        // "Your edits" and "The rebalanced days" are plural.
        const isnt = /^(Your edits|The rebalanced days)/.test(what) ? "aren’t" : "isn’t";
        showError({ title: `You’re offline, so ${inline} ${isnt} saved.`, detail: "It’s still on screen; press Try again once you’re back online.", action: again });
      } else {
        showError({ title: `${what} didn’t save: TripMate’s server had a problem.`, detail: "It’s still on screen.", action: again });
      }
    });
  }

  /** An actual amount: its failure is written under that field (T-05), not raised as a toast. */
  function saveCost(plan: Itinerary, key: string) {
    persist(plan).catch((e) => {
      if (isAbort(e)) return;
      const f = failureOf(e);
      if (f.kind === "not_found") return setTripGone(true);
      setCostNote({ key, text: `Not saved. ${f.kind === "offline" ? "You’re offline." : "The server had a problem."}` });
    });
  }
  const retryCost = () => {
    if (costNote && latestPlanRef.current) saveCost(latestPlanRef.current, costNote.key);
  };

  /**
   * T-04's safe choice: the on-screen plan as a new draft, then this page continues on it. Guarded,
   * because Esc, a backdrop click and the button all choose it and only one trip should come of it.
   */
  const savingNewRef = useRef(false);
  // Its failure is shown inside the dialog (T-04a): a toast would sit under the modal, which is inert.
  const [savingNew, setSavingNew] = useState(false);
  const [newTripNote, setNewTripNote] = useState("");
  async function saveAsNewTrip() {
    const plan = latestPlanRef.current ?? itinerary;
    if (savingNewRef.current || !trip || !plan) return;
    savingNewRef.current = true;
    setSavingNew(true);
    setNewTripNote("");
    try {
      const res = await request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: trip.destination,
          // From the plan, which a chat edit can lengthen, rather than from the row that is gone.
          startDate: plan.days[0]?.date ?? trip.startDate,
          endDate: plan.days.at(-1)?.date ?? trip.endDate,
          budget: trip.budget,
          itinerary: plan,
          userAnswers: trip.userAnswers ?? undefined,
          // As it was: a kept trip stays kept, and the chat resumes where it left off.
          chatSessionId: trip.chatSessionId ?? undefined,
          status: trip.status ?? "saved",
        }),
      });
      const { id: next } = (await res.json()) as { id: string };
      // `TripPage` keys this view by id, so the new trip mounts fresh from its own row.
      router.replace(`/trip/${next}`);
    } catch (e) {
      savingNewRef.current = false;
      setSavingNew(false);
      if (isAbort(e)) return;
      setNewTripNote(
        failureOf(e).kind === "offline"
          ? "You’re offline, so this trip isn’t saved. Press Save as a new trip once you’re back online."
          : "This trip didn’t save: TripMate’s server had a problem. Press Save as a new trip to try again."
      );
    }
  }

  async function keepTrip() {
    if (!trip || !itinerary) return;
    setKeeping(true);
    setKeepNote("");
    try {
      await request(`/api/trips/${id}`, {
        method: "PATCH",
        // The attempt that wrote this plan, when this tab is the one that wrote it.
        headers: { "Content-Type": "application/json", ...(attemptFor(id) ? { "X-Attempt-Id": attemptFor(id) } : {}) },
        // Status only, so Keep never writes this page's copy over a revision that landed after it
        // loaded. The one exception is a page that edited: its row already differs from the plan, so
        // no revision can land on it, and re-sending recovers an edit whose own save had failed.
        body: JSON.stringify(editedRef.current ? { itinerary, status: "saved" } : { status: "saved" }),
      });
      // Local, not a reload: the row is unchanged apart from the one field, and re-fetching the
      // whole trip would reset the panel, the active day and the camera the traveler set.
      setTrip((prev) => (prev ? { ...prev, status: "saved" } : prev));
    } catch (e) {
      if (isAbort(e)) return;
      const f = failureOf(e);
      if (f.kind === "not_found") setTripGone(true);
      else
        setKeepNote(
          f.kind === "offline"
            ? "You’re offline, so this trip wasn’t kept. It’s still a draft. Press Keep this trip once you’re back online."
            : "TripMate couldn’t keep this trip: its server had a problem. It’s still a draft. Press Keep this trip to try again."
        );
    } finally {
      setKeeping(false);
    }
  }

  function handleActualCostChange(
    dayIndex: number,
    target: ActualCostTarget,
    value: number | undefined
  ) {
    if (!itinerary) return;
    const updated: Itinerary = structuredClone(itinerary);
    const day = updated.days[dayIndex];
    if (target === "lodging") {
      if (day.lodging) day.lodging.actualCost = value;
    } else {
      day.stops[target].actualCost = value;
    }
    setItinerary(updated);
    saveCost(updated, `${dayIndex}:${target}`);
    setDismissedDays((prev) => {
      const next = new Set(prev);
      next.delete(dayIndex);
      return next;
    });
  }

  /** A hand-rearranged itinerary from the card's drag-and-drop. `moveStop` has already re-timed
   *  every day it touched, so this only has to commit it — and it saves immediately rather than
   *  waiting for a Save button, matching how the actual-cost inputs on this page already behave. */
  function handleRearrange(next: Itinerary, what = "Your new stop order", by: EditBy = "hand") {
    setItinerary(next);
    save(next, what, by);
  }

  function handleStopActualCostChange(value: number | undefined) {
    if (!itinerary || !selectedStop) return;
    const loc = findStopLocation(itinerary, selectedStop);
    if (!loc) return;
    handleActualCostChange(loc.dayIndex, loc.stopIndex, value);
  }

  async function handleRebalance(dayIndex: number) {
    if (!itinerary || !trip) return;
    setRebalancingDay(dayIndex);
    setRebalanceFailure(null);
    const fromDay = dayIndex + 2;
    const lastDay = itinerary.days.length;
    // One day left reads "day 9", not "days 9 to 9".
    const span = fromDay === lastDay ? `day ${fromDay}` : `days ${fromDay} to ${lastDay}`;
    try {
      const spentThroughDay = itinerary.days
        .slice(0, dayIndex + 1)
        .reduce((sum, day) => sum + daySpend(day), 0);
      const remainingBudget = Math.max(trip.budget - spentThroughDay, 0);
      const remainingDays = itinerary.days.slice(dayIndex + 1);

      if (remainingDays.length === 0) {
        setDismissedDays((prev) => new Set(prev).add(dayIndex));
        return;
      }

      const res = await request("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rebalance: true,
          destination: trip.destination,
          tier: itinerary.tier,
          remainingDays,
          remainingBudget,
          tripId: trip.id,
        }),
      });
      const data = await res.json();

      const updated: Itinerary = {
        ...itinerary,
        days: [...itinerary.days.slice(0, dayIndex + 1), ...data.days],
      };
      setItinerary(updated);
      setDismissedDays((prev) => new Set(prev).add(dayIndex));
      // T-15: the new days are on screen either way, so a failed save says so rather than "unchanged".
      save(updated, `The rebalanced ${span}`);
    } catch (e) {
      if (isAbort(e)) return;
      const f = failureOf(e);
      holdFromFailure(f);
      setRebalanceFailure(rebalanceNote(f, span));
    } finally {
      setRebalancingDay(null);
    }
  }

  const overspendDayIndex = itinerary
    ? itinerary.days.findIndex((day, i) => !dismissedDays.has(i) && daySpend(day) > dayPlanned(day))
    : -1;

  /**
   * One drawer at a time on the right, and the order is the order of intent: a refine in progress
   * outranks the editor, and either outranks a stop's detail (a marker clicked mid-edit should not
   * pull the chat away).
   */
  const drawer: "refine" | "edit" | "detail" | null =
    focus.target && focus.draft ? "refine" : editOpen ? "edit" : selectedStop ? "detail" : null;
  const spotlight = searchOpen && !story.active;
  const shape: BoardShape = story.active || spotlight ? "hidden" : drawer ? "strip" : planShut ? "ticket" : "board";

  async function saveRefine() {
    const target = focus.target;
    const committed = focus.save();
    if (!committed) return;
    setSavingFocus(true);
    setItinerary(committed);
    // The refine drawer is the chat and the element edit, so what it commits was asked of the model.
    await save(committed, target?.scope === "day" ? `Your edits to day ${target.dayIndex + 1}` : "Your edits to the trip", "chat");
    setSavingFocus(false);
  }

  return (
    <main className={`trip-page${drawer ? " has-drawer" : ""}`} {...devLabel("TripPage")}>
      {!trip && <p className="tm trip-loading">Loading…</p>}
      <BoardInsets shape={shape} drawer={drawer} spotlight={spotlight} />

      {/* T-04 / T-08. Inert while closed: `open` drives showModal(). */}
      <ErrorDialog
        open={tripGone}
        title="This trip can’t be saved any more."
        why="It’s no longer in your memories; it may have been deleted in another tab or on another device. The plan on screen is the only copy."
        now="Save it as a new trip to keep it."
        primary={{ label: "Save as a new trip", onClick: saveAsNewTrip }}
        secondary={{ label: "Leave it", onClick: () => { setNewTripNote(""); setTripGone(false); } }}
        pending={savingNew}
        pendingLabel="Saving…"
        detail={newTripNote || undefined}
      />

      {trip && itinerary && (
        <TripBoard
          trip={trip}
          itinerary={itinerary}
          dayIndex={activeDayIndex}
          onDayChange={(next) => {
            setActiveDayIndex(next);
            // Looking at the day is what marks it read.
            setUnseenChangedDays((prev) => clearUnseenDay(prev, next));
          }}
          shape={shape}
          unseenChangedDays={unseenChangedDays}
          drawerOpen={!!drawer}
          onSelectStop={selectStop}
          // One chat surface with day navigation, starting on the day it was opened from.
          onRefine={(dayIndex) => {
            closeDetail();
            setEditOpen(false);
            focus.open(dayIndex, "trip");
          }}
          onEdit={() => {
            closeDetail();
            setEditOpen(true);
          }}
          onFitAnchor={(name) => focus.open(activeDayIndex, "trip", fitMessage(name))}
          onShut={() => setPlanShut(true)}
          onOpen={() => setPlanShut(false)}
          onKeep={keepTrip}
          keeping={keeping}
          keepNote={keepNote}
          costNote={costNote}
          onRetryCost={retryCost}
          // Re-read the row rather than toggling a local copy of `shared`, so the control cannot
          // end up disagreeing with the database after a failed request.
          onShareChange={() => {
            fetch(`/api/trips/${id}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((next) => next && setTrip(next))
              .catch(() => {});
          }}
          onLodgingActualCost={(dayIndex, value) => handleActualCostChange(dayIndex, "lodging", value)}
          overspend={
            overspendDayIndex !== -1 && itinerary
              ? {
                  dayIndex: overspendDayIndex,
                  amount: daySpend(itinerary.days[overspendDayIndex]) - dayPlanned(itinerary.days[overspendDayIndex]),
                  rebalancing: rebalancingDay === overspendDayIndex,
                  onRebalance: () => handleRebalance(overspendDayIndex),
                  onDismiss: () => {
                    setRebalanceFailure(null);
                    setDismissedDays((prev) => new Set(prev).add(overspendDayIndex));
                  },
                  note: rebalanceFailure,
                }
              : null
          }
        />
      )}

      {trip && itinerary && !story.active && (
        <TripSpotlight
          itinerary={itinerary}
          dayIndex={activeDayIndex}
          onDayChange={setActiveDayIndex}
          open={searchOpen}
          onOpenChange={(next) => {
            // One thing on the right at a time: opening the search puts the drawers away.
            // `stayPut`: the search is about the view on screen, so opening it must not move it.
            if (next) {
              if (selectedStop) closeDetail({ stayPut: true });
              setEditOpen(false);
            }
            setSearchOpen(next);
          }}
          onChange={(next, what) => handleRearrange(next, what, "search")}
        />
      )}

      {/* The drawer: a stop's detail, or Refine with AI, on Polar ice. `.docked-panel` is what the
          camera measures to aim beside it, and what keeps the overlay click-through around it. */}
      {/* A stop's detail may open during a film, from the player bar; Refine and Edit cannot. */}
      {trip && itinerary && (drawer === "detail" || (drawer === "refine" && !story.active)) && (
        <aside className={`tm docked-panel trip-drawer${drawer === "refine" ? " is-wide" : ""}`} data-appearance="light" aria-label={drawer === "refine" ? "Refine with AI" : "About this stop"}>
          <div className="trip-drawer-body">
            {drawer === "refine" && focus.target && focus.draft && (
              <FocusEditMode
                polar
                trip={trip}
                userAnswers={trip.userAnswers ?? null}
                draft={focus.draft}
                dayIndex={focus.target.dayIndex}
                scope={focus.target.scope}
                tripId={trip.id}
                sessionId={trip.chatSessionId ?? null}
                initialMessage={focus.target.initialMessage}
                dirty={focus.dirty}
                saving={savingFocus}
                onDaysModified={(days) =>
                  setUnseenChangedDays((prev) => markUnseenDays(days, focus.target?.dayIndex ?? activeDayIndex, prev))
                }
                onDraftChange={focus.applyDraft}
                onCancel={focus.cancel}
                onSave={saveRefine}
              />
            )}
            {drawer === "detail" && selectedStop && (
              <PlaceDetailPanel
                polar
                stop={selectedStop}
                detail={detail}
                loading={detailLoading}
                error={detailError}
                onRetry={() => selectStop(selectedStop, { stayPut: true })}
                onBack={() => closeDetail({ stayPut: story.active })}
                actualCost={selectedStop.actualCost}
                onActualCostChange={handleStopActualCostChange}
                actualCostNote={costNote?.key === stopCostKey(itinerary, selectedStop) ? costNote.text : ""}
                onRetryActualCost={retryCost}
                upcomingStops={upcomingStopsAfter(itinerary, selectedStop)}
                onSelectUpcoming={(stop) => selectStop(stop, { stayPut: story.active })}
              />
            )}
          </div>
        </aside>
      )}

      {/* The full editor is its own fixed panel in the same place; it portals itself out. */}
      {trip && itinerary && drawer === "edit" && !story.active && (
        <SplitEditor trip={trip} itinerary={itinerary} onItineraryChange={handleRearrange} onClose={() => setEditOpen(false)} appearance="light" />
      )}
    </main>
  );
}
