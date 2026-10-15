import type { AccessibilityNeeds, TravelerProfile } from '@/api/types';

/**
 * What a profile row says about itself.
 *
 * **These strings are the reason the screen reads as a profile rather than a form.** A row that
 * shows `3 chosen, 2 starred` is a summary you can scan; the same information as seventeen chips
 * is a questionnaire. Ported from the Swift app's `dietaryValue`, including the
 * touches that keep them reading like prose rather than like a count.
 *
 * Pure and here rather than inline in JSX because every one of them is a branch, and "1 noted" is
 * exactly the sort of thing that looks fine until somebody has one dietary tag.
 */

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
 * `Nothing noted` · `Step-free routes` · `Step-free routes, few stairs` · `A note`.
 *
 * Named the way the two toggles are asked, not as "2 set": these are hard constraints that
 * outrank pace and interest when the plan is written, and a Review step exists so somebody can
 * see one is missing before the model spends a minute honouring the wrong thing. Same reason
 * `dietaryValue` spells a lone tag out instead of counting it.
 *
 * **`Nothing noted`, not `No requirements`.** What is known is that none were provided; whether
 * this traveller has accessibility requirements is not known, and the old wording answered for
 * them. It is the same error `Not checked` exists to prevent one screen over, and it is now the
 * same word `dietaryValue` already returns in its equivalent branch.
 */
export function accessibilityValue(needs: AccessibilityNeeds): string {
  const set = [
    needs.stepFreeRequired ? 'Step-free routes' : null,
    needs.limitStairs ? 'few stairs' : null,
  ].filter(Boolean);
  if (set.length > 0) return set.join(', ');
  return needs.note.trim() ? 'A note' : 'Nothing noted';
}

/**
 * `Food, Culture & History` · `4 chosen` · `None chosen`.
 *
 * The starred ones when there are any, because they are what drives the plan; otherwise a count,
 * since an unstarred list of six would not fit the row and none of it outranks the rest.
 */
export function interestsValue(profile: Pick<TravelerProfile, 'priorities' | 'topPriorities'>): string {
  if (profile.topPriorities.length) return profile.topPriorities.join(', ');
  return profile.priorities.length ? `${profile.priorities.length} chosen` : 'None chosen';
}

/**
 * The passport page's name fields and its machine-readable line, from the account's name.
 *
 * The MRZ follows the real document's shape (`P<`, an issuer, `SURNAME<<GIVEN`, padded to 44 with
 * `<`) because it reads as a passport only if it looks like one; it encodes nothing. A one-word
 * name is a given name with no surname, and no name at all is the traveller the app calls you.
 */
export function passportLines(name: string | null | undefined): { surname: string | null; given: string; mrz: string } {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const given = words[0] ?? 'Traveller';
  const surname = words.length > 1 ? words.slice(1).join(' ') : null;
  const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, '').trim().replace(/\s+/g, '<');
  const mrz = `P<TPM${clean(surname ?? 'TripMate')}<<${clean(given)}`.padEnd(44, '<').slice(0, 44);
  return { surname, given, mrz };
}
