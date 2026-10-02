import { isEndBeforeStart, isTripTooLong } from './tiers';

/**
 * What a form is still missing, and the sentence to say about it.
 *
 * **This is here rather than in the screens because the screens cannot be tested.** There is no
 * renderer in this repo's mobile test setup — `authGate.ts` records why — so logic reachable only
 * through a component is logic nothing checks. The same move `authMode.ts` and `fieldWidth.ts`
 * made.
 *
 * It exists at all because the wizard stopped greying out its primary. DESIGN.md: *"Disabled:
 * avoid … The empty case is handled at submit, where focus moves to the field."* A button that
 * stays live has to be able to say what it is waiting for, and `field` is what tells the screen
 * where to send the cursor.
 */

export type GapField = 'destination' | 'dates' | 'budget' | 'email' | 'password';

export interface Gap {
  /** Which field to focus. `dates` is a native picker and has nothing focusable — see `planGap`. */
  field: GapField;
  /** One sentence, shown beside the action and carried by `accessibilityHint`. */
  reason: string;
}

/**
 * Copy taken from the Swift wizard, which had already settled the wording. Moved here from
 * `basics.tsx`, where it was a local function with no test, so that `planGap` can state the date
 * rules once instead of restating them.
 */
export function crossFieldProblem(startDate: string, endDate: string): string | undefined {
  if (!startDate || !endDate) return undefined;
  if (isEndBeforeStart(startDate, endDate)) return 'End date must be on or after the start date.';
  if (isTripTooLong(startDate, endDate)) {
    return "Trips over 30 days aren't supported — please choose a shorter date range.";
  }
  return undefined;
}

/**
 * **The order is the order the fields appear on screen**, not the order of severity. A blocked
 * press should walk the reader down the form; sending them to an invalid date range three rows
 * below an empty destination would make the second press jump back up.
 */
export function planGap(draft: {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
}): Gap | null {
  if (draft.destination.trim().length === 0) {
    return { field: 'destination', reason: "Add where you're going first." };
  }
  if (!draft.startDate || !draft.endDate) {
    return { field: 'dates', reason: 'Pick your arrival and departure dates.' };
  }
  const dates = crossFieldProblem(draft.startDate, draft.endDate);
  if (dates) return { field: 'dates', reason: dates };
  // `> 0` rather than `!draft.budget`, so a NaN from a half-typed figure is a gap rather than a
  // number the form accepts.
  if (!(draft.budget > 0)) {
    return { field: 'budget', reason: 'Add a budget — the plan stays inside it.' };
  }
  return null;
}

/** The same shape for the auth form, whose two fields are in the same top-to-bottom order. */
export function authGap(email: string, password: string): Gap | null {
  if (email.trim().length === 0) return { field: 'email', reason: 'Add your email address.' };
  if (password.length < 8) {
    return { field: 'password', reason: 'Passwords are at least 8 characters.' };
  }
  return null;
}

/**
 * Whether the import composer has anything to work on.
 *
 * Trimmed, because a box holding only spaces is an empty box — pressing the action there should
 * put the cursor back in it rather than post an import with nothing in it.
 */
export function hasImportContent(text: string, imageCount: number): boolean {
  return text.trim().length > 0 || imageCount > 0;
}

/**
 * The gap's sentence, unless the screen is already saying it.
 *
 * **The date rules feed two surfaces and they collided.** `crossFieldProblem` supplies the coral
 * note `basics.tsx` renders the moment a range goes wrong, *and* the dates gap's own reason — the
 * same string. So a blocked press printed it a second time in muted, one line under the coral
 * one; and because the dates gap focuses nothing (the chips are a native picker), that duplicate
 * was the entire response to the press. Worse, the two copies disagreed about what they meant:
 * coral says "this is broken", muted says "you have not got here yet".
 *
 * Comparing the text rather than the field keeps the rule where the duplication actually is. A
 * gap whose sentence is new still gets said.
 */
export function gapSentence(gap: Gap | null, alreadyShown: string | undefined): string | null {
  if (!gap) return null;
  return gap.reason === alreadyShown ? null : gap.reason;
}
