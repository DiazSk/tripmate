export type TierId = "budget" | "midrange" | "luxury";

export interface Tier {
  id: TierId;
  name: string;
  description: string;
  dailyRate: number;
  nightlyLodgingRate: number;
  headline: string;
  longDescription: string;
  imageSrc: string;
  imageAlt: string;
}

export const TIERS: Tier[] = [
  {
    id: "budget",
    name: "Budget",
    description: "Hostels, street food and casual eats, public transit",
    dailyRate: 70,
    nightlyLodgingRate: 40,
    headline: "Needs flexibility built in.",
    longDescription:
      "Roamly plans around spontaneity: hostel bunks, street food worth detouring for, and hopping between cities on a whim. Public transit isn't a compromise, it's part of the adventure.",
    imageSrc: "/tiers/budget.svg",
    imageAlt: "Warm sunset over a mountain skyline with a backpacker's tent silhouette",
  },
  {
    id: "midrange",
    name: "Mid-range",
    description: "Boutique hotels, casual-to-nice restaurants, taxis",
    dailyRate: 150,
    nightlyLodgingRate: 150,
    headline: "Comfort, without the compromise.",
    longDescription:
      "Boutique stays, good food without the fuss, and a taxi when you'd rather not walk. Roamly finds the balance between doing it all and actually enjoying the trip.",
    imageSrc: "/tiers/midrange.svg",
    imageAlt: "Sunlit row of boutique hotel facades with warm terracotta tones",
  },
  {
    id: "luxury",
    name: "Luxury",
    description: "5-star hotels, fine dining, private tours and transport",
    dailyRate: 350,
    nightlyLodgingRate: 500,
    headline: "Nothing left to chance.",
    longDescription:
      "5-star stays, private transport, and reservations that are already handled. Roamly curates the details so every moment feels taken care of.",
    imageSrc: "/tiers/luxury.svg",
    imageAlt: "Private yacht at night on calm water under a moonlit sky",
  },
];

export function estimateTierTotal(tier: Tier, days: number): number {
  const nights = Math.max(days - 1, 0);
  return tier.dailyRate * days + tier.nightlyLodgingRate * nights;
}

export function closestTier(budget: number, days: number): TierId {
  let best = TIERS[0];
  let bestDiff = Infinity;
  for (const tier of TIERS) {
    const diff = Math.abs(estimateTierTotal(tier, days) - budget);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = tier;
    }
  }
  return best.id;
}

export function tripDays(startDate: string, endDate: string): number {
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  return Math.max(Math.round(ms / (1000 * 60 * 60 * 24)) + 1, 1);
}

export const MAX_TRIP_DAYS = 30;

export function isTripTooLong(startDate: string, endDate: string): boolean {
  return tripDays(startDate, endDate) > MAX_TRIP_DAYS;
}
