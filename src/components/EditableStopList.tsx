"use client";

import { useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, KeyboardSensor, MeasuringStrategy, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";

import { Stop, StopCategory } from "@/lib/types";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { dropCollision, parseDragId, stopDragId } from "@/lib/dragDrop";
import { devLabel } from "@/lib/devInspector";
import AutoTextarea from "./AutoTextarea";
import { EntryIcon, FoodIcon, PinIcon, TransitIcon } from "./icons";

/**
 * The editing half of `StopList`, and deliberately a near-copy of its geometry rather than a
 * shared abstraction.
 *
 * Every measurement here is lifted from `StopList` unchanged — the `space-y-4` between rows, the
 * `flex gap-3`, the 2.5rem avatar, the connector at `top-11 left-5` with its
 * `h-[calc(100%-1.75rem)]`, and the type scale of each line. That duplication is the feature: the
 * whole point of editing in place is that switching modes moves nothing, and the only way a row
 * of inputs lands on the same pixels as the row of text it replaces is if it is built from the
 * same numbers. **Change one of these and you have to change the other**, which is a real cost
 * and is the cost being chosen over the alternative.
 *
 * A shared row component parameterised by `editing` was tried first on paper and is worse. The
 * read-only row is a single `<button>` wrapping the whole stop — one tab stop, one click target,
 * a `Typewriter` on the name during the reveal stagger, `whileInView` motion. The edit row is
 * five focusable fields plus a grip and a delete, has to *not* be a button (a button cannot
 * contain a textarea), and must not animate on mount or every keystroke that reorders the list
 * would replay the entrance. The two share their measurements and almost nothing else, so a
 * merged component would be two components behind one prop.
 *
 * The controls are absolutely positioned into the day panel's own left and right padding rather
 * than laid out in flow. In flow they would consume width from the flex row, shifting the avatar
 * and with it the connector line — the "structural layout shift" this mode exists to avoid. In
 * the padding they cost the row nothing, and they are what the `relative` on each row is for.
 */

const CATEGORY_ICON: Record<StopCategory, typeof FoodIcon> = {
  food: FoodIcon,
  entry: EntryIcon,
  transit: TransitIcon,
  other: PinIcon,
};

/** Byte-identical to `StopList`'s, for the reason in the module comment. */
function StopAvatar({ name, category }: { name: string; category: StopCategory }) {
  const photo = usePlacePhoto(name);
  const [failed, setFailed] = useState(false);
  const Icon = CATEGORY_ICON[category ?? "other"];

  return (
    <span className="relative block h-10 w-10 shrink-0">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-tag-neutral-bg text-accent">
        <Icon className="h-4 w-4" />
      </span>
      {photo && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia thumbnails, small/lazy, not worth next/image config
        <img
          src={photo}
          alt=""
          onError={() => setFailed(true)}
          className="value-in absolute inset-0 h-10 w-10 rounded-full object-cover"
        />
      )}
    </span>
  );
}

/**
 * The shared look of every field in this list.
 *
 * Borderless at rest — the row has to read as the plan it is, not as a form — and it grows a
 * hairline glass fill on hover and focus so the editable area is discoverable without being
 * permanently drawn. `bg-white/[0.07]` plus a `white/10` hairline is the same *material* as the
 * panel it sits in, one step up in alpha.
 *
 * **No `backdrop-filter`.** These are glass by fill, not by blur, and that is on purpose: this
 * list already sits inside `.glass-itinerary`'s 56px pass, so there is nothing behind a field
 * left to blur, and a filtered element is a render surface — up to ~40 of them on a long day,
 * each re-rastering on the keystroke that resizes it. The budget tiles in `ItineraryCard` record
 * the same decision for the same reason.
 *
 * `-mx-1.5 px-1.5` bleeds the fill slightly wider than the text so the caret never sits on the
 * fill's edge, while the text itself stays on the exact x-position it occupies when read-only.
 */
const FIELD =
  "-mx-1.5 w-[calc(100%+0.75rem)] rounded-md border border-transparent bg-transparent px-1.5 transition-colors hover:border-white/10 hover:bg-white/[0.07] focus:border-white/10 focus:bg-white/[0.07] focus:outline-none";

function EditableStopRow({
  stop,
  dayIndex,
  stopIndex,
  isLast,
  isHighlighted,
  onHover,
  onEdit,
  onDelete,
}: {
  stop: Stop;
  dayIndex: number;
  stopIndex: number;
  isLast: boolean;
  isHighlighted: boolean;
  onHover: (hovered: boolean) => void;
  onEdit: (patch: Partial<Stop>) => void;
  onDelete: () => void;
}) {
  const id = stopDragId(dayIndex, stopIndex);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      // `group` drives the reveal of the grip and the bin. Every other class here is StopList's.
      className={`group relative flex gap-3 rounded-xl transition-colors ${
        isDragging ? "opacity-40" : ""
      } ${isHighlighted ? "bg-white/10" : "hover:bg-white/5"}`}
      {...devLabel("EditableStopList.Row")}
    >
      {!isLast && (
        <div className="absolute top-11 left-5 h-[calc(100%-1.75rem)] w-px bg-card-border" />
      )}

      {/* Sits in the day panel's left padding — see the module comment. Fades in on hover or when
          anything in the row has focus, so a keyboard user can find it too. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${stop.name || "this stop"}`}
        className="absolute top-2.5 -left-4 z-20 cursor-grab touch-none rounded text-muted opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 group-focus-within:opacity-60 group-hover:opacity-60 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <StopAvatar name={stop.name} category={stop.category} />

      <span className="min-w-0 flex-1">
        <input
          value={stop.name}
          onChange={(e) => onEdit({ name: e.target.value })}
          aria-label={`Stop ${stopIndex + 1} name`}
          placeholder="Name this stop…"
          // `font-medium text-foreground` at the inherited base size — StopList's name line.
          className={`${FIELD} font-medium text-foreground placeholder:text-muted/60`}
        />
        {/* Read-only this is one line, `time · durationLabel`. Two fields with a literal
            separator between them keeps that line's height and rhythm while making both halves
            reachable — the separator is not rendered when the read-only row would omit it. */}
        <span className="flex items-center gap-1 text-sm text-muted">
          <input
            value={stop.time}
            onChange={(e) => onEdit({ time: e.target.value })}
            aria-label="Time"
            placeholder="Time"
            className={`${FIELD} w-20 shrink-0 placeholder:text-muted/50`}
          />
          <span aria-hidden="true" className="shrink-0 text-muted/50">·</span>
          <input
            value={stop.durationLabel ?? ""}
            onChange={(e) => onEdit({ durationLabel: e.target.value })}
            aria-label="Duration"
            placeholder="Duration"
            className={`${FIELD} min-w-0 flex-1 placeholder:text-muted/50`}
          />
        </span>
        <AutoTextarea
          value={stop.why ?? ""}
          onChange={(e) => onEdit({ why: e.target.value })}
          aria-label="Why this stop"
          placeholder="Why this stop…"
          className={`${FIELD} mt-1 block text-sm text-foreground/80 placeholder:text-muted/50`}
        />
        <AutoTextarea
          value={stop.note ?? ""}
          onChange={(e) => onEdit({ note: e.target.value })}
          aria-label="Note"
          placeholder="Add a note…"
          className={`${FIELD} mt-0.5 block text-sm text-muted placeholder:text-muted/50`}
        />
      </span>

      {/* Right padding, mirroring the grip. Not `absolute right-0`: that is inside the row, over
          the text. `-right-1` puts it in the gutter the panel already reserves. */}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${stop.name || `stop ${stopIndex + 1}`}`}
        className="absolute top-2.5 -right-1 z-20 rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-amber-200 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 group-focus-within:opacity-60 group-hover:opacity-60"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function EditableStopList({
  stops,
  dayIndex,
  highlightedIndex,
  onHoverStop,
  onEditStop,
  onDeleteStop,
  onReorder,
}: {
  stops: Stop[];
  dayIndex: number;
  /** Row lit by the globe, in this day's own numbering — same contract `StopList` takes. */
  highlightedIndex?: number | null;
  onHoverStop?: (index: number | null) => void;
  onEditStop: (stopIndex: number, patch: Partial<Stop>) => void;
  onDeleteStop: (stopIndex: number) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const [dragging, setDragging] = useState<Stop | null>(null);

  const sensors = useSensors(
    // 6px, so a click landing on a field's caret is never read as the start of a drag. The same
    // threshold both other drag surfaces in the app use.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const ids = stops.map((_, i) => stopDragId(dayIndex, i));

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const from = parseDragId(event.active.id);
    const to = parseDragId(event.over?.id);
    if (from?.kind !== "stop" || to?.kind !== "stop") return;
    if (from.stopIndex === to.stopIndex) return;
    onReorder(from.stopIndex, to.stopIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dropCollision}
      // Rows change height as their textareas grow, so cached rects go stale mid-drag.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={(e: DragStartEvent) => {
        const from = parseDragId(e.active.id);
        if (from?.kind === "stop") setDragging(stops[from.stopIndex] ?? null);
      }}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      {/* `space-y-4`, from StopList. */}
      <div className="space-y-4" {...devLabel("ItineraryCard.EditableStopList")}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {stops.map((stop, i) => (
            <EditableStopRow
              key={ids[i]}
              stop={stop}
              dayIndex={dayIndex}
              stopIndex={i}
              isLast={i === stops.length - 1}
              isHighlighted={highlightedIndex === i}
              onHover={(hovered) => onHoverStop?.(hovered ? i : null)}
              onEdit={(patch) => onEditStop(i, patch)}
              onDelete={() => onDeleteStop(i)}
            />
          ))}
        </SortableContext>
      </div>

      {/* Portalled by dnd-kit, so the dragged row is not clipped by the panel's scroll box. */}
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="pointer-events-none rounded-xl border border-accent/50 bg-[color:var(--surface-deep,#0f172a)] px-3 py-2 text-sm font-medium text-foreground shadow-2xl">
            {dragging.name || "Untitled stop"}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
