/**
 * The one punctuation rule every prompt that writes traveller-facing text carries. The product
 * shows no em-dashes anywhere, and a model left to itself reaches for them constantly. Written as
 * an escape so this file is not itself a hit when grepping the source for the character.
 * The itinerary-planner skill carries the same rule in §7 for the calls that load it.
 */
export const NO_EM_DASH_RULE =
  "Never use em-dashes (\u2014) in anything you write. Use a comma, colon, full stop or parentheses instead.";
