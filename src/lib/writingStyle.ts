/**
 * The one punctuation rule every prompt that writes traveller-facing text carries. The product
 * shows no em-dashes anywhere, and a model left to itself reaches for them constantly. Written as
 * an escape so this file is not itself a hit when grepping the source for the character.
 * The itinerary-planner skill carries the same rule in §7 for the calls that load it.
 */
export const NO_EM_DASH_RULE =
  "Never use em-dashes (\u2014) in anything you write. Use a comma, colon, full stop or parentheses instead.";

/**
 * The same rule, enforced on the text instead of asked for: `NO_EM_DASH_RULE` is a request, and a
 * cheap model ignores it often enough that the dashes reached travellers anyway (Meri's answers on
 * Home and in the trip chat). Any em-dash, and an en-dash used as one (spaced), becomes a comma;
 * an unspaced en-dash ("9–5", "March–May") is a range and is kept.
 * A dash that opened a line or ended up beside other punctuation is dropped rather than left as a
 * stray comma.
 */
export function withoutDashes(text: string): string {
  return text
    .replace(/[ \t]*(?:—|[ \t]–[ \t])[ \t]*/g, ", ")
    .replace(/(^|\n), /g, "$1")
    .replace(/, ([.,;:!?)]|$)/gm, "$1")
    .replace(/([(]), /g, "$1");
}
