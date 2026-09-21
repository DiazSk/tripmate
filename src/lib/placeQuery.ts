/**
 * Turning a generated stop name into something a gazetteer can match.
 *
 * `resolveNamedPlaceCoords` exists because the model writes coordinates from memory and gets them
 * wrong — its own comment records Fushimi Inari coming out 11km off. But it matches OpenStreetMap
 * on an **anchored exact-name regex**, and `buildGeneratePrompt` asks the model for names that are
 * phrases: `FOOD_STOP_INSTRUCTION` says an area-level food stop takes "the neighborhood/market as
 * its name", e.g. "Dinner around Pike Place Market".
 *
 * So one file manufactures names the other structurally cannot match. `^(Breakfast at Caffè
 * Poliziano)$` matches no OSM `name` tag, the lookup returns nothing, and the corrector fails soft
 * and keeps the guess. Measured on one real nine-day plan: 49 stops resolved to 39 distinct
 * coordinates, **ten of them sharing the destination's town centre**, and "Breakfast at Caffè
 * Poliziano" pinned 8.4km from Caffè Poliziano.
 *
 * This module is the missing step: strip the meal off the front so the *place* is what gets
 * matched. It is deliberately not a fuzzy search — see the note in `resolveNamedPlaceCoords` about
 * why the union query stays one cheap Overpass pass.
 *
 * The iOS client carries the same two rules in `StopResolution.swift`, because it repairs the same
 * data on the device against Apple's geocoder. Two implementations of one judgement is a real cost;
 * it is paid because the two run in different languages against different providers, and both are
 * covered by tests that use the same cases.
 */

/** Words a generated stop name begins with when the name is a meal rather than a place. */
const LEAD_INS = new Set([
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "supper",
  "drinks",
  "coffee",
  "aperitivo",
  "snack",
  "dessert",
]);

/** What separates the meal from the place it happens at. */
const SEPARATORS = new Set(["at", "around", "near", "in", "by"]);

/** Lowercased, unaccented, stripped of trailing punctuation. `Café` and `cafe` are one word. */
function fold(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/^\p{P}+|\p{P}+$/gu, "");
}

/**
 * The place inside a stop name, or `null` when the name contains none worth looking up.
 *
 * **The lead-in gate is load-bearing rather than tidy.** Splitting on the separator
 * unconditionally turns "Museum of Art in Pienza" into "Pienza", which resolves to the town
 * centroid — which is the exact defect this exists to repair. Only a name that *starts* with a
 * meal word is read as a meal.
 *
 * Splits on the **first** separator only, so "Dinner at the trattoria in Pienza" asks about the
 * trattoria rather than about Pienza.
 */
export function placeQuery(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const words = trimmed.split(/\s+/);
  if (!LEAD_INS.has(fold(words[0]))) return trimmed;
  // A name that is only a meal word names no place.
  if (words.length === 1) return null;

  const cut = words.findIndex((w, i) => i > 0 && SEPARATORS.has(fold(w)));
  // A meal word with no separator — "Breakfast buffet". Nothing to strip.
  if (cut === -1) return trimmed;
  // A separator with nothing after it — "Breakfast at" — names a place no more than "Lunch" does.
  if (cut + 1 >= words.length) return null;
  return words.slice(cut + 1).join(" ");
}

/**
 * Does this query name a *particular* place, or just a kind of place?
 *
 * Found by running the iOS version against real data: "Pecorino tasting at caseificio" and
 * "Dinner at agriturismo restaurant" both resolve — to *a* cheese dairy and *an* agriturismo, some
 * arbitrary one nearby. That is a confident wrong answer where the model's vague centroid was at
 * least honestly vague, and no distance bound catches it because the imposter is a kilometre away.
 *
 * The signal is a capitalised word that is **not the first**: a sentence capitalises its opening
 * word whether or not it names anything. It costs the occasional genuinely lowercase place name,
 * which is the right way to be wrong — a stop we decline to correct simply keeps today's
 * behaviour.
 */
export function namesAPlace(query: string): boolean {
  const words = query.trim().split(/\s+/);
  return words.slice(1).some((w) => /^\p{Lu}/u.test(w));
}

/**
 * Every string worth matching against OSM for these stop names, and how to key a hit back.
 *
 * Returns a map from *search term* to the original stop names that want it. Both the full name and
 * the stripped place go in when they differ — "Abbey of Sant'Antimo" is already an OSM name and
 * must keep matching, while "Breakfast at Caffè Poliziano" only ever will as "Caffè Poliziano".
 * Two stops can want the same term ("Breakfast at X" and "Coffee at X"), which is why the value is
 * a list.
 */
export function searchTermsFor(names: string[]): Map<string, string[]> {
  const terms = new Map<string, string[]>();
  const want = (term: string, name: string) => {
    const existing = terms.get(term);
    if (existing) {
      if (!existing.includes(name)) existing.push(name);
    } else {
      terms.set(term, [name]);
    }
  };

  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    want(name, name);
    const place = placeQuery(name);
    if (place && place !== name && namesAPlace(place)) want(place, name);
  }
  return terms;
}
