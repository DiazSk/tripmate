"use client";

import { useEffect, useMemo, useState } from "react";
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
import { GripVertical, X } from "lucide-react";

import { DayPlan, Itinerary, Stop, TripSummary } from "@/lib/types";
import { dayDropId, dropCollision, parseDragId, stopDragId } from "@/lib/dragDrop";
import { evaluateItinerary, Guardrail } from "@/lib/guardrails";
import { insertionIndexByTime, moveStop } from "@/lib/schedule";
import { dayPlanned } from "@/lib/itinerary";
import { formatItineraryDate } from "@/lib/itinerary";
import { formatMoney } from "@/lib/format";
import { DayEditUpdates } from "./DayHeader";
import { devLabel } from "@/lib/devInspector";

/**
 * The arrange board — every day of the trip on one page, side by side, so a stop can be dragged
 * from any day to any other day directly.
 *
 * This replaces rearranging inside the itinerary card. In the card only one day is ever on screen,
 * so a cross-day move meant dragging onto a day *tab* and holding it there until that day opened —
 * a gesture that had to be explained, and that never showed the traveller the day they were aiming
 * at until they had already committed to it. Here both ends of the move are visible the whole time,
 * which is the thing that actually makes dragging worth doing.
 *
 * Days are a wrapping grid rather than one horizontally-scrolling row: on a ten-day trip the later
 * days land on a second and third row and are reached by scrolling DOWN, which is the direction
 * every other page scrolls. A single long row would put day 10 behind a horizontal scrollbar most
 * people never touch.
 */

/** One stop, as a card. The whole card is the drag handle here — unlike the itinerary card's list,
 *  nothing on this surface competes for the click, so there is no reason to make people find a
 *  4px grip. */
function StopCard({
  stop,
  dayIndex,
  index,
}: {
  stop: Stop;
  dayIndex: number;
  index: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stopDragId(dayIndex, index) });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-40" : ""}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex cursor-grab touch-none gap-2 rounded-xl border border-card-border bg-white/5 p-2.5 transition-colors hover:border-accent/40 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:cursor-grabbing"
      >
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted/50" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{stop.name}</div>
          <div className="mt-0.5 text-xs text-muted">
            {[stop.time, stop.durationLabel, stop.cost ? formatMoney(stop.cost) : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>
    </li>
  );
}

/** One day, as a column. The column itself is a drop target so a stop can be moved onto a day that
 *  has nothing in it yet — with only the cards droppable, an empty day is unreachable. */
function DayColumn({
  day,
  dayIndex,
  findings,
  editable,
  onRename,
}: {
  day: DayPlan;
  dayIndex: number;
  findings: Guardrail[];
  editable?: boolean;
  onRename?: (dayIndex: number, updates: DayEditUpdates) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(dayIndex) });

  return (
    <section
      ref={setNodeRef}
      aria-label={`Day ${dayIndex + 1}`}
      className={`flex min-h-48 flex-col rounded-2xl border p-3 transition-colors ${
        isOver ? "border-accent bg-accent/10" : "border-card-border bg-white/[0.03]"
      }`}
    >
      <header className="mb-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Day {dayIndex + 1}</h3>
          <span className="text-[11px] text-muted">{formatItineraryDate(day.date)}</span>
        </div>
        {editable && onRename ? (
          <input
            // Uncontrolled, keyed by the day it belongs to — the same shape as the lodging "Actual"
            // input on the itinerary card. A controlled copy would need a prop-to-state effect,
            // and the key already gives the one behaviour that needs: re-initialise when this
            // column starts showing a different day.
            key={`${dayIndex}-${day.date}`}
            defaultValue={day.title ?? ""}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== (day.title ?? "")) onRename?.(dayIndex, { title: next });
            }}
            onKeyDown={(e) => {
              // Enter commits, because a name typed and left uncommitted is a name silently lost.
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = day.title ?? "";
                e.currentTarget.blur();
              }
            }}
            placeholder="Name this day…"
            aria-label={`Name for day ${dayIndex + 1}`}
            className="mt-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted placeholder:text-muted/50 hover:border-card-border focus:border-accent focus:bg-white/10 focus:text-foreground focus:outline-none"
          />
        ) : (
          day.title && <p className="mt-1 truncate px-1 text-xs text-muted">{day.title}</p>
        )}
        <div className="mt-1 px-1 text-[11px] text-muted/70">
          {day.stops.length} {day.stops.length === 1 ? "stop" : "stops"}
          {day.stops.length > 0 && ` · ${formatMoney(dayPlanned(day))}`}
        </div>
      </header>

      {/* Findings for this day sit in the column, where the day they describe is. */}
      {findings.length > 0 && (
        <ul className="mb-2 space-y-1">
          {findings.map((finding, i) => (
            <li
              key={i}
              className="flex gap-1 rounded-md bg-amber-400/10 px-1.5 py-1 text-[11px] leading-snug text-amber-200"
            >
              <span aria-hidden="true">⚠️</span>
              <span>{finding.message}</span>
            </li>
          ))}
        </ul>
      )}

      <SortableContext
        items={day.stops.map((_, i) => stopDragId(dayIndex, i))}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex-1 space-y-2">
          {day.stops.length === 0 ? (
            <li className="flex h-20 items-center justify-center rounded-xl border border-dashed border-card-border text-xs text-muted/60">
              Drop a stop here
            </li>
          ) : (
            day.stops.map((stop, i) => (
              <StopCard key={`${stop.name}-${i}`} stop={stop} dayIndex={dayIndex} index={i} />
            ))
          )}
        </ul>
      </SortableContext>
    </section>
  );
}

export default function ArrangeBoard({
  trip,
  itinerary,
  onItineraryChange,
  onEditDay,
  editable,
  onClose,
}: {
  trip: TripSummary;
  itinerary: Itinerary;
  onItineraryChange: (next: Itinerary) => void;
  onEditDay?: (dayIndex: number, updates: DayEditUpdates) => void;
  editable?: boolean;
  onClose: () => void;
}) {
  const [dragging, setDragging] = useState<{ dayIndex: number; stopIndex: number; stop: Stop } | null>(
    null
  );

  const sensors = useSensors(
    // A little travel before a drag starts, so a click on a card's rename field or a stray tap
    // isn't read as the beginning of a move.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const findings = useMemo(
    () => evaluateItinerary(itinerary, { budget: trip.budget }),
    [itinerary, trip.budget]
  );

  // Escape closes, and the page behind mustn't scroll while a full-screen surface is over it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const onDragEnd = (event: DragEndEvent) => {
    const source = dragging;
    setDragging(null);
    const target = parseDragId(event.over?.id);
    if (!source || !target) return;

    const from = { dayIndex: source.dayIndex, stopIndex: source.stopIndex };

    // Onto another card: take that exact slot. Onto a column: no slot was chosen, so place it by
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

  const board = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Arrange itinerary"
      className="fixed inset-0 z-[70] flex flex-col bg-[color:var(--surface-deep,#0f172a)]/97 backdrop-blur-xl"
      {...devLabel("ArrangeBoard")}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-foreground sm:text-lg">
            Arrange {trip.destination.split(",")[0].trim()}
            <span className="font-normal text-muted">
              {" "}
              — {itinerary.days.length} day{itinerary.days.length > 1 ? "s" : ""}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Drag a stop anywhere — within a day or across days. Times recalculate from the travel
            between stops as you go.
          </p>
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
        {/* auto-fill + minmax is what makes ten days wrap onto further rows instead of running off
            the side: as many columns as fit, the rest below, scrolled vertically. */}
        <div
          className="grid flex-1 gap-3 overflow-y-auto p-4 sm:gap-4 sm:p-6"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 16rem), 1fr))",
            alignContent: "start",
          }}
        >
          {itinerary.days.map((day, i) => (
            <DayColumn
              key={i}
              day={day}
              dayIndex={i}
              editable={editable}
              onRename={onEditDay}
              findings={findings.filter((f) => f.dayIndex === i)}
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

      {/* Trip-wide findings (the budget) belong under the board, not in any one day's column. */}
      {findings.some((f) => f.dayIndex === null) && (
        <div className="border-t border-card-border px-4 py-2 sm:px-6">
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

  // Portalled to the body: the card this opens from lives inside a blurred, scrollable docked
  // panel, and `position: fixed` is contained by any ancestor with a filter — so rendered in place
  // this would be trapped in a 520px column instead of covering the screen.
  return typeof document === "undefined" ? null : createPortal(board, document.body);
}
