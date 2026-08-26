"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useHoverPeekSuspended } from "@/lib/mapCamera";
import EditChatPanel from "./EditChatPanel";
import DayTimeline, { ChangedStops } from "./DayTimeline";
import { Itinerary, Stop, TripSummary, UserAnswers } from "@/lib/types";
import { evaluateItinerary } from "@/lib/guardrails";
import { insertionIndexByTime, moveStop } from "@/lib/schedule";
import { dayDropId, dropCollision, parseDragId, useDayDwellSwitch } from "@/lib/dragDrop";
import { devLabel } from "@/lib/devInspector";

/** Stops the last turn added OR edited in place. Name alone isn't enough: a turn that shifts a
 *  stop's time or rewrites its note changes nothing about the name, and that edit still needs to
 *  be visible in the preview. */
function diffChangedStops(prev: Itinerary, next: Itinerary, dayIndex: number): ChangedStops {
  const before = new Map(
    (prev.days[dayIndex]?.stops ?? []).map((s) => [s.name, JSON.stringify(s)] as const)
  );
  const changed: ChangedStops = new Set();
  for (const stop of next.days[dayIndex]?.stops ?? []) {
    const was = before.get(stop.name);
    if (was === undefined || was !== JSON.stringify(stop)) changed.add(stop.name);
  }
  return changed;
}

/** Which days a turn actually touched, as indexes. Whole-trip chat can move a stop from one day
 *  to another, and the preview shows one day at a time — without this the stop just vanishes from
 *  the day on screen and is never seen landing anywhere. */
function changedDayIndexes(prev: Itinerary, next: Itinerary): number[] {
  const shape = (it: Itinerary, i: number) =>
    JSON.stringify({ stops: it.days[i]?.stops ?? [], lodging: it.days[i]?.lodging ?? null });
  const indexes: number[] = [];
  for (let i = 0; i < Math.max(prev.days.length, next.days.length); i++) {
    if (shape(prev, i) !== shape(next, i)) indexes.push(i);
  }
  return indexes;
}

/**
 * A plain day-stepper arrow. Deliberately NOT a drop target.
 *
 * It used to be one, with an id derived from the day on screen (`day:previewIndex - 1`). That made
 * the target's meaning change the instant a dwell switched days: the arrow under a stationary
 * pointer stopped being "day 1", the collision then resolved to the opposite arrow, and the view
 * ping-ponged between two days. Cross-day drops belong on the numbered chips beside these, whose
 * ids are absolute and so mean the same day before and after a switch.
 */
function DayStepButton({
  disabled,
  label,
  onClick,
  children,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * One numbered day in the preview's day strip: click to view it, or hold a dragged stop over it to
 * open that day and drop the stop into an exact slot.
 *
 * The strip exists because the arrows alone only reach the adjacent day — on a two-week trip,
 * moving a stop from day 1 to day 9 meant hovering through eight of them.
 */
function DayDropChip({
  dayIndex,
  date,
  isActive,
  dragging,
  onClick,
}: {
  dayIndex: number;
  date: string;
  isActive: boolean;
  dragging: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(dayIndex) });
  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={onClick}
      aria-current={isActive ? "true" : undefined}
      title={dragging ? `Hold to open day ${dayIndex + 1}, or drop to move it here` : `Day ${dayIndex + 1} — ${date}`}
      className={`h-7 min-w-7 shrink-0 rounded-full px-2 text-xs font-medium transition-all ${
        isOver
          ? "bg-accent text-accent-foreground ring-2 ring-accent"
          : isActive
            ? "bg-white/20 text-foreground"
            : dragging
              ? "text-muted ring-1 ring-accent/40"
              : "text-muted hover:bg-white/10 hover:text-foreground"
      }`}
    >
      {dayIndex + 1}
    </button>
  );
}

/**
 * Focus Mode — the result card becomes a dedicated two-pane workspace for one day.
 *
 * Replaces the card's whole standard view (budget bar, day tabs and cost footers are not rendered
 * at all here rather than hidden with CSS), and replaces the floating chat overlay that used to
 * sit over the globe. Everything the user needs to judge an edit is inside one frame: the
 * conversation on the left, the day it is changing on the right.
 *
 * Edits land in a draft the host owns — nothing is committed until Save.
 */
export default function FocusEditMode({
  trip,
  userAnswers,
  draft,
  dayIndex,
  scope,
  tripId,
  sessionId,
  dirty,
  saving,
  onDraftChange,
  onSave,
  onCancel,
}: {
  trip: TripSummary;
  userAnswers?: UserAnswers | null;
  draft: Itinerary;
  dayIndex: number;
  scope: "day" | "trip";
  tripId?: string | null;
  /** Passed straight through to the chat panel — see EditChatPanel. */
  sessionId?: string | null;
  dirty: boolean;
  saving?: boolean;
  onDraftChange: (next: Itinerary) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  // The globe's hover peek answers "which stop is this?" while reading a plan. While editing one
  // it is noise at best: the pointer is here to drag stops and read chat turns, and a camera that
  // dives at whatever a marker card happened to be under is moving the ground mid-edit.
  useHoverPeekSuspended();

  const [changed, setChanged] = useState<ChangedStops>(new Set());
  // Which day the preview is showing. Starts on the day the user opened, then follows the edit:
  // in trip scope a turn may change a day other than the one on screen. Day scope never moves it,
  // since the chat there is forbidden from touching another day.
  const [previewDayIndex, setPreviewDayIndex] = useState(dayIndex);
  const [busy, setBusy] = useState(false);
  // Below `lg` the two panes can't sit side by side, so they become tabs instead of a scroll war.
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("chat");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  /** The stop in flight plus the day it came from, so a mid-drag day change can't lose track of it. */
  const [dragging, setDragging] = useState<{
    dayIndex: number;
    stopIndex: number;
    stop: Stop;
  } | null>(null);

  // 6px before a drag starts, so a tap on the handle still behaves like a tap.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const dayCount = draft.days.length;
  const previewIndex = Math.min(previewDayIndex, dayCount - 1);
  const day = draft.days[previewIndex];
  // Only whole-trip scope can range across days; a day-scoped chat has exactly one to show.
  const canBrowseDays = scope === "trip" && dayCount > 1;

  // Findings for the day on screen plus trip-wide ones, recomputed from the draft so a
  // hand-rearrangement is judged the instant it lands — no model turn required.
  const findings = useMemo(
    () =>
      draft
        ? evaluateItinerary(draft, { budget: trip.budget }).filter(
            (f) => f.dayIndex === previewIndex || f.dayIndex === null
          )
        : [],
    [draft, trip.budget, previewIndex]
  );

  const dwell = useDayDwellSwitch((next) => setPreviewDayIndex(next));

  if (!day) return null;

  /** Reorder inside the previewed day, or hand the stop to another day via the stepper arrows. */
  const onDragEnd = (event: DragEndEvent) => {
    dwell.clear();
    const source = dragging;
    setDragging(null);
    const { over } = event;
    if (!over || !source) return;

    const target = parseDragId(over.id);
    if (!target) return;
    const from = { dayIndex: source.dayIndex, stopIndex: source.stopIndex };

    // On a row: that exact slot, on that row's own day.
    if (target.kind === "stop") {
      if (target.dayIndex === from.dayIndex && target.stopIndex === from.stopIndex) return;
      const next = moveStop(draft, from, {
        dayIndex: target.dayIndex,
        stopIndex: target.stopIndex,
      });
      setPreviewDayIndex(target.dayIndex);
      setChanged(
        target.dayIndex === from.dayIndex
          ? diffChangedStops(draft, next, target.dayIndex)
          : new Set([source.stop.name])
      );
      onDraftChange(next);
      return;
    }

    // On an arrow: no slot was chosen, so place it by clock time.
    if (target.dayIndex === from.dayIndex) return;
    const at = insertionIndexByTime(draft.days[target.dayIndex], source.stop);
    const next = moveStop(draft, from, { dayIndex: target.dayIndex, stopIndex: at });
    setPreviewDayIndex(target.dayIndex);
    setChanged(new Set([source.stop.name]));
    onDraftChange(next);
  };

  /** Holding a stop over an arrow opens that day, so it can then be dropped into an exact slot. */
  const onDragOver = (event: DragOverEvent) => {
    const target = parseDragId(event.over?.id);
    dwell.noteOver(
      target?.kind === "day" && target.dayIndex !== previewIndex ? target.dayIndex : null
    );
  };

  return (
    <section
      className="glass-itinerary pointer-events-auto flex h-[min(78vh,760px)] flex-col overflow-hidden rounded-2xl"
      aria-label={scope === "trip" ? "Refining the whole trip" : `Editing day ${dayIndex + 1}`}
      {...devLabel("FocusEditMode")}
    >
      <header className="flex items-center justify-between gap-3 border-b border-card-border px-4 py-3">
        <div className="min-w-0">
          {/* In trip scope this used to read "Editing Day 1" no matter which day a turn actually
              changed, which made a whole-trip refine look day-scoped. */}
          <h3 className="truncate font-display text-base font-semibold text-foreground">
            {scope === "trip" ? (
              <>
                Refining your trip
                <span className="font-normal text-muted">
                  {" "}
                  — {dayCount} day{dayCount > 1 ? "s" : ""}
                </span>
              </>
            ) : (
              <>
                Editing Day {dayIndex + 1}
                <span className="font-normal text-muted"> — {day.date}</span>
              </>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {scope === "trip"
              ? `Any day · showing day ${previewIndex + 1} of ${dayCount}`
              : "Changes stay on this day"}
            {dirty && <span className="text-accent"> · unsaved changes</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => (dirty ? setConfirmingCancel(true) : onCancel())}
            aria-label="Cancel editing"
            title={dirty ? "Discard changes" : "Close"}
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Discarding real work should take a deliberate second action, not a stray click on ✕. */}
      {confirmingCancel && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2.5">
          <p className="text-sm text-foreground">
            Discard the changes you made to {scope === "trip" ? "this trip" : "this day"}?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingCancel(false)}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-white/10"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full bg-red-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* "Are you done?" — surfaced only once something has actually changed, so the answer is
          always meaningful. Saving from here is the same action as the header button. */}
      {dirty && !confirmingCancel && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/25 bg-accent/10 px-4 py-2.5">
          <p className="text-sm text-foreground">
            {scope === "trip" ? "Trip" : "Day"} updated — happy with it?
          </p>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Yes, save it"}
          </button>
        </div>
      )}

      {/* Pane switcher, small screens only. */}
      <div className="flex gap-1 border-b border-card-border px-3 py-2 lg:hidden">
        {(["chat", "preview"] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            onClick={() => setMobilePane(pane)}
            aria-pressed={mobilePane === pane}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
              mobilePane === pane ? "bg-accent text-accent-foreground" : "bg-white/10 text-muted"
            }`}
          >
            {pane}
          </button>
        ))}
      </div>

      {/* Equal halves at lg+; one pane at a time below it. min-h-0 on both the grid and its
          children is what lets the inner panes scroll instead of stretching the card. */}
      <DndContext
        sensors={sensors}
        collisionDetection={dropCollision}
        // The previewed day can change mid-drag, which replaces every row in the pane.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={(e: DragStartEvent) => {
          const from = parseDragId(e.active.id);
          if (from?.kind !== "stop") return;
          const stop = draft.days[from.dayIndex]?.stops[from.stopIndex];
          if (stop) setDragging({ dayIndex: from.dayIndex, stopIndex: from.stopIndex, stop });
        }}
        onDragOver={onDragOver}
        onDragCancel={() => {
          dwell.clear();
          setDragging(null);
        }}
        onDragEnd={onDragEnd}
      >
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-white/10">
        <div className={`min-h-0 ${mobilePane === "chat" ? "" : "hidden"} lg:block`}>
          <EditChatPanel
            trip={trip}
            userAnswers={userAnswers}
            itinerary={draft}
            dayIndex={scope === "day" ? dayIndex : undefined}
            tripId={tripId}
            sessionId={sessionId}
            onBusyChange={setBusy}
            onItineraryChange={(next) => {
              // Jump the preview to the first day the turn changed, so a stop moved to another
              // day is watched landing there rather than just disappearing from this one.
              const touched = changedDayIndexes(draft, next);
              const show = touched[0] ?? previewIndex;
              setPreviewDayIndex(show);
              setChanged(diffChangedStops(draft, next, show));
              onDraftChange(next);
            }}
          />
        </div>
        <div className={`flex min-h-0 flex-col ${mobilePane === "preview" ? "" : "hidden"} lg:flex`}>
          {/* A whole-trip refine can change any day, so the preview has to reach any day. Without
              this the pane was pinned to the day the user happened to open from. The arrows double
              as drop targets while a stop is in flight. */}
          {canBrowseDays && (
            <div className="border-b border-card-border px-3 py-2">
              <div className="flex items-center gap-2">
                <DayStepButton
                  disabled={previewIndex === 0}
                  label="Preview previous day"
                  onClick={() => setPreviewDayIndex(Math.max(0, previewIndex - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </DayStepButton>
                {/* Every day is one hover away, and every chip's id is the day it names — so the
                    target under the pointer still means the same day after a switch. Scrollable
                    rather than wrapping, so the strip's height can't change mid-drag and move the
                    targets out from under the pointer. */}
                <div className="scrollbar-none flex flex-1 items-center justify-center gap-1 overflow-x-auto">
                  {draft.days.map((d, i) => (
                    <DayDropChip
                      key={i}
                      dayIndex={i}
                      date={d.date}
                      isActive={i === previewIndex}
                      dragging={dragging !== null}
                      onClick={() => setPreviewDayIndex(i)}
                    />
                  ))}
                </div>
                <DayStepButton
                  disabled={previewIndex === dayCount - 1}
                  label="Preview next day"
                  onClick={() => setPreviewDayIndex(Math.min(dayCount - 1, previewIndex + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </DayStepButton>
              </div>
              {/* Always rendered, whatever it says: swapping this line in and out mid-drag would
                  change the header's height and shift every drop target above the list. */}
              <p className="mt-1 truncate text-center text-[11px] text-muted/80">
                {dragging !== null ? (
                  <span className="text-accent">Hold over a day to open it, then drop where you want</span>
                ) : (
                  <>
                    Day {previewIndex + 1} of {dayCount} · {day.date}
                  </>
                )}
              </p>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DayTimeline
              day={day}
              dayIndex={previewIndex}
              changed={changed}
              busy={busy}
              draggable={!busy}
            />

            {/* Guardrails on the draft, so a drag is judged before it is ever saved. */}
            {findings.length > 0 && (
              <ul className="space-y-1.5 px-4 pb-3">
                {findings.map((finding, i) => (
                  <li
                    key={i}
                    className="flex gap-1.5 rounded-lg bg-amber-400/10 px-2.5 py-2 text-xs text-amber-200"
                  >
                    <span aria-hidden="true">⚠️</span>
                    <span>{finding.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Portalled so the dragged row isn't clipped by the preview pane's own scroll box. */}
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="pointer-events-none rounded-lg border border-accent/40 bg-[color:var(--surface-deep,#0f172a)] px-3 py-1.5 text-sm font-medium text-foreground shadow-2xl">
            {dragging.stop.name}
          </div>
        )}
      </DragOverlay>
      </DndContext>
    </section>
  );
}
