"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MapPin, Plus, Search, Trash2, X } from "lucide-react";

import { DayPlan, Itinerary, Stop, TripSummary } from "@/lib/types";
import { dayDropId, dropCollision, parseDragId, stopDragId } from "@/lib/dragDrop";
import { evaluateItinerary } from "@/lib/guardrails";
import { insertionIndexByTime, moveStop } from "@/lib/schedule";
import { formatItineraryDate } from "@/lib/itinerary";
import { useHoverPeekSuspended, useMapCamera } from "@/lib/mapCamera";
import { addDay, deleteStop, insertStop, updateStop } from "@/lib/itineraryEdits";
import { devLabel } from "@/lib/devInspector";

/**
 * The split-screen itinerary editor: the trip's own globe on the left, day-by-day editable cards
 * on the right.
 *
 * It replaces `ArrangeBoard`, which was a full-screen surface covering the map entirely. That was
 * the right shape for the one job it had — drag a stop from any day to any other, both ends
 * visible — but it meant every other edit was made against a list with no idea where any of it
 * was. Moving a stop between days is a spatial decision, and the board hid the only thing that
 * could inform it.
 *
 * **The split is a panel, not a pane.** The editor occupies the right 45% opaquely and the globe
 * keeps the rest; nothing resizes the Cesium canvas. That is deliberate and load-bearing — a
 * canvas resize reallocates the framebuffer and re-rasters every resident tile, which is the same
 * cost `AppShell` documents for hiding the globe with `display: none`. The camera is aimed into
 * the free strip by `frameRouteBesidePanel`, which measures the panel's real edge, so the 55/45
 * read comes out of geometry already in the app rather than a second layout mode.
 *
 * Portalled to `document.body` for the reason `ArrangeBoard` documents: this opens from a card
 * inside a `backdrop-filter` panel, and a filtered ancestor contains `position: fixed`, so
 * rendered in place it would be trapped in a 520px column.
 */
export default function SplitEditor({
  trip,
  itinerary,
  onItineraryChange,
  onClose,
}: {
  trip: TripSummary;
  itinerary: Itinerary;
  onItineraryChange: (next: Itinerary) => void;
  onClose: () => void;
}) {
  /** The day whose stops are being edited, or `null` for "All Days". */
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [dragging, setDragging] = useState<{
    dayIndex: number;
    stopIndex: number;
    stop: Stop;
  } | null>(null);
  /** Armed by "Add from map": the next click on the globe becomes a stop. */
  const [pickingOnMap, setPickingOnMap] = useState(false);
  const [nearby, setNearby] = useState<
    { loading: boolean; pois: { name: string; lat: number; lon: number }[] } | null
  >(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const { showTripRoute, rendererRef, flyToPlace, hoveredIndex, setHoveredIndex, activeIndex } =
    useMapCamera();

  // Same reason Focus Mode does it: hovering a row here means "highlight this one on the globe",
  // not "fly to it". Reading down a day's stops with the pointer was diving the camera at every
  // row it crossed, which moves the ground out from under an edit in progress. Clicking a row
  // still frames the stop — that is `onFocusStop`.
  useHoverPeekSuspended();

  const sensors = useSensors(
    // 6px, so a click on a card's own controls is not read as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const findings = useMemo(
    () => evaluateItinerary(itinerary, { budget: trip.budget }),
    [itinerary, trip.budget]
  );

  const routeDays = useMemo(
    () =>
      itinerary.days.map((d, i) =>
        // `time` rides along only so the globe can light itself for the stop being looked at
        // (dayPhase in mapRoute) — the geometry does not read it.
        d.stops.map((st) => ({ lat: st.lat, lng: st.lng, name: st.name, day: i, time: st.time }))
      ),
    [itinerary.days]
  );

  /** Where each day's stops start in the flat list the map indexes hover by — a running sum, so
   *  a row in day 3 can name the same stop the globe knows by its flat position. */
  const dayOffsets = useMemo(() => {
    const offsets: number[] = [];
    routeDays.reduce((start, d) => {
      offsets.push(start);
      return start + d.length;
    }, 0);
    return offsets;
  }, [routeDays]);

  // The map follows the day tabs. Every day stays drawn either way — "All Days" puts them all at
  // baseline, and picking one makes it active while the rest dim behind it (`dayVisualState`).
  // That the others remain visible is what makes a cross-day drag a decision you can see: it is
  // about two days, and hiding one of them hides half the question.
  useEffect(() => {
    showTripRoute(routeDays, activeDay, true);
  }, [routeDays, activeDay, showTripRoute]);

  const loadNearby = useCallback(async (lat: number, lng: number) => {
    setNearby({ loading: true, pois: [] });
    setAddError(null);
    try {
      const res = await fetch(`/api/nearby-pois?lat=${lat}&lng=${lng}`);
      const data = (await res.json()) as { pois?: { name: string; lat: number; lon: number }[] };
      setNearby({ loading: false, pois: data.pois ?? [] });
    } catch {
      // Fail-soft, per the house rule: a dropped lookup leaves the picker saying it found
      // nothing, which is a thing the traveler can act on, rather than an error dialog.
      setNearby({ loading: false, pois: [] });
    }
  }, []);

  // A click on the map becomes "what is standing here" — see /api/nearby-pois for why this
  // offers real named places rather than reverse-geocoding an address. Installed only while the
  // mode is armed, so the map keeps its ordinary click-to-fly behaviour the rest of the time.
  //
  // The pick itself belongs to the engine: Cesium walks a `pickPosition` → `pickEllipsoid` chain
  // because the first needs a depth texture and the second still answers over open water, and
  // MapLibre just reads the click's own `lngLat`. Both hand back the same two numbers.
  useEffect(() => {
    if (!pickingOnMap) return;
    const renderer = rendererRef.current;
    if (!renderer?.isAlive()) return;
    return renderer.onMapClick((lat, lng) => void loadNearby(lat, lng));
  }, [pickingOnMap, rendererRef, loadNearby]);


  /** The day a new stop lands in. "All Days" has no active day, so it goes to the first. */
  const targetDay = activeDay ?? 0;

  const commitNewStop = (name: string, lat: number, lng: number) => {
    onItineraryChange(insertStop(itinerary, targetDay, { name, lat, lng }));
    setNearby(null);
    setPickingOnMap(false);
    setSearch("");
    setActiveDay(targetDay);
  };

  const addBySearch = async () => {
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/geocode?destination=${encodeURIComponent(q)}`);
      if (!res.ok) {
        setAddError("Couldn't find that place — try a fuller name.");
        return;
      }
      const geo = (await res.json()) as { lat: number; lng: number; name: string };
      commitNewStop(geo.name || q, geo.lat, geo.lng);
    } catch {
      setAddError("Search is unreachable right now.");
    } finally {
      setSearching(false);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const source = dragging;
    setDragging(null);
    const target = parseDragId(event.over?.id);
    if (!source || !target) return;
    const from = { dayIndex: source.dayIndex, stopIndex: source.stopIndex };

    // Onto another card: take that exact slot. Onto a day: no slot was chosen, so place it by
    // clock time rather than appending after that day's dinner.
    if (target.kind === "stop") {
      if (target.dayIndex === from.dayIndex && target.stopIndex === from.stopIndex) return;
      onItineraryChange(
        moveStop(itinerary, from, { dayIndex: target.dayIndex, stopIndex: target.stopIndex })
      );
      return;
    }
    if (target.dayIndex === from.dayIndex) return;
    const at = insertionIndexByTime(itinerary.days[target.dayIndex], source.stop);
    onItineraryChange(moveStop(itinerary, from, { dayIndex: target.dayIndex, stopIndex: at }));
  };

  const visibleDays = activeDay === null ? itinerary.days.map((_, i) => i) : [activeDay];

  const panel = (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Edit itinerary"
      // Same window the refine chat opens in: `DockedPanel`'s open geometry at its `wide` width,
      // in `.glass-itinerary`, rounded and inset from the nav — copied rather than imported
      // because this is still its own separate surface (it portals out of the panel, see below)
      // and only the *look* is shared. Not `inset-0` either way: the strip the panel leaves is
      // left alone so the globe stays visible *and* clickable — clicking a pin is one of this
      // editor's inputs, and a full-screen overlay would eat it.
      className="glass-itinerary fixed z-[70] flex flex-col overflow-hidden rounded-2xl top-[calc(var(--nav-h)+1.25rem)] right-0 left-0 h-[calc(100dvh-var(--nav-h)-1.25rem)] sm:top-[calc(var(--nav-h)+1.5rem)] sm:right-6 sm:left-auto sm:h-[calc(100dvh-var(--nav-h)-3rem)] sm:w-[62%] sm:max-w-[880px]"
      {...devLabel("SplitEditor")}
    >
      {/* Same header the chat window wears — title, a line of context under it, one accent
          action on the right — so the two surfaces read as the same window doing two jobs. */}
      <header className="flex items-center justify-between gap-3 border-b border-card-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-base font-semibold text-foreground">
            Edit itinerary
            <span className="font-normal text-muted">
              {" "}
              — {itinerary.days.length} day{itinerary.days.length > 1 ? "s" : ""}
            </span>
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted">{trip.destination}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          <X className="h-3.5 w-3.5" />
          Done
        </button>
      </header>

      {/* Day tabs. "All Days" first because it is the state the map opens in, and the one that
          makes a cross-day move possible without switching tabs mid-drag. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-card-border px-4 py-2.5">
        <DayPill active={activeDay === null} onClick={() => setActiveDay(null)}>
          All Days
        </DayPill>
        {itinerary.days.map((day, i) => (
          <DayPill key={i} active={activeDay === i} onClick={() => setActiveDay(i)} day={i}>
            Day {i + 1}
          </DayPill>
        ))}
        <button
          type="button"
          onClick={() => {
            const next = addDay(itinerary);
            onItineraryChange(next);
            setActiveDay(next.days.length - 1);
          }}
          className="ml-auto flex items-center gap-1 rounded-full border border-card-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Add Day
        </button>
      </div>

      <AddStopBar
        search={search}
        onSearch={setSearch}
        onSubmit={addBySearch}
        searching={searching}
        pickingOnMap={pickingOnMap}
        onTogglePick={() => {
          setPickingOnMap((p) => !p);
          setNearby(null);
          setAddError(null);
        }}
        targetDayLabel={`Day ${targetDay + 1}`}
        error={addError}
      />

      {nearby && (
        <NearbyPicker
          state={nearby}
          onPick={(p) => commitNewStop(p.name, p.lat, p.lon)}
          onDismiss={() => setNearby(null)}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={dropCollision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={(e: DragStartEvent) => {
          const from = parseDragId(e.active.id);
          if (from?.kind !== "stop") return;
          const stop = itinerary.days[from.dayIndex]?.stops[from.stopIndex];
          if (stop) setDragging({ dayIndex: from.dayIndex, stopIndex: from.stopIndex, stop });
        }}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {visibleDays.map((dayIndex) => (
            <DaySection
              key={dayIndex}
              day={itinerary.days[dayIndex]}
              dayIndex={dayIndex}
              dayOffset={dayOffsets[dayIndex] ?? 0}
              dayCount={itinerary.days.length}
              showHeading={activeDay === null}
              highlighted={hoveredIndex ?? activeIndex}
              onHoverStop={(flat) => setHoveredIndex(flat)}
              onFocusStop={(stop) => flyToPlace(stop.lat, stop.lng)}
              onEditStop={(stopIndex, patch) =>
                onItineraryChange(updateStop(itinerary, dayIndex, stopIndex, patch))
              }
              onDeleteStop={(stopIndex) =>
                onItineraryChange(deleteStop(itinerary, dayIndex, stopIndex))
              }
              onMoveStopToDay={(stopIndex, toDay) =>
                onItineraryChange(
                  moveStop(
                    itinerary,
                    { dayIndex, stopIndex },
                    {
                      dayIndex: toDay,
                      stopIndex: insertionIndexByTime(
                        itinerary.days[toDay],
                        itinerary.days[dayIndex].stops[stopIndex]
                      ),
                    }
                  )
                )
              }
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="pointer-events-none rounded-xl border border-accent/50 bg-[color:var(--surface-deep,#0f172a)] px-3 py-2 text-sm font-medium text-foreground shadow-2xl">
              {dragging.stop.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {findings.some((f) => f.dayIndex === null) && (
        <div className="border-t border-card-border px-4 py-2">
          {findings
            .filter((f) => f.dayIndex === null)
            .map((f, i) => (
              <p key={i} className="flex gap-1.5 text-xs text-amber-200">
                <span aria-hidden="true">⚠️</span>
                {f.message}
              </p>
            ))}
        </div>
      )}
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(panel, document.body);
}

/** A day tab. Carries the day's own map colour as a dot, so the tabs and the globe agree on
 *  which day is which without the traveler having to hold a legend in their head. */
function DayPill({
  active,
  onClick,
  day,
  children,
}: {
  active: boolean;
  onClick: () => void;
  day?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-accent text-accent-foreground"
          : "border border-card-border text-muted hover:text-foreground"
      }`}
    >
      {day !== undefined && (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: `var(${dayColorTokenFor(day)})` }}
        />
      )}
      {children}
    </button>
  );
}

/** Mirrors `dayColorToken` in mapRoute.ts — the *core* of each `DayPalette`, since this is a 8px
 *  dot and a glow would be invisible on it. Importing that as a value would pull the whole route
 *  module (and its Cesium types) into this tree for one string, so the cycle length is restated
 *  here; the tokens themselves still live only in globals.css. Keep the order in step with
 *  `DAY_PALETTES` or the panel's dots and the globe's ribbons drift apart. */
const DAY_TOKENS = [
  "--route-neon-cyan",
  "--route-neon-magenta",
  "--route-neon-amber",
  "--route-neon-lime",
  "--route-neon-violet",
];
const dayColorTokenFor = (day: number) => DAY_TOKENS[day % DAY_TOKENS.length];

function AddStopBar({
  search,
  onSearch,
  onSubmit,
  searching,
  pickingOnMap,
  onTogglePick,
  targetDayLabel,
  error,
}: {
  search: string;
  onSearch: (v: string) => void;
  onSubmit: () => void;
  searching: boolean;
  pickingOnMap: boolean;
  onTogglePick: () => void;
  targetDayLabel: string;
  error: string | null;
}) {
  return (
    <div className="border-b border-card-border px-4 py-2.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={`Add a stop to ${targetDayLabel}…`}
            className="w-full rounded-full border border-card-border bg-white/5 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onTogglePick}
          aria-pressed={pickingOnMap}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            pickingOnMap
              ? "bg-accent text-accent-foreground"
              : "border border-card-border text-muted hover:text-foreground"
          }`}
        >
          <MapPin className="h-3 w-3" />
          {pickingOnMap ? "Click the map…" : "From map"}
        </button>
      </div>
      {searching && <p className="mt-1.5 text-xs text-muted">Looking that up…</p>}
      {error && <p className="mt-1.5 text-xs text-amber-200">{error}</p>}
    </div>
  );
}

function NearbyPicker({
  state,
  onPick,
  onDismiss,
}: {
  state: { loading: boolean; pois: { name: string; lat: number; lon: number }[] };
  onPick: (p: { name: string; lat: number; lon: number }) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="border-b border-card-border bg-white/5 px-4 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">What&rsquo;s here</p>
        <button type="button" onClick={onDismiss} className="text-xs text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
      {state.loading ? (
        <p className="text-xs text-muted">Looking…</p>
      ) : state.pois.length === 0 ? (
        // Not an error: a click on water or open ground genuinely has nothing near it, and so
        // does a missing OPENTRIPMAP_API_KEY.
        <p className="text-xs text-muted">
          Nothing listed within a short walk of there. Try a spot closer to a building, or use
          the search box.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {state.pois.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="w-full truncate rounded px-2 py-1 text-left text-xs text-muted transition-colors hover:bg-white/10 hover:text-foreground"
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DaySection({
  day,
  dayIndex,
  dayOffset,
  dayCount,
  showHeading,
  highlighted,
  onHoverStop,
  onFocusStop,
  onEditStop,
  onDeleteStop,
  onMoveStopToDay,
}: {
  day: DayPlan;
  dayIndex: number;
  dayOffset: number;
  dayCount: number;
  showHeading: boolean;
  highlighted: number | null;
  onHoverStop: (flatIndex: number | null) => void;
  onFocusStop: (stop: Stop) => void;
  onEditStop: (stopIndex: number, patch: Partial<Stop>) => void;
  onDeleteStop: (stopIndex: number) => void;
  onMoveStopToDay: (stopIndex: number, toDay: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(dayIndex) });
  const ids = day.stops.map((_, i) => stopDragId(dayIndex, i));

  return (
    <section className="mb-5 last:mb-0">
      {showHeading && (
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ background: `var(${dayColorTokenFor(dayIndex)})` }}
          />
          Day {dayIndex + 1}
          <span className="font-normal text-muted">{formatItineraryDate(day.date)}</span>
        </h3>
      )}
      <div
        ref={setNodeRef}
        className={`space-y-2 rounded-xl transition-colors ${
          isOver ? "bg-accent/10 outline outline-1 outline-accent/40" : ""
        }`}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {day.stops.map((stop, i) => (
            <EditableStopCard
              key={ids[i]}
              id={ids[i]}
              stop={stop}
              dayIndex={dayIndex}
              stopIndex={i}
              dayCount={dayCount}
              highlighted={highlighted === dayOffset + i}
              onHover={(on) => onHoverStop(on ? dayOffset + i : null)}
              onFocus={() => onFocusStop(stop)}
              onEdit={(patch) => onEditStop(i, patch)}
              onDelete={() => onDeleteStop(i)}
              onMoveToDay={(toDay) => onMoveStopToDay(i, toDay)}
            />
          ))}
        </SortableContext>
        {day.stops.length === 0 && (
          <p className="rounded-xl border border-dashed border-card-border px-3 py-4 text-center text-xs text-muted">
            Nothing planned. Drop a stop here, or add one above.
          </p>
        )}
      </div>
    </section>
  );
}

function EditableStopCard({
  id,
  stop,
  dayIndex,
  stopIndex,
  dayCount,
  highlighted,
  onHover,
  onFocus,
  onEdit,
  onDelete,
  onMoveToDay,
}: {
  id: string;
  stop: Stop;
  dayIndex: number;
  stopIndex: number;
  dayCount: number;
  highlighted: boolean;
  onHover: (on: boolean) => void;
  onFocus: () => void;
  onEdit: (patch: Partial<Stop>) => void;
  onDelete: () => void;
  onMoveToDay: (toDay: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onFocus}
      className={`rounded-xl border px-2.5 py-2 transition-colors ${
        isDragging ? "opacity-40" : ""
      } ${
        highlighted ? "border-accent/60 bg-accent/10" : "border-card-border bg-white/5"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* The grip is the only drag handle here, unlike ArrangeBoard where the whole card was
            one — these cards carry text inputs, and a card-wide handle would swallow the caret. */}
        <button
          type="button"
          ref={setNodeRef as unknown as React.Ref<HTMLButtonElement>}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${stop.name}`}
          className="mt-0.5 shrink-0 cursor-grab touch-none text-muted transition-colors hover:text-foreground active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1 space-y-1">
          <input
            ref={inputRef}
            value={stop.name}
            onChange={(e) => onEdit({ name: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            aria-label="Stop name"
            className="w-full truncate rounded bg-transparent text-sm font-medium text-foreground focus:bg-white/10 focus:outline-none"
          />
          <div className="flex items-center gap-1.5">
            <input
              value={stop.time}
              onChange={(e) => onEdit({ time: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              aria-label="Time"
              className="w-16 shrink-0 rounded bg-transparent text-xs text-muted focus:bg-white/10 focus:outline-none"
            />
            <input
              value={stop.note}
              onChange={(e) => onEdit({ note: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              aria-label="Note"
              placeholder="Note…"
              className="min-w-0 flex-1 truncate rounded bg-transparent text-xs text-muted placeholder:text-muted/60 focus:bg-white/10 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {dayCount > 1 && (
            <select
              value={dayIndex}
              onChange={(e) => onMoveToDay(Number(e.target.value))}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Move ${stop.name} to another day`}
              className="rounded border border-card-border bg-transparent px-1 py-0.5 text-[10px] text-muted focus:outline-none"
            >
              {Array.from({ length: dayCount }, (_, d) => (
                <option key={d} value={d} className="bg-[color:var(--surface-deep,#0f172a)]">
                  D{d + 1}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete ${stop.name}`}
            className="text-muted transition-colors hover:text-amber-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <span className="sr-only">{`Stop ${stopIndex + 1}`}</span>
    </div>
  );
}
