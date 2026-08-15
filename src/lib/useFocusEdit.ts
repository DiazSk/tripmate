"use client";

import { useCallback, useState } from "react";
import { Itinerary } from "./types";

export interface FocusTarget {
  dayIndex: number;
  /** "day" edits one day; "trip" lets the conversation range across the whole plan while the
   *  preview still shows one day at a time. */
  scope: "day" | "trip";
}

/**
 * Focus Mode's draft buffer.
 *
 * Editing outside focus mode persists on every change, but focus mode offers Save/Cancel — which
 * only means something if the edits are held somewhere revertible first. So entering focus mode
 * snapshots the itinerary, every AI turn mutates the snapshot (that's what the live preview
 * renders), and nothing reaches the real itinerary or the database until Save.
 */
export function useFocusEdit(source: Itinerary | null) {
  const [target, setTarget] = useState<FocusTarget | null>(null);
  const [draft, setDraft] = useState<Itinerary | null>(null);
  const [dirty, setDirty] = useState(false);

  const open = useCallback(
    (dayIndex: number, scope: FocusTarget["scope"] = "day") => {
      if (!source) return;
      setDraft(structuredClone(source));
      setTarget({ dayIndex, scope });
      setDirty(false);
    },
    [source]
  );

  /** Called on every AI turn — updates the preview without committing anything.
   *
   *  The edit route returns the itinerary on every turn, including turns that changed nothing
   *  (a question, or a clarification the model asked back). Comparing before flagging dirty is
   *  what stops "unsaved changes" appearing after a conversation that only asked something. */
  const applyDraft = useCallback((next: Itinerary) => {
    setDraft((current) => {
      if (current && JSON.stringify(current) === JSON.stringify(next)) return current;
      setDirty(true);
      return next;
    });
  }, []);

  const cancel = useCallback(() => {
    setTarget(null);
    setDraft(null);
    setDirty(false);
  }, []);

  /** Hands the caller the plan to commit + persist, then closes. Returns null if nothing changed,
   *  so a no-op save doesn't trigger a pointless write. */
  const save = useCallback((): Itinerary | null => {
    const committed = dirty ? draft : null;
    setTarget(null);
    setDraft(null);
    setDirty(false);
    return committed;
  }, [draft, dirty]);

  return { target, draft, dirty, open, applyDraft, cancel, save };
}
