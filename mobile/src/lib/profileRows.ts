import type { AccessibilityNeeds, TravelerProfile } from '@/api/types';

/**
 * What a profile row says about itself.
 *
 * **These strings are the reason the screen reads as a profile rather than a form.** A row that
 * shows `3 chosen, 2 starred` is a summary you can scan; the same information as seventeen chips
 * is a questionnaire. Ported from the Swift app's `interestsValue`/`dietaryValue`, including the
 * touches that keep them reading like prose rather than like a count.
 *
 * Pure and here rather than inline in JSX because every one of them is a branch, and "1 noted" is
 * exactly the sort of thing that looks fine until somebody has one dietary tag.
 */

/** `None yet` · `3 chosen` · `3 chosen, 2 starred`. */
export function interestsValue(profile: Pick<TravelerProfile, 'priorities' | 'topPriorities'>): string {
  const chosen = profile.priorities.length;
  if (chosen === 0) return 'None yet';
  const starred = profile.topPriorities.length;
  return starred === 0 ? `${chosen} chosen` : `${chosen} chosen, ${starred} starred`;
}

/**
 * `Nothing noted` · `A note` · `Vegetarian` · `2 noted`.
 *
 * A single tag prints **its own name**, because "1 noted" makes the reader open the sheet to learn
 * something that fits in the row. A note with no tags is `A note` rather than being counted —
 * there is nothing to count, but there is something there, and saying "Nothing noted" would be
 * false about the one field where being wrong means a meal somebody cannot eat.
 */
export function dietaryValue(profile: Pick<TravelerProfile, 'dietary'>): string {
  const { tags, note } = profile.dietary;
  if (tags.length === 0) return note.trim() ? 'A note' : 'Nothing noted';
  if (tags.length === 1) return tags[0];
  return `${tags.length} noted`;
}

/**
 * `No requirements` · `Step-free routes` · `Step-free routes, few stairs` · `A note`.
 *
 * Named the way the two toggles are asked, not as "2 set": these are hard constraints that
 * outrank pace and interest when the plan is written, and a Review step exists so somebody can
 * see one is missing before the model spends a minute honouring the wrong thing. Same reason
 * `dietaryValue` spells a lone tag out instead of counting it.
 */
export function accessibilityValue(needs: AccessibilityNeeds): string {
  const set = [
    needs.stepFreeRequired ? 'Step-free routes' : null,
    needs.limitStairs ? 'few stairs' : null,
  ].filter(Boolean);
  if (set.length > 0) return set.join(', ');
  return needs.note.trim() ? 'A note' : 'No requirements';
}
