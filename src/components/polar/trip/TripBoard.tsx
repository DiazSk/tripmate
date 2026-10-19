"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Bike, Car, Footprints } from "lucide-react";

import type { DayPlan, Itinerary, Stop, Trip } from "@/lib/types";
import { useMapCamera } from "@/lib/mapCamera";
import { useStoryControls } from "@/lib/storyMode";
import { markHandoffOrigin } from "@/lib/controlHandoff";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { TIERS } from "@/lib/tiers";
import { DRAFT_TTL_DAYS } from "@/lib/drafts";
import { EVIDENCE_FOOTNOTE } from "@/lib/evidence";
import { evaluateItinerary } from "@/lib/guardrails";
import { anyActualSpend, budgetSegments, daySpendByCategory, tripSpend } from "@/lib/itinerary";
import { formatDistance, formatDuration, formatMoney } from "@/lib/format";
import { PROFILE_VERB, ROUTE_PROFILES, meaningfulLeg, setRouteProfile, useDayRoute, useRouteProfile } from "@/lib/dayRoutes";
import { dayColorToken } from "@/lib/mapRoute";
import { readWeather } from "@/components/DayHeader";
import AnchorReceipt from "@/components/AnchorReceipt";
import Meridian from "@/components/Meridian";
import InlineNote, { HeldNote } from "@/components/InlineNote";
import { formatWait, useHold } from "@/lib/actionHolds";
import { failureFromResponse, failureFromThrown, isAbort } from "@/lib/failure";
import type { Bucket } from "@/lib/ipThrottle";
import { useToast } from "@/lib/toast";

/**
 * The trip page's plan. At 961px and wider it is the right-hand column of the canvas design "Trip
 * page · A", the map full height beside it and the day's stops first: the trip, Play, the days as
 * tabs, the day, its stops down the column with the way between each pair, then the money. Narrower,
 * it is the departure board along the foot of the map ("Trip page · B"). One markup for both; the
 * column is TripBoard.css re-ordering it.
 *
 * Three shapes, one component, because the map has to be told about every one of them and only
 * this component knows the itinerary: the **board**; the **strip** (the board folded to its days
 * while a drawer is open on the right, so the map keeps the room it needs to show what is changing);
 * and the **ticket** (shut, the whole trip on the map, one line to bring the plan back). In a film
 * it renders nothing at all and stands aside from the camera, which story mode drives.
 *
 * The map wiring is `ItineraryCard`'s, kept to the same rules: the route redraws on a change of
 * *shape* (a move, an add, a delete), never on a keystroke; a focused day is drawn alone; shut is
 * the overview; and hover and selection are one index shared with the markers.
 */
export type BoardShape = "board" | "strip" | "ticket" | "hidden";

/** A failure written where it happened. `hold` counts the `{mm:ss}` in `text` down, then says `resolved`. */
export type Note = { text: string; hold?: { bucket: Bucket; resolved: string } };

const ICON = { walk: Footprints, bike: Bike, drive: Car } as const;
/** "7 min walk", as the canvas's legs read. */
const PROFILE_NOUN = { walk: "walk", bike: "ride", drive: "drive" } as const;

const weekday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
};
const dayOfMonth = (iso: string) => Number(iso?.slice(8, 10)) || "";
/** "Thursday 5 November", as the day's head reads. UTC, since a plan date is a calendar date. */
const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
};
const city = (destination: string) => destination.split(",")[0].trim();

/** Where the board becomes the column. TripView reads the same query to tell the map. */
export const COLUMN_QUERY = "(width > 60rem)";
const subscribeColumn = (onChange: () => void) => {
  const mql = window.matchMedia(COLUMN_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

/**
 * Tell the map how much of the screen is the plan's. The board along the foot is a bottom inset
 * (`setViewPadding`, honoured by MapLibre; Cesium centres in the full view and draws the day
 * partly behind the board, see docs/frontend.md). A drawer, and the board when it is the column
 * at 961px and wider, are found by the camera itself through their `.docked-panel` class
 * (`panelLeftEdgePx`), so the column is no bottom inset at all. The same two numbers move the map's
 * own controls clear of all three, through `--trip-board-h` and `--trip-drawer-w` (globals.css,
 * TripBoard.css). Mounted beside the board by TripView, and by `/`'s unsaved fallback (HomeView).
 */
export function BoardInsets({ shape, drawer = null, spotlight = false }: { shape: BoardShape; drawer?: string | null; spotlight?: boolean }) {
  const story = useStoryControls();
  const { setViewPadding, reframeRoute } = useMapCamera();
  useLayoutEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    /** Set when the window crossed 961px, for the measure to re-frame the day once it has the new
     *  insets. TripBoard re-frames on the same crossing, but whether its effect or this frame runs
     *  first is React's business, and the one that runs first frames with the other's stale half
     *  (old padding, or the old `panelVisible`). Measured: the day left behind the bottom board after
     *  1470 → 900. Either order ends right with both: the later one has both halves new. */
    let reframe = false;
    const measure = () => {
      frame = 0;
      const column = shape === "board" && window.matchMedia(COLUMN_QUERY).matches;
      const foot = column ? null : document.querySelector<HTMLElement>(story.active ? ".story-player .sp-bar" : ".trip-board, .tb-shut");
      const side = document.querySelector<HTMLElement>(column ? ".trip-board" : ".trip-drawer, .split-editor");
      // Where the foot comes to rest, not where its entrance has it this frame: the board rises 2rem
      // into place over 0.5s (`tb-rise`), and a rect read mid-rise put the map's controls 32px short
      // until a re-measure jumped them up at 560ms. The transform's own offset is taken back out.
      const restTop = foot ? foot.getBoundingClientRect().top - new DOMMatrixReadOnly(getComputedStyle(foot).transform).m42 : 0;
      const bottom = foot ? Math.max(0, Math.round(window.innerHeight - restTop + 16)) : 0;
      // The fixed nav covers the top, so the day is framed below it. Without that the day centred in
      // a band that started at y = 0, and at 375x667 its first stop's name sat under the nav (the bar
      // is 56px of a 254px map there). AppShell keeps the nav through a film, so it counts then too.
      // `.polar-nav`, not the first `<nav>` in the DOM, which need not be the bar.
      const nav = document.querySelector<HTMLElement>(".polar-nav");
      const top = nav ? Math.max(0, Math.round(nav.getBoundingClientRect().bottom)) : 0;
      // The open map search is a sheet down the left (none below 40rem, where its rect is empty).
      // Its edge is stored as padding, not applied: opening the search leaves the view where it is
      // (it is about the view on screen), and every camera command after it (a result panned out from
      // under the sheet, the sheet's own day arrows) frames in the map to its right.
      // Where it comes to rest, as for the foot: it slides in 1.5rem from the left (`tsl-in`).
      const sheet = document.querySelector<HTMLElement>(".trip-spotlight");
      const rect = sheet?.getBoundingClientRect();
      const left = sheet && rect?.width ? Math.round(rect.right - new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m41) : 0;
      setViewPadding({ left, bottom, top });
      // Only the open board re-frames on the crossing: a drawer, the map search or a film is what
      // the traveller is reading, and replaying the day's framing over it would move it away.
      if (reframe && shape === "board" && !story.active) reframeRoute();
      reframe = false;
      // With nothing along the foot (the map search open) the controls stand clear of the corner's
      // trace button (`LlmTraceFab`: 20px in, 48px tall) instead. `0px` would beat the CSS fallback
      // and put them on the screen's edge, partly off it.
      root.style.setProperty("--trip-board-h", `${bottom || 80}px`);
      root.style.setProperty("--trip-drawer-w", side ? `${Math.round(side.getBoundingClientRect().width)}px` : "0px");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener("resize", schedule);
    // Crossing 961px swaps the bottom board for the column: one inset becomes the other.
    const columnQuery = window.matchMedia(COLUMN_QUERY);
    const crossed = () => {
      reframe = true;
      schedule();
    };
    columnQuery.addEventListener("change", crossed);
    // The search grows and shrinks with its results.
    const bar = document.querySelector<HTMLElement>(".trip-spotlight");
    const observer = new ResizeObserver(schedule);
    if (bar) observer.observe(bar);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      columnQuery.removeEventListener("change", crossed);
      observer.disconnect();
    };
  }, [shape, drawer, story.active, spotlight, setViewPadding, reframeRoute]);
  useEffect(
    () => () => {
      setViewPadding(null);
      document.documentElement.style.removeProperty("--trip-board-h");
      document.documentElement.style.removeProperty("--trip-drawer-w");
    },
    [setViewPadding]
  );
  return null;
}

export default function TripBoard({
  trip,
  itinerary,
  dayIndex,
  onDayChange,
  shape,
  unseenChangedDays = [],
  drawerOpen,
  onSelectStop,
  onRefine,
  onEdit,
  onFitAnchor,
  onShut,
  onOpen,
  onKeep,
  keeping,
  keepNote,
  costNote,
  onRetryCost,
  onShareChange,
  onLodgingActualCost,
  overspend,
  unsaved = false,
}: {
  trip: Trip;
  itinerary: Itinerary;
  dayIndex: number;
  onDayChange: (dayIndex: number) => void;
  shape: BoardShape;
  unseenChangedDays?: number[];
  /** A drawer is open on the right: the camera aims beside it rather than over the whole width. */
  drawerOpen: boolean;
  onSelectStop: (stop: Stop) => void;
  onRefine: (dayIndex: number) => void;
  onEdit: () => void;
  onFitAnchor: (name: string) => void;
  onShut: () => void;
  onOpen: () => void;
  onKeep: () => void;
  keeping: boolean;
  /** Copy rows T-06/T-07: why Keep didn't keep it. Empty while there is nothing to say. */
  keepNote: string;
  /** Copy row T-05, for the lodging amount whose key matches (`${dayIndex}:lodging`). */
  costNote: { key: string; text: string } | null;
  onRetryCost: () => void;
  onShareChange: () => void;
  onLodgingActualCost: (dayIndex: number, value: number | undefined) => void;
  overspend: { dayIndex: number; amount: number; rebalancing: boolean; onRebalance: () => void; onDismiss: () => void; note: Note | null } | null;
  /** `/`'s fallback when the draft insert failed: a plan with no row behind it. Read and Keep only —
   *  everything that writes to, plays from or links to a trip row is withheld, and the Keep line
   *  says it isn't saved rather than how long a draft lasts. `keepNote` carries why (copy W-16/W-17). */
  unsaved?: boolean;
}) {
  const days = itinerary.days;
  const di = Math.min(dayIndex, Math.max(0, days.length - 1));
  const day: DayPlan | undefined = days[di];
  const story = useStoryControls();
  const { showTripRoute, showLegPaths, hoveredIndex, setHoveredIndex, activeIndex } = useMapCamera();
  const heroPhoto = usePlacePhoto(trip.destination, "thumb");
  // The column's head is the city across its full width (520 CSS px), so it takes a ~1280px
  // rendition rather than the ticket's 330px thumbnail or the 3840px original (2,881KB, for a box
  // that needs 1040px at 2x). One request either way: all variants share a cache entry.
  const headPhoto = usePlacePhoto(trip.destination, "wide");
  /** The open board stands as a wall on the right rather than along the foot. `docked-panel` on it
   *  is what `panelLeftEdgePx` measures, so the camera aims the day beside it, exactly as beside a
   *  drawer — and only then: on the bottom board that class would read as a wall at x = 0. */
  const column = useSyncExternalStore(subscribeColumn, () => window.matchMedia(COLUMN_QUERY).matches, () => false) && shape === "board";

  // ── The map ──────────────────────────────────────────────────────────────────────────────────
  const routeDays = useMemo(
    () => days.map((d, i) => d.stops.map((st) => ({ lat: st.lat, lng: st.lng, name: st.name, day: i, time: st.time }))),
    [days]
  );
  /** The route's shape and nothing else, so a typed name never reframes the camera. See the long
   *  note on the same memo in `ItineraryCard`. */
  const routeShape = useMemo(() => JSON.stringify(days.map((d) => d.stops.map((st) => [st.lat, st.lng]))), [days]);
  const overview = shape === "ticket";
  useEffect(() => {
    if (!day || story.active || shape === "hidden") return;
    // Shut is the overview: every day, each in its colour. Otherwise the day alone. The camera aims
    // beside the drawer or the column, and above the bottom board through the view padding the page
    // sets. `column` is a dependency so a window crossing 961px re-frames the day for the new layout.
    showTripRoute(routeDays, overview ? null : di, drawerOpen || column, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `routeShape`, not `routeDays`: see above
  }, [routeShape, di, overview, drawerOpen, column, story.active, shape, showTripRoute]);

  const dayPoints = useMemo(() => day?.stops.map((st) => ({ lat: st.lat, lng: st.lng })) ?? null, [day?.stops]);
  const legs = useDayRoute(dayPoints);
  const legPathDay = story.active ? story.dayIndex : overview ? null : di;
  useEffect(() => {
    if (legPathDay === null || !legs) {
      showLegPaths(null);
      return;
    }
    const paths = legs.map((leg) => meaningfulLeg(leg)?.points ?? []).filter((p) => p.length >= 2);
    showLegPaths(paths.length > 0 ? { dayIndex: legPathDay, paths } : null);
  }, [legPathDay, legs, showLegPaths]);

  const dayOffset = useMemo(() => routeDays.slice(0, di).reduce((n, d) => n + d.length, 0), [routeDays, di]);
  const rowOf = (flat: number | null) => {
    if (flat === null) return null;
    const row = flat - dayOffset;
    return row >= 0 && row < (routeDays[di]?.length ?? 0) ? row : null;
  };
  const lit = rowOf(hoveredIndex ?? activeIndex);

  // The card the map or a beat selected scrolls into view; a pointer sweep across the cards does not.
  const cardsRef = useRef<HTMLOListElement>(null);
  const selectedRow = rowOf(activeIndex);
  useEffect(() => {
    if (selectedRow === null) return;
    const el = cardsRef.current?.querySelector<HTMLElement>(`[data-row="${selectedRow}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [selectedRow]);

  // The days are a row of tabs in every shape, and every shape mounts its own, scrolled to the start:
  // without this a long trip opened on its 25th day, or folded to the strip and back, showed a tab row
  // with the selected day off its end. Horizontal only, by hand, because `scrollIntoView` would also
  // scroll the column itself up to the tabs. `column` too: crossing 961px lays the same tabs out the
  // other way, and the row the selected tab sat in is not the row it sits in now.
  useEffect(() => {
    const tab = document.getElementById(`trip-day-${di}`);
    const row = tab?.closest<HTMLElement>(".tb-days");
    if (!tab || !row) return;
    const t = tab.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (t.left < r.left) row.scrollLeft -= r.left - t.left;
    else if (t.right > r.right) row.scrollLeft += t.right - r.right;
  }, [di, shape, column]);

  // ── Feedback on edits, held back until there is an edit (see `ItineraryCard`'s findings) ─────
  const [asGenerated] = useState(itinerary);
  const edited = itinerary !== asGenerated;
  const findings = useMemo(() => (edited ? evaluateItinerary(itinerary, { budget: trip.budget }) : []), [edited, itinerary, trip.budget]);
  const dayFindings = findings.filter((f) => f.dayIndex === di || f.dayIndex === null);

  // ── Share: one control, two sides, and a reply that belongs to the button pressed ────────────
  const [shareSaid, setShareSaid] = useState<string | null>(null);
  const canShare = trip.id !== "preview";
  const router = useRouter();
  const { showError } = useToast();
  async function share() {
    const stop = trip.shared;
    setShareSaid(stop ? "Stopping…" : "Making a link…");
    try {
      const res = await fetch(`/api/trips/${trip.id}/share`, { method: stop ? "DELETE" : "POST" });
      if (!res.ok) {
        // Copy rows T-84..T-88: a failure is news that outlives the button's 2.6s label, so it is a
        // toast that stays, and the button goes back to what it was.
        const f = await failureFromResponse(res, "edit");
        setShareSaid(null);
        shareFailed(stop, f.kind === "not_found" ? "gone" : "server");
        return;
      }
      if (stop) setShareSaid("Link turned off");
      else {
        const { url } = (await res.json()) as { url: string };
        // The clipboard throws in an insecure context and wherever permission is refused; opening
        // the link puts it in the address bar, which is somewhere it can still be copied from.
        try {
          await navigator.clipboard.writeText(url);
          setShareSaid("Link copied");
        } catch {
          window.open(url, "_blank", "noopener");
          setShareSaid("Opened in a new tab");
        }
      }
      onShareChange();
    } catch (e) {
      setShareSaid(null);
      if (!isAbort(e)) shareFailed(stop, failureFromThrown(e).kind === "offline" ? "offline" : "server");
      return;
    }
    setTimeout(() => setShareSaid(null), 2600);
  }
  function shareFailed(stopping: boolean | undefined, cause: "offline" | "server" | "gone") {
    const again = { label: "Try again", onClick: share };
    if (cause === "gone") {
      showError({ title: "This trip isn’t saved here any more, so it can’t be shared.", action: { label: "See your memories", onClick: () => router.push("/trips") } });
    } else if (stopping) {
      showError(
        cause === "offline"
          ? { title: "You’re offline, so the share link is still on.", detail: "Anyone with it can still see this trip. Turn it off once you’re back online.", action: again }
          : { title: "The share link is still on: TripMate couldn’t turn it off.", detail: "Anyone with it can still see this trip.", action: again }
      );
    } else {
      showError(
        cause === "offline"
          ? { title: "You’re offline, so no share link was made.", detail: "Try again once you’re back online.", action: again }
          : { title: "TripMate couldn’t make a share link just now.", action: again }
      );
    }
  }

  function play(e: React.MouseEvent<HTMLButtonElement>) {
    markHandoffOrigin(e.currentTarget);
    story.start({ itinerary, dayIndex: di, destination: trip.destination, tripId: trip.id });
  }

  if (shape === "hidden") return null;

  const spent = tripSpend(days);
  const over = spent > trip.budget;
  const tier = TIERS.find((t) => t.id === itinerary.tier);

  if (shape === "ticket") {
    return (
      <button type="button" className="tm tb-shut" onClick={onOpen} aria-label="Show the plan">
        <span className="tb-shut-photo">
          {heroPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary Wikipedia originals; next/image throws on an unconfigured host
            <img src={heroPhoto} alt="" />
          ) : (
            <b>{city(trip.destination).slice(0, 1)}</b>
          )}
        </span>
        <b>{city(trip.destination)}</b> · {days.length} {days.length === 1 ? "day" : "days"}
        {day && <span className="tb-shut-day">Day {di + 1}</span>}
        <span className="tb-shut-hint">Show the plan ▴</span>
      </button>
    );
  }

  const dayList = (
    <ol className="tb-days" role="tablist" aria-label="Trip days">
      {days.map((d, i) => (
        <li key={`${d.date}-${i}`}>
          <button
            type="button"
            role="tab"
            id={`trip-day-${i}`}
            aria-selected={i === di}
            aria-controls="trip-day-panel"
            onClick={() => onDayChange(i)}
            onKeyDown={(e) => {
              const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: days.length - 1 }[e.key];
              if (next == null) return;
              e.preventDefault();
              const clamped = Math.max(0, Math.min(days.length - 1, next));
              onDayChange(clamped);
              document.getElementById(`trip-day-${clamped}`)?.focus();
            }}
            style={{ ["--c" as string]: `var(${dayColorToken(i)})` }}
          >
            <b>{String(i + 1).padStart(2, "0")}</b>
            <span className="tb-day-when">
              {weekday(d.date)} {dayOfMonth(d.date)}
            </span>
            <span className="tb-day-what">{d.title || d.theme}</span>
            {unseenChangedDays.includes(i) && i !== di && (
              <i className="tb-changed">
                <span className="sr-only">(changed)</span>
              </i>
            )}
          </button>
        </li>
      ))}
    </ol>
  );

  if (shape === "strip") {
    return (
      <section className="tm trip-board tb-board is-strip" data-appearance="light" aria-label="Your plan">
        <div className="tb-strip">
          <h1 className="tb-city">{city(trip.destination)}</h1>
          {dayList}
        </div>
      </section>
    );
  }

  const spend = day ? daySpendByCategory(day) : null;
  const confirmed = day ? anyActualSpend([day]) : false;
  const segments = budgetSegments(days, trip.budget);

  return (
    <section className={`tm trip-board tb-board${column ? " docked-panel" : ""}`} data-appearance="light" aria-label="Your plan">
      <button type="button" className="tb-grab" aria-label="Show the map" onClick={onShut}>
        <span />
      </button>

      {/* Left: the trip and its actions, the budget, then the days */}
      <div className="tb-side">
        <div className="tb-trip">
          <div className="tb-trip-line">
            {column && (
              <span className="tb-trip-photo" aria-hidden="true">
                {headPhoto && (
                  // next/image, not a bare <img>: the browser never touches Wikimedia, whose image hosts
                  // set cookies (`WMF-Uniq`, `NetworkProbeLimit`) that failed Lighthouse's
                  // third-party-cookies audit (best practices 100 -> 78) at any size, and the optimizer
                  // re-encodes the 1280px source to ~1080px WebP for this 520px box at 2x.
                  <Image src={headPhoto} alt="" fill sizes="520px" className="value-in" />
                )}
              </span>
            )}
            <h1 className="tb-city">{city(trip.destination)}</h1>
            <p className="tb-meta">
              {days.length} {days.length === 1 ? "day" : "days"}
              {tier ? (
                <>
                  <br />
                  {tier.name}
                </>
              ) : null}
            </p>
          </div>
          {!unsaved && (
            <div className="tb-actions">
              <button type="button" className="tb-play" onClick={play} disabled={!day?.stops.length}>
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
                </svg>
                Play day {di + 1}
              </button>
              {canShare && (
                <button type="button" className={`tb-share${trip.shared ? " is-on" : ""}`} onClick={share} aria-live="polite" title={trip.shared ? "Stop sharing" : "Share a link"}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
                    <path d="M9.5 13.5a4 4 0 0 0 5.66 0l2.3-2.3a4 4 0 0 0-5.66-5.66l-1 1" />
                    <path d="M14.5 10.5a4 4 0 0 0-5.66 0l-2.3 2.3a4 4 0 0 0 5.66 5.66l1-1" />
                    {trip.shared && <path d="M3 3l18 18" />}
                  </svg>
                  {shareSaid ?? (trip.shared ? "Stop sharing" : "Share")}
                </button>
              )}
              {canShare && (
                <a className="tb-ibtn" href={`/api/trips/${trip.id}/export`} download aria-label="Download itinerary" title="Download itinerary">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
                    <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16" />
                  </svg>
                </a>
              )}
            </div>
          )}
          {trip.status === "draft" && (
            <p className="tb-draft" role="status">
              <span>{unsaved ? "Not saved yet" : `Draft · cleared after ${DRAFT_TTL_DAYS} days unless kept`}</span>
              <button type="button" onClick={onKeep} disabled={keeping} aria-describedby="tb-keep-note">
                {keeping ? "Keeping…" : "Keep this trip"}
              </button>
              {/* Copy rows T-06/T-07. Not its own live region: the notice around it already is. */}
              <InlineNote size="item" tone="error" id="tb-keep-note" live={false}>
                {keepNote}
              </InlineNote>
            </p>
          )}
        </div>

        <div className="tb-budget">
          <div>
            <span className="tb-label">Budget</span>
            <b className={over ? "is-over" : ""}>
              {formatMoney(spent)} <em>of {formatMoney(trip.budget)}</em>
            </b>
          </div>
          <div className="tb-bar" role="img" aria-label={`${formatMoney(spent)} of ${formatMoney(trip.budget)}${over ? `, ${formatMoney(spent - trip.budget)} over` : ""}`}>
            {segments.map((seg) => (
              <span
                key={seg.dayIndex}
                className={seg.dayIndex === di ? "is-on" : ""}
                style={{ width: `${seg.width}%`, ["--c" as string]: `var(${dayColorToken(seg.dayIndex)})` }}
                title={`Day ${seg.dayIndex + 1} · ${formatMoney(seg.spend)}`}
              />
            ))}
          </div>
          {over && <p className="tb-over">{formatMoney(spent - trip.budget)} over budget</p>}
        </div>

        {dayList}
      </div>

      {/* Right: the day, then its stops in travel order */}
      <div className="tb-main" id="trip-day-panel" role="tabpanel" aria-labelledby={`trip-day-${di}`}>
        {!day ? (
          <p className="tb-empty">This plan came back with no days in it. Try generating it again.</p>
        ) : (
          <>
            <header className="tb-day-head">
              <div className="tb-day-titles">
                <p>
                  {longDate(day.date)}
                  <DayWeather day={day} />
                </p>
                <h2>{day.title || day.theme || `Day ${di + 1}`}</h2>
              </div>
              <div className="tb-tools">
                {day.lodging && (
                  <span className="tb-head-stay" title={day.lodging.note || undefined}>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path d="M2 13V5.5L8 2l6 3.5V13M5.5 13V9h5v4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    </svg>
                    {day.lodging.name}
                    {day.lodging.cost > 0 && <> · {formatMoney(day.lodging.actualCost ?? day.lodging.cost)}</>}
                  </span>
                )}
                {legs?.some((l) => meaningfulLeg(l)) && <RouteProfile />}
                {!unsaved && (
                  <>
                    <button type="button" className="tb-tool" onClick={() => onRefine(di)} aria-label={`Refine with AI, day ${di + 1}`}>
                      <Meridian size={16} state="idle" quiet /> Refine with AI
                    </button>
                    <button type="button" className="tb-tool" onClick={onEdit}>
                      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                        <path d="M10.5 2.8l2.7 2.7L6 12.7 2.8 13.2l.5-3.2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      </svg>
                      Edit day
                    </button>
                  </>
                )}
              </div>
            </header>

            {overspend && !unsaved && (
              <div className="tb-alert" role="status">
                <span>
                  <b>
                    Day {overspend.dayIndex + 1} ran {formatMoney(overspend.amount)} over plan.
                  </b>{" "}
                  Rebalance the rest of the trip?
                </span>
                <button type="button" onClick={overspend.onDismiss} disabled={overspend.rebalancing}>
                  Dismiss
                </button>
                <RebalanceButton rebalancing={overspend.rebalancing} onClick={overspend.onRebalance} />
                {/* Copy rows T-09..T-14. Not live itself: the strip is. */}
                {overspend.note?.hold ? (
                  <HeldNote size="item" bucket={overspend.note.hold.bucket} resolved={overspend.note.hold.resolved} id="tb-rebalance-note" live={false}>
                    {overspend.note.text}
                  </HeldNote>
                ) : (
                  <InlineNote size="item" tone="error" id="tb-rebalance-note" live={false}>
                    {overspend.note?.text ?? ""}
                  </InlineNote>
                )}
              </div>
            )}
            <AnchorReceipt itinerary={itinerary} onFitAnchor={unsaved ? undefined : onFitAnchor} kept={trip.status === "saved"} />
            {dayFindings.length > 0 && (
              <ul className="tb-findings">
                {dayFindings.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            )}

            {day.stops.length === 0 ? (
              <p className="tb-empty">No stops planned for this day. It&rsquo;s yours to fill.</p>
            ) : (
              <ol className="tb-cards" ref={cardsRef}>
                {day.stops.map((stop, i) => (
                  <li key={`${stop.name}-${i}`} className="tb-card-slot">
                    <StopCard
                      stop={stop}
                      n={i + 1}
                      dayIndex={di}
                      lit={lit === i}
                      onHover={(on) => setHoveredIndex(on ? dayOffset + i : null)}
                      onOpen={() => onSelectStop(stop)}
                    />
                    {i < day.stops.length - 1 && <Leg leg={legs?.[i] ?? null} />}
                  </li>
                ))}
                <li className="tb-card-slot">
                  <DayTotal
                    day={day}
                    dayIndex={di}
                    spend={spend}
                    confirmed={confirmed}
                    onLodgingActualCost={unsaved ? undefined : onLodgingActualCost}
                    costNote={costNote?.key === `${di}:lodging` ? costNote.text : ""}
                    onRetryCost={onRetryCost}
                  />
                </li>
              </ol>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function StopCard({ stop, n, dayIndex, lit, onHover, onOpen }: { stop: Stop; n: number; dayIndex: number; lit: boolean; onHover: (on: boolean) => void; onOpen: () => void }) {
  const photo = usePlacePhoto(stop.name);
  const [failed, setFailed] = useState<string | null>(null);
  const shown = photo && photo !== failed ? photo : null;
  const cost = stop.actualCost ?? stop.cost;
  return (
    <button
      type="button"
      className={`tb-card${lit ? " is-lit" : ""}`}
      data-row={n - 1}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onClick={onOpen}
    >
      <span className="tb-card-photo">
        {/* The place's initial on the night ground is the base; a photo fades in over it. */}
        <b aria-hidden="true">{stop.name.slice(0, 1)}</b>
        {shown && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary Wikipedia originals; next/image throws on an unconfigured host
          <img key={shown} src={shown} alt="" loading="lazy" className="value-in" onError={() => setFailed(shown)} />
        )}
        {stop.time && <span className="tb-card-time">{stop.time}</span>}
        <span className="tb-card-n" style={{ background: `var(${dayColorToken(dayIndex)})` }}>
          {n}
        </span>
      </span>
      <b className="tb-card-name">{stop.name}</b>
      <span className="tb-card-meta">
        {[stop.durationLabel, cost > 0 ? formatMoney(cost) : stop.durationLabel ? "free" : null].filter(Boolean).join(" · ")}
      </span>
      {(stop.why || stop.note) && <span className="tb-card-why">{stop.why || stop.note}</span>}
    </button>
  );
}

/** Rebalance, held while the `edit` limit is (copy row T-12): "Rebalance in {mm:ss}", disabled. Its own
 *  component so the countdown's per-second render stays off the board. */
function RebalanceButton({ rebalancing, onClick }: { rebalancing: boolean; onClick: () => void }) {
  const { secondsLeft } = useHold("edit");
  return (
    <button type="button" className="is-go" onClick={onClick} disabled={rebalancing || secondsLeft !== null} aria-describedby="tb-rebalance-note">
      {rebalancing ? "Rebalancing…" : secondsLeft !== null ? `Rebalance in ${formatWait(secondsLeft)}` : "Rebalance"}
    </button>
  );
}

/** The way between two cards: the mode, the time, the distance, on a dashed line. */
function Leg({ leg }: { leg: Parameters<typeof meaningfulLeg>[0] }) {
  const profile = useRouteProfile();
  const real = meaningfulLeg(leg);
  const Icon = ICON[profile];
  return (
    <span className="tb-leg" aria-label={real ? `${formatDuration(real.durationS)} ${PROFILE_VERB[profile]}, ${formatDistance(real.distanceM)}` : undefined}>
      {real && (
        <>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          <em>
            {formatDuration(real.durationS)} {PROFILE_NOUN[profile]}
          </em>
        </>
      )}
    </span>
  );
}

function RouteProfile() {
  const profile = useRouteProfile();
  return (
    <div className="tb-seg" role="group" aria-label="Getting around">
      {ROUTE_PROFILES.map((p) => {
        const Icon = ICON[p];
        return (
          <button key={p} type="button" aria-pressed={p === profile} onClick={() => setRouteProfile(p)} title={p}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">{p}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The day's money, at the end of its cards: what it comes to, and what the stay actually cost. */
function DayTotal({
  day,
  dayIndex,
  spend,
  confirmed,
  onLodgingActualCost,
  costNote,
  onRetryCost,
}: {
  day: DayPlan;
  dayIndex: number;
  spend: ReturnType<typeof daySpendByCategory> | null;
  confirmed: boolean;
  /** Absent where the stay can't be written (an unsaved plan): the field and its note go with it. */
  onLodgingActualCost?: (dayIndex: number, value: number | undefined) => void;
  costNote: string;
  onRetryCost: () => void;
}) {
  if (!spend) return null;
  const rows = (
    [
      ["Food", spend.food],
      ["Entry", spend.entry],
      ["Transit", spend.transit],
      ["Other", spend.other],
      ["Stay", spend.stay],
    ] as const
  ).filter(([, v]) => v > 0);
  return (
    <div className="tb-total">
      <span className="tb-label">
        Day {dayIndex + 1} {confirmed ? "confirmed" : "projected"}
      </span>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{formatMoney(v)}</dd>
          </div>
        ))}
        <div className="is-total">
          <dt>Total</dt>
          <dd>{formatMoney(spend.total)}</dd>
        </div>
      </dl>
      {day.lodging && onLodgingActualCost && (
        <label className="tb-stay" title={`What you actually paid at ${day.lodging.name}. Replaces the estimate in this trip's budget total.`}>
          <span>Actual stay</span>
          <span className="tb-money-in">
            $
            <input
              type="number"
              min={0}
              step={1}
              inputMode="decimal"
              defaultValue={day.lodging.actualCost}
              placeholder={String(Math.round(day.lodging.cost))}
              aria-label={`Actual lodging cost in dollars for day ${dayIndex + 1}, ${day.lodging.name}`}
              aria-describedby="tb-stay-note"
              onBlur={(e) => onLodgingActualCost(dayIndex, e.target.value === "" ? undefined : Number(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </span>
        </label>
      )}
      {/* Copy row T-05, under the amount. Mounted empty so it is announced. */}
      {day.lodging && onLodgingActualCost && (
        <InlineNote size="field" tone="error" id="tb-stay-note" action={{ label: "Try again", onClick: onRetryCost }}>
          {costNote}
        </InlineNote>
      )}
      <p>{EVIDENCE_FOOTNOTE}</p>
    </div>
  );
}

/** "◒ 12–17°C · Showers · 60% rain": the badge's reading, set as plain type in the day's head. */
function DayWeather({ day }: { day: DayPlan }) {
  const { Icon, temp, label, rain, typical } = readWeather(day);
  if (!temp && !label) return null;
  return (
    <span className="tb-weather">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {[temp, label, rain ? `${rain}% rain` : null, typical ? "typical" : null].filter(Boolean).join(" · ")}
    </span>
  );
}
