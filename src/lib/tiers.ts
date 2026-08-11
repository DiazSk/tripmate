export type TierId = "budget" | "midrange" | "luxury";

export interface Tier {
  id: TierId;
  name: string;
  description: string;
  dailyRate: number;
  nightlyLodgingRate: number;
  headline: string;
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
