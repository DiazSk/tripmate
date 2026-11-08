/**
 * "coffee", "halal food", "pharmacy" → the OSM tags that *are* those things.
 *
 * The Overpass search used to match names only, so a word describing a kind of place found only
 * venues that happened to have it in their name. This turns such words into extra selectors that
 * `searchOverpass` adds to the *same* query — no second request, which matters because the shared
 * mirrors rate-limit exactly this traffic. Pure and import-free so a `.test.mjs` can reach it.
 *
 * Selector strings have the shape of `OSM_FILTERS` in `placeSearch.ts`: bracketed clauses that go
 * straight after `nwr`.
 */

/** Words that say "near me", not what kind of place. Ignored when deciding if a query is all category. */
const FILLER = new Set(["near", "nearby", "me", "the", "a", "in", "best", "good", "open", "around", "here", "and"]);

const EATERY = '["amenity"~"^(restaurant|fast_food)$"]';
const DRINKS = '["amenity"~"^(bar|pub|biergarten)$"]';
const CAFE = '["amenity"="cafe"]';
const GREEN = '["leisure"~"^(park|garden)$"]';
const BED = '["tourism"~"^(hotel|hostel|guest_house|motel)$"]';
const GROCER = '["shop"~"^(supermarket|convenience)$"]';
const VIEW = '["tourism"="viewpoint"]';
const PHARMACY = '["amenity"="pharmacy"]';

/** A kind of place, by the singular word. Several selectors in one entry would be alternatives (OR). */
const BASES: Record<string, string[]> = {
  coffee: [CAFE],
  cafe: [CAFE],
  espresso: [CAFE],
  restaurant: [EATERY],
  food: [EATERY],
  eat: [EATERY],
  lunch: [EATERY],
  dinner: [EATERY],
  bar: [DRINKS],
  pub: [DRINKS],
  drink: [DRINKS],
  beer: [DRINKS],
  bakery: ['["shop"="bakery"]'],
  pharmacy: [PHARMACY],
  chemist: [PHARMACY],
  atm: ['["amenity"="atm"]'],
  bank: ['["amenity"="bank"]'],
  museum: ['["tourism"="museum"]'],
  gallery: ['["tourism"="gallery"]'],
  park: [GREEN],
  garden: [GREEN],
  viewpoint: [VIEW],
  lookout: [VIEW],
  beach: ['["natural"="beach"]'],
  hotel: [BED],
  hostel: [BED],
  supermarket: [GROCER],
  grocery: [GROCER],
  toilet: ['["amenity"="toilets"]'],
  fuel: ['["amenity"="fuel"]'],
};

/** Narrowers: AND-ed onto a base when there is one, standing alone when there is not. */
const MODIFIERS: Record<string, string> = {
  halal: '["diet:halal"~"^(yes|only)$"]',
  vegetarian: '["diet:vegetarian"~"^(yes|only)$"]',
  vegan: '["diet:vegan"~"^(yes|only)$"]',
  kosher: '["diet:kosher"~"^(yes|only)$"]',
};
for (const c of [
  "italian", "chinese", "japanese", "sushi", "pizza", "indian", "thai", "mexican", "turkish", "lebanese",
  "greek", "french", "burger", "kebab", "seafood", "steak", "ramen", "korean", "vietnamese", "spanish",
]) {
  // `cuisine` is a `;`-separated list ("italian;pizza"), so match one whole item of it.
  MODIFIERS[c] = `["cuisine"~"(^|;)${c}($|;)",i]`;
}

/** The word itself, then its singular — "cafes", "pharmacies", "beaches" all land on a key. */
function lookup<T>(table: Record<string, T>, word: string): T | undefined {
  for (const w of [word, word.replace(/ies$/, "y"), word.replace(/es$/, ""), word.replace(/s$/, "")]) {
    if (Object.hasOwn(table, w)) return table[w];
  }
  return undefined;
}

/**
 * Selectors for a typed query, or `[]` when any word in it is not a category word.
 *
 * All-or-nothing on purpose: "coffee roasters" has a word we cannot place, and widening it to
 * every café would bury the name matches the traveller meant. Accents are folded ("café").
 */
export function categorySelectors(query: string | undefined): string[] {
  const words = (query ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w && !FILLER.has(w));
  if (!words.length) return [];
  const bases: string[][] = [];
  const mods: string[] = [];
  for (const w of words) {
    const base = lookup(BASES, w);
    const mod = lookup(MODIFIERS, w);
    if (base) bases.push(base);
    else if (mod) mods.push(mod);
    else return [];
  }
  const modClause = mods.join("");
  if (!bases.length) return [modClause];
  // Several kinds of place ("bar food") are alternatives, each narrowed by any modifiers.
  return [...new Set(bases.flat())].map((b) => b + modClause);
}
