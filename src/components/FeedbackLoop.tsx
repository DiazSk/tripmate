/**
 * Where the plan's automatic draft has got to. `null` means no draft is being tracked at all.
 */
export type DraftState = "pending" | "saved" | "failed" | "offline" | null;

/** Copy rows W-16/W-17: the Keep line's note on `/`'s unsaved board (HomeView). */
export function draftFailedNote(state: DraftState): string {
  return state === "offline"
    ? "You’re offline, so this plan isn’t saved yet. Leave this tab open and press Keep this trip once you’re back online."
    : "A draft of this plan didn’t save, so it isn’t in your memories yet. Press Keep this trip to save it.";
}
