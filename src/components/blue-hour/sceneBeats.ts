export type SceneBeat = {
  id: string;
  /** Optional because `ImageRow` falls back to a graded placeholder keyed by `id`, which is what
   *  a *future* beat gets before its photograph exists. All four shipped beats have one.
   *
   *  **Sources are recorded below, and that is not bookkeeping.** The four originals here had none
   *  — the only reference to `dusk-skyline.jpg`, `budget.jpg`, `weather.jpg` and `tiers.jpg`
   *  anywhere in the repo was the `src` string on this very field, so nobody could re-crop them,
   *  re-encode them, or answer whether they were licensed. `planExamples.ts` had already learnt
   *  that lesson the expensive way and says so at its own `photo` field: "a photo whose origin is
   *  unknown cannot be re-cropped, re-encoded or replaced in kind."
   *
   *  `alt` is empty by design, as on the plan cards. Each photograph illustrates the beat named
   *  directly above and below it; describing it again would make a screen reader read the same
   *  idea three times. It stays a field so a future beat whose picture carries information its
   *  copy does not can fill it. */
  photo?: { src: string; alt: string };
  /** Bold identifier, always visible above the card. */
  label: string;
  /** The concrete fact this beat is actually claiming, and the card's headline since the borrowed
   *  "Label / Stat" head was replaced (see ImageRow). It leads rather than trails, and it is set
   *  in the figure face — so it must stay a *measurement*, not a mood phrase. "One 20-minute
   *  window, every evening" earns that face; "Unforgettable evenings" would not. */
  stat: string;
  /** Full sentence, revealed inside the card on hover. Was a dangling fragment
   *  ("Not lowball guesses", "Built into the plan") — reads as half a thought with
   *  nothing else on screen to complete it. Each line now stands on its own. */
  detail: string;
};

/**
 * The four beats, and the photography they carry.
 *
 * **The pictures were re-sourced 2026-09-09, and what they replaced is the point.** The originals
 * were a stock city skyline, a cluttered night food stall, a busy rain-street and a generic palm
 * sunset — four 2400px JPEGs totalling 2.3MB with no recorded origin and no art direction. Beside
 * `FeaturedPlans`' curated set they were visibly the weakest imagery on the site, and the last
 * beat's sunset said nothing whatever about three pricing tiers.
 *
 * Each frame now states its own beat rather than gesturing at its topic:
 *
 *   - **The Blue Hour** — Vernazza from above, lights on, the sky still holding blue. An actual
 *     blue hour, which the outgoing near-black skyline was not: the whole claim is that for ~20
 *     minutes the town and the sky are the same brightness, so a photograph where the sky has
 *     already gone black is arguing against the copy underneath it.
 *   - **Real Prices** — spice barrels ranked in a market window. The word in the stat is
 *     *itemized*, so the picture had to read as counted rather than as abundant; the outgoing
 *     night stall read as neither.
 *   - **Live Weather** — storm cloud over a forested ridge, weather as the subject. It was
 *     previously incidental: a wet street where the rain was context for pedestrians.
 *   - **Three Ways to Travel** — a room opening onto its own view. Deliberately *not* the far
 *     prettier riad courtyard that was shortlisted against it: a tier picture must not take a
 *     side, and PRODUCT.md's one standing tension is that luxury imagery on a budget-honest
 *     product reads as a mismatch. What a tier actually buys is the view you wake up to, which is
 *     true at all three.
 *
 * All four are Pexels, whose licence permits commercial use without attribution — so nothing here
 * renders these names; they exist so the next person can find the original. All 1200x1309, being
 * 11:12 to match `ImageRow`'s frame at the 1200px floor `planExamples.ts` derives (`sizes` resolves
 * to 100vw on a phone, and 430px at 3x wants ~1290 real pixels). Cropped `cover` from centre, which
 * is the crop each was judged on. 2.3MB of JPEG became 649KB of WebP.
 *
 *   - vernazza-blue-hour        Pexels 4254555  (Grafixart_photo Samir BELHAMRA)
 *   - spice-market-barrels      Pexels 10224325 (Ayse BOLAT)
 *   - storm-over-forest-ridge   Pexels 1699022  (eberhard grossgasteiger)
 *   - balcony-morning-view      Pexels 34962016 (Bilge .)
 */
export const sceneBeats: SceneBeat[] = [
  {
    id: "dusk",
    photo: { src: "/scenes/vernazza-blue-hour.webp", alt: "" },
    label: "The Blue Hour",
    stat: "One 20-minute window, every evening",
    detail:
      "Dusk decides whether a city reads as ordinary or unforgettable — every stop we place is timed around catching it.",
  },
  {
    id: "budget",
    photo: { src: "/scenes/spice-market-barrels.webp", alt: "" },
    label: "Real Prices",
    stat: "Lodging, food, and transit — itemized",
    detail:
      "Say what you want to spend and get a plan that actually spends it, priced in before you land — not a lowball guess.",
  },
  {
    id: "weather",
    photo: { src: "/scenes/storm-over-forest-ridge.webp", alt: "" },
    label: "Live Weather",
    stat: "Real forecast, up to 16 days out",
    detail:
      "Indoor days when it rains, golden hour when it doesn't — the plan already knows before you pack.",
  },
  {
    id: "tiers",
    photo: { src: "/scenes/balcony-morning-view.webp", alt: "" },
    label: "Three Ways to Travel",
    stat: "Budget · Mid-range · Luxury",
    detail:
      "Every tier is priced against your actual dates before you commit to any of them.",
  },
];
