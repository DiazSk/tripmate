import { fold } from "./homeIdeas";
import type { IdeaRead } from "./ideaRead";

/** `PolarLanding`'s `DESTS`, same ids, words and order: an index here is an index there. */
export type HeroPlace = { id: string; word: string; aliases: string[] };

export const HERO_PLACES: HeroPlace[] = [
  { id: "petra", word: "Petra", aliases: ["jordan", "wadi musa"] },
  { id: "engadin", word: "Engadin", aliases: ["switzerland", "st. moritz", "st moritz"] },
  { id: "tuscany", word: "Tuscany", aliases: ["val d'orcia", "siena"] },
  { id: "jaipur", word: "Jaipur", aliases: ["rajasthan"] },
  { id: "sinaia", word: "Sinaia", aliases: ["romania", "carpathians"] },
];

// Folded the way the text is, so "St. Moritz" and "Val d'Orcia" become the same space-separated words.
// Longest first so a longer alias is never shadowed by a shorter one.
const TERMS = HERO_PLACES.flatMap((p, index) => [p.word, ...p.aliases].map((t) => ({ index, term: ` ${fold(t)} ` })))
  .sort((a, b) => b.term.length - a.term.length);

/** Index into HERO_PLACES of the place the text names, or -1. Whole words only: "Jordanian" is not Jordan. */
export function heroPlaceIn(text: string): number {
  const padded = ` ${fold(text)} `;
  return TERMS.find((t) => padded.includes(t.term))?.index ?? -1;
}

/** What the hero shows: a read place beats typing, which beats the rotation. A read place that
 *  is not one of the five keeps the photo and is named instead. */
export function heroScene(
  read: IdeaRead | null,
  typedIndex: number,
  rotationIndex: number,
): { index: number; elsewhere: string | null } {
  const dest = read?.destination;
  if (dest) {
    const at = heroPlaceIn(dest);
    if (at >= 0) return { index: at, elsewhere: null };
    return { index: typedIndex >= 0 ? typedIndex : rotationIndex, elsewhere: dest.split(",")[0].trim() };
  }
  return { index: typedIndex >= 0 ? typedIndex : rotationIndex, elsewhere: null };
}
