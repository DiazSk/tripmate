import type { DietaryNeeds } from "./travelerProfile";

/**
 * The traveler's dietary restrictions, rendered as a prompt block. Its own module rather
 * than a helper inside `itineraryPrompt.ts` for the same reason `travelerProfilePrompt.ts`
 * is: that file imports `TIERS` as a value, which makes it unloadable from a `.test.mjs`
 * under Node's type-stripping. A silently-dropped allergy is the worst failure this
 * feature can have, so it gets to be tested.
 *
 * Returns "" when there is nothing to say, so a traveler with no restrictions produces a
 * byte-identical prompt to the one this app sent before dietary needs existed.
 */
export function formatDietary(dietary: DietaryNeeds | null): string {
  if (!dietary) return "";

  const note = dietary.note.trim();
  const parts: string[] = [];
  if (dietary.tags.length > 0) parts.push(dietary.tags.join(", "));
  if (note) parts.push(note);
  if (parts.length === 0) return "";

  return `\nDietary needs: ${parts.join("; ")}. Every food stop must have something that genuinely fits — name what to order or which counter to use in that stop's "note", and never route the day through somewhere they would have nothing to eat. This constrains which food stops are chosen; it is not a remark to append to them.\n`;
}
