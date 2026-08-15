"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import EditChatPanel from "./EditChatPanel";
import DayTimeline, { ChangedStops } from "./DayTimeline";
import { Itinerary, TripSummary, UserAnswers } from "@/lib/types";
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
  dirty: boolean;
  saving?: boolean;
  onDraftChange: (next: Itinerary) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [changed, setChanged] = useState<ChangedStops>(new Set());
  const [busy, setBusy] = useState(false);
  // Below `lg` the two panes can't sit side by side, so they become tabs instead of a scroll war.
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("chat");
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const day = draft.days[dayIndex];
  if (!day) return null;

  return (
    <section
      className="glass-itinerary pointer-events-auto flex h-[min(78vh,760px)] flex-col overflow-hidden rounded-2xl"
      aria-label={`Editing day ${dayIndex + 1}`}
      {...devLabel("FocusEditMode")}
    >
      <header className="flex items-center justify-between gap-3 border-b border-card-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-semibold text-foreground">
            Editing Day {dayIndex + 1}
            <span className="font-normal text-muted"> — {day.date}</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {scope === "trip" ? "Changes can span the whole trip" : "Changes stay on this day"}
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
          <p className="text-sm text-foreground">Discard the changes you made to this day?</p>
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
          <p className="text-sm text-foreground">Day updated — happy with it?</p>
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
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-white/10">
        <div className={`min-h-0 ${mobilePane === "chat" ? "" : "hidden"} lg:block`}>
          <EditChatPanel
            trip={trip}
            userAnswers={userAnswers}
            itinerary={draft}
            dayIndex={scope === "day" ? dayIndex : undefined}
            tripId={tripId}
            onBusyChange={setBusy}
            onItineraryChange={(next) => {
              setChanged(diffChangedStops(draft, next, dayIndex));
              onDraftChange(next);
            }}
          />
        </div>
        <div className={`min-h-0 ${mobilePane === "preview" ? "" : "hidden"} lg:block`}>
          <DayTimeline day={day} dayIndex={dayIndex} changed={changed} busy={busy} />
        </div>
      </div>
    </section>
  );
}
