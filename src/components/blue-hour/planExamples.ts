export type PlanExample = {
  id: string;
  /** Where the trip goes. Set as the card's title, so it carries the place and the shape. */
  title: string;
  /** Whole dollars, the way the trip form takes a budget. Rendered as "from $X". */
  fromUsd: number;
  /** The four facts a listing has to state without being asked. Order is fixed across cards so
   *  the column scans down as a table rather than as four unrelated stacks. */
  region: string;
  dates: string;
  span: string;
  party: string;
  /** Reused scene photography. These are thematic, not places — the desert is not Marrakesh —
   *  and they are the one thing here that should be replaced with real destination imagery.
   *  Everything else on the card is a real, plannable trip. */
  photo: { src: string; alt: string };
};

/**
 * Four worked examples for the landing's featured section.
 *
 * Named `planExamples`, not `featuredPlans`: a data module one capital letter away from its
 * component (`FeaturedPlans.tsx`) resolves to the wrong file on a case-insensitive filesystem,
 * which is what macOS gave on the first build. `sceneBeats.ts` / `ImageRow.tsx` is the precedent —
 * the data module gets its own name.
 *
 * Deliberately static rather than read from the `trips` table. A marketing surface that queries
 * the database shows nothing on a fresh install, shows whatever the last visitor happened to
 * generate, and puts other people's plans on the front page. These are curated and honest: each
 * one is a trip the generator can actually produce at the stated budget and length.
 */
export const planExamples: PlanExample[] = [
  {
    id: "kyoto",
    title: "Eight slow days in Kyoto",
    fromUsd: 2400,
    region: "Kyoto, Japan",
    dates: "Sep 19 – 26, 2026",
    span: "8 days, 7 nights",
    party: "2 adults",
    photo: { src: "/scenes/dusk-skyline.jpg", alt: "" },
  },
  {
    id: "lisbon",
    title: "Lisbon on a real budget",
    fromUsd: 1100,
    region: "Lisbon, Portugal",
    dates: "Oct 03 – 08, 2026",
    span: "6 days, 5 nights",
    party: "1 adult",
    photo: { src: "/scenes/budget.jpg", alt: "" },
  },
  {
    id: "reykjavik",
    title: "Reykjavík when the weather decides",
    fromUsd: 3200,
    region: "Reykjavík, Iceland",
    dates: "Feb 12 – 18, 2027",
    span: "7 days, 6 nights",
    party: "2 adults",
    photo: { src: "/scenes/weather.jpg", alt: "" },
  },
  {
    id: "marrakesh",
    title: "Marrakesh, three ways to travel",
    fromUsd: 1850,
    region: "Marrakesh, Morocco",
    dates: "Apr 08 – 15, 2027",
    span: "8 days, 7 nights",
    party: "2 adults, 1 child",
    photo: { src: "/scenes/tiers.jpg", alt: "" },
  },
];
