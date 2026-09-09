export type PlanExample = {
  id: string;
  /** Where the trip goes. Set as the card's title, so it carries the place and the shape. */
  title: string;
  /** Trip total in whole dollars, the way the trip form takes a budget. Rendered as "from $X" and
   *  handed to the form verbatim. */
  budgetUsd: number;
  /** The destination string exactly as the form's own field wants it — this is both the card's
   *  "Where" row and the value typed into the wizard, so the two can never disagree. */
  destination: string;
  /** **A season, not a date: `"MM-DD"`.** Resolved to the next occurrence at or after today, so
   *  "Sinaia in February" means the next February forever.
   *
   *  It used to be an authored string (`"Feb 06 – 11, 2027"`). That was fine while the card only had
   *  to be read, and became a bug the moment it also had to fill a form: the date inputs carry
   *  `min={todayISO()}`, so a card whose date has passed prefills a value the form rejects — and the
   *  nearest of these was 22 days out when the prefill was built. Storing the season instead cannot
   *  rot, and it keeps the claim the product actually makes: that a plan is built against the real
   *  weather of real dates. */
  startMonthDay: string;
  /** Inclusive day count. Nights are always `days - 1`, so the card's "N days, M nights" row is
   *  derived rather than stored — two numbers that must agree are one number. */
  days: number;
  /** Party, as counts rather than prose. `"2 adults, 1 child"` is derived for display, and
   *  `GroupType` is derived for the form (1 adult → solo, 2 → couple, any children →
   *  family_with_kids), so neither can drift from the other. */
  adults: number;
  children: number;
  /** The destination itself. This used to be reused scene photography — thematic, not places, and
   *  the desert on the Marrakesh card was not Marrakesh — which made it the weakest thing on an
   *  otherwise honest card. Every photo now shows the place its card names.
   *
   *  **All four are 1200×1288, and that number is a floor rather than a preference.** They were
   *  600×644, which is right for the desktop card (~330 CSS px, half of a two-column cell) and
   *  wrong for the phone, where the frame goes full-width: 362 CSS px on a 3x screen wants 1086
   *  real pixels, so the browser was upscaling 1.81× and the fine texture went to mush. Worth
   *  knowing before "optimising" these back down — `next/image` will not paper over it, because the
   *  optimiser does not enlarge. Every width from 640 to 1200 returned the same 600px original.
   *
   *  Sources, recorded because their absence already cost a round trip — the first attempt to
   *  re-fetch these larger had nothing to re-fetch *from*, and a photo whose origin is unknown
   *  cannot be re-cropped, re-encoded or replaced in kind:
   *    - tuscany-cypress-road        Pexels 10406386 (Stan Swinnen)
   *    - jaipur-amber-fort-elephant  Pexels 11750442 (Mayur Sable)
   *    - peles-castle-romania-snow   Unsplash photo-1657374689601-35a4cb47b111 (Oana Ciurcanu)
   *    - wadi-rum-desert             Pexels 28086996 (Nikola Čedíková)
   *  Pexels and the Unsplash License both permit commercial use without attribution, so nothing
   *  renders these names — they are here so the next person can find the original.
   *
   *  `alt` stays empty by design, not by omission: the title and the "Where" row directly beside the
   *  image already name the place, so alt text here would make a screen reader say it three times.
   *  It is a field rather than a constant so a future card whose photo carries information the copy
   *  does not can fill it. */
  photo: { src: string; alt: string };
};

/** What "Plan a trip like this" carries into the wizard. Deliberately only the fields a card can
 *  honestly speak for — everything else in the form keeps the traveller's saved profile defaults
 *  rather than being overwritten by a marketing example. */
export type PlanPrefill = {
  destination: string;
  startDate: string;
  endDate: string;
  /** Optional so a *partial* prefill cannot overwrite a returning traveller's saved profile.
   *
   *  A featured-plan card knows all six values and sends all six. The hero's entry capsule knows
   *  three — where and when — and deliberately does not ask for money or party size in the first
   *  viewport. Were these required, the capsule would have to invent them, and `startPlanning`
   *  derives `group` from the party counts, so passing a polite-looking `adults: 2, children: 0`
   *  would silently reclassify a solo traveller as a couple and discard the answer they had
   *  already given on /profile. Absent means "not asked", which is not the same as zero. */
  budgetUsd?: number;
  adults?: number;
  children?: number;
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The next occurrence of `MM-DD` at or after `todayISO`, plus the end date `days - 1` later.
 *
 * ISO date strings compare correctly as plain strings, so choosing the year needs no `Date` at all —
 * which is the point. The one place a `Date` is unavoidable is adding days for the end date, and
 * that runs entirely on `getUTC*`/`setUTCDate`: `new Date("2026-09-12")` parses as UTC midnight, so
 * local accessors roll it back a day anywhere west of Greenwich. This repo has already shipped a
 * wrong day-of-week from exactly that mistake.
 *
 * `todayISO` is passed in rather than read, so this stays pure and its tests stay deterministic.
 * The caller supplies the *same* value the form's `min` attribute uses, so the roll and the
 * validation can never disagree about what day it is.
 *
 * ponytail: a `"02-29"` season would resolve to Mar 1 in a common year. No card uses one; add a
 * leap-year clamp here if that ever changes rather than at the call sites.
 */
export function resolveExampleDates(
  startMonthDay: string,
  days: number,
  todayISO: string
): { startDate: string; endDate: string } {
  const year = Number(todayISO.slice(0, 4));
  const thisYear = `${year}-${startMonthDay}`;
  const startDate = thisYear >= todayISO ? thisYear : `${year + 1}-${startMonthDay}`;

  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + Math.max(days - 1, 0));
  const endDate = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
  return { startDate, endDate };
}

/** "9 days, 8 nights". A one-day trip has no nights, hence the guard rather than bare `days - 1`. */
export function formatExampleSpan(days: number): string {
  const nights = Math.max(days - 1, 0);
  return `${days} days, ${nights} ${nights === 1 ? "night" : "nights"}`;
}

/** "2 adults, 1 child". Singular/plural on both halves, and children omitted entirely at zero — a
 *  card reading "2 adults, 0 children" states an absence nobody asked about. */
export function formatExampleParty(adults: number, children: number): string {
  const a = `${adults} ${adults === 1 ? "adult" : "adults"}`;
  if (children <= 0) return a;
  return `${a}, ${children} ${children === 1 ? "child" : "children"}`;
}

/** The card's data as the wizard wants it. */
export function toPrefill(example: PlanExample, todayISO: string): PlanPrefill {
  const { startDate, endDate } = resolveExampleDates(
    example.startMonthDay,
    example.days,
    todayISO
  );
  return {
    destination: example.destination,
    startDate,
    endDate,
    budgetUsd: example.budgetUsd,
    adults: example.adults,
    children: example.children,
  };
}

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
 *
 * **No value imports in this file, on purpose.** Node's ESM loader needs file extensions that the
 * rest of the codebase correctly omits, so a `.test.mjs` can only import a `.ts` module whose own
 * imports are all `import type` — and this one has none at all. That is what makes the date roll
 * above testable, which matters because it is precisely the kind of pure date arithmetic this repo
 * has broken before. Display formatting that needs `lib/format` lives in the component instead.
 *
 * **The four cards mirror the four beats of `ImageRow`** — the blue hour, real prices, live weather,
 * three ways to travel — so the section reads as evidence for the claims made just above it rather
 * than as four arbitrary trips. That mapping is why the destinations are what they are, and it is
 * the constraint to preserve if these are ever rewritten again.
 *
 * **Every budget is grounded in `estimateTierTotal`, not chosen for looks.** Each `budgetUsd` is
 * within $50 of a real tier estimate for its own day count, and `closestTier` resolves each one to
 * the tier its card is about: Jaipur and Wadi Rum to `budget` (one *is* the budget story, the other
 * quotes a "from" price, which has to be the cheapest of the three ways it advertises), Tuscany and
 * Sinaia to `midrange`. Change a number and re-check that it still lands where its copy claims.
 *
 * Seasons are each destination's right one, because this product's whole argument is that it plans
 * against real weather: Tuscany at harvest, Jaipur in the cool months rather than a 45°C June,
 * Sinaia deep enough into winter for the snow the photograph shows, Wadi Rum in spring before the
 * desert becomes unwalkable.
 */
export const planExamples: PlanExample[] = [
  {
    id: "tuscany",
    title: "Nine slow days in Tuscany",
    budgetUsd: 2600,
    destination: "Val d'Orcia, Italy",
    startMonthDay: "09-12",
    days: 9,
    adults: 2,
    children: 0,
    photo: { src: "/scenes/tuscany-cypress-road.webp", alt: "" },
  },
  {
    id: "jaipur",
    title: "Jaipur on a real budget",
    budgetUsd: 900,
    destination: "Jaipur, India",
    startMonthDay: "11-07",
    days: 7,
    adults: 1,
    children: 0,
    photo: { src: "/scenes/jaipur-amber-fort-elephant.webp", alt: "" },
  },
  {
    id: "sinaia",
    title: "Sinaia when the weather decides",
    budgetUsd: 1700,
    destination: "Sinaia, Romania",
    startMonthDay: "02-06",
    days: 6,
    adults: 2,
    children: 1,
    photo: { src: "/scenes/peles-castle-romania-snow.webp", alt: "" },
  },
  {
    id: "wadi-rum",
    title: "Wadi Rum, three ways to travel",
    budgetUsd: 1200,
    destination: "Wadi Rum, Jordan",
    startMonthDay: "03-20",
    days: 7,
    adults: 2,
    children: 0,
    photo: { src: "/scenes/wadi-rum-desert.webp", alt: "" },
  },
];
