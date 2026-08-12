export type SceneBeat = {
  id: string;
  /** Real photography lands here once sourced. Until then ImageRow renders a
   *  gradient placeholder keyed by `id`. */
  photo?: { src: string; alt: string };
  /** Bold identifier, always visible above the card. */
  label: string;
  /** Muted qualifier, always visible beneath the label — Vita Travels' own
   *  "Label / Stat" pattern ("Introvert Retreats / 78+ Countries"), grounded in a
   *  real product fact rather than a mood phrase, so the label isn't standing alone. */
  stat: string;
  /** Full sentence, revealed inside the card on hover. Was a dangling fragment
   *  ("Not lowball guesses", "Built into the plan") — reads as half a thought with
   *  nothing else on screen to complete it. Each line now stands on its own. */
  detail: string;
};

export const sceneBeats: SceneBeat[] = [
  {
    id: "dusk",
    photo: { src: "/scenes/dusk-skyline.jpg", alt: "" },
    label: "The Blue Hour",
    stat: "One 20-minute window, every evening",
    detail:
      "Dusk decides whether a city reads as ordinary or unforgettable — every stop we place is timed around catching it.",
  },
  {
    id: "budget",
    photo: { src: "/scenes/budget.jpg", alt: "" },
    label: "Real Prices",
    stat: "Lodging, food, and transit — itemized",
    detail:
      "Say what you want to spend and get a plan that actually spends it, priced in before you land — not a lowball guess.",
  },
  {
    id: "weather",
    photo: { src: "/scenes/weather.jpg", alt: "" },
    label: "Live Weather",
    stat: "Real forecast, up to 16 days out",
    detail:
      "Indoor days when it rains, golden hour when it doesn't — the plan already knows before you pack.",
  },
  {
    id: "tiers",
    photo: { src: "/scenes/tiers.jpg", alt: "" },
    label: "Three Ways to Travel",
    stat: "Budget · Mid-range · Luxury",
    detail:
      "Every tier is priced against your actual dates before you commit to any of them.",
  },
];
