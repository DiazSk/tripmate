import { DayWeather } from "./weather";
import { DestinationContext, Itinerary, ItineraryPreferences, ResolvedFlags, TripLogistics } from "./types";
import { TierId, TIERS } from "./tiers";
import { formatTravelLegs, formatTravelerProfile } from "./travelerProfilePrompt";
import { formatDietary } from "./dietaryPrompt";
import type { DietaryNeeds } from "./travelerProfile";

const STOP_SHAPE = `{"name":"stop name","lat":0.0,"lng":0.0,"cost":0,"why":"one line: why this stop suits this traveler","note":"one line: practical detail","time":"9:00 AM","durationLabel":"1 hour","category":"food|entry|transit|other"}`;
const SHAPE_HINT = `{"days":[{"date":"YYYY-MM-DD","weather":"short weather summary","summary":"1-2 sentence elegant narrative with 1-2 tasteful emojis capturing the day's theme and flow","lodging":{"name":"lodging name","cost":0,"note":"short note"},"stops":[${STOP_SHAPE}]}]}`;

// Concrete stop-selection guidance per interest tag — generic "weight toward
// this interest" phrasing wasn't specific enough to reliably avoid the
// itinerary just defaulting to the same generic tourist stops with a
// different note attached.
const INTEREST_GUIDANCE: Record<string, string> = {
  Food: "prioritize street food markets, local food festivals or events, and iconic casual eateries over generic sit-down tourist restaurants",
  "Wellness & Fitness":
    "prioritize wellness centers, spas, yoga studios, parks good for running/walking, and health-focused cafes",
  "Culture & History":
    "prioritize museums, historic sites, and cultural landmarks with genuine significance over generic photo-op spots",
  Nightlife: "prioritize live music venues, bars, and evening social spots",
  "Nature & Outdoors": "prioritize parks, hikes, and scenic outdoor spots",
  Shopping: "prioritize distinctive local markets and boutique districts over generic malls",
  "Family-Friendly": "prioritize kid-friendly attractions and an easygoing pace",
  Relaxation: "prioritize slower-paced days, spas, and scenic downtime over packed sightseeing",
};

function formatPreferences(preferences?: ItineraryPreferences | null): string {
  if (!preferences || (preferences.tags.length === 0 && !preferences.vibe)) return "";
  const parts: string[] = [];
  if (preferences.vibe) parts.push(`leans toward a "${preferences.vibe}" vibe`);
  if (preferences.tags.length > 0) parts.push(`especially interested in ${preferences.tags.join(", ")}`);

  const guidance = preferences.tags
    .map((tag) => INTEREST_GUIDANCE[tag])
    .filter((line): line is string => Boolean(line));

  let out = `\nTraveler preferences: ${parts.join("; ")}.\n`;
  if (guidance.length > 0) {
    out += `For these interests: ${guidance.join("; ")}.\n`;
  }
  out += `Let these interests genuinely shape which stops are chosen, not just the notes — avoid a generic, one-size-fits-all tourist itinerary. Don't ignore the weather/budget constraints above while doing so.\n`;
  return out;
}

function formatWeather(weather: DayWeather[]): string {
  if (weather.length === 0) return "No weather data available.";
  return weather
    .map(
      (w) =>
        `${w.date}: ${w.tempMinC}-${w.tempMaxC}C${
          w.precipitationProbability !== null
            ? `, ${w.precipitationProbability}% chance of rain`
            : ""
        }${w.historical ? " (typical weather, not a live forecast)" : ""}`
    )
    .join("\n");
}

export function formatContextInsight(context: DestinationContext): string {
  const lines: string[] = [];
  if (context.festivals.length > 0) {
    lines.push(
      `Festivals/events: ${context.festivals
        .map((f) => `${f.name} (${f.dates}) — ${f.note}`)
        .join("; ")}`
    );
  }
  if (context.safety.length > 0) {
    lines.push(
      `Safety notes: ${context.safety.map((s) => `[${s.severity}] ${s.note}`).join("; ")}`
    );
  }
  if (context.shopping.length > 0) {
    lines.push(
      `Notable shopping areas: ${context.shopping
        .map((s) => `${s.name} (${s.area}) — ${s.note}`)
        .join("; ")}`
    );
  }
  if (context.trends.length > 0) {
    lines.push(`Current trends: ${context.trends.map((t) => t.note).join("; ")}`);
  }
  return lines.join("\n");
}

const CONTEXT_USE_INSTRUCTION = `If a festival's dates overlap the trip, include it as a stop on the relevant day. Weigh the safety notes when choosing areas and timing. Include at least one shopping stop from the list if it fits the budget and tier.`;

function formatContextBlock(insight?: string): string {
  if (!insight) return "";
  return `\nDestination context:\n${insight}\n${CONTEXT_USE_INSTRUCTION}\n`;
}

function tierStyle(tierId: TierId): string {
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[1];
  return `${tier.name} tier: ${tier.description}.`;
}

/** The two lines that replaced the old tag chips. Kept deliberately concrete: "one line" plus
 *  worked examples, because "short" alone produced a paragraph about half the time. */
const STOP_LINES_INSTRUCTION = `Each stop also needs exactly two one-line fields. "why": why THIS stop suits THIS traveler given their stated interests and how they travel — the reason it was chosen over alternatives, e.g. "Quiet rock garden, no stairs — fits an easy-paced culture day". "note": one practical detail they'd act on, e.g. "10-minute walk from the last stop; go before 10am to beat the crowds". Both must be a single line, under about 90 characters, and must not repeat the stop's name.`;

// Meals were coming back as a single committed restaurant every time, which reads
// like a booking and pins the day's route to one address. An area plus "what to look
// for" is both more honest and more usable — the specific venue is only worth naming
// when the venue itself is the reason to go there.
const FOOD_STOP_INSTRUCTION = `For "food" stops, prefer an AREA over a specific restaurant unless the place itself is the point (it's a landmark eatery, it needs a reservation, or a stated interest is the reason the day routes there). An area-level food stop uses the neighborhood/market as its "name" (e.g. "Dinner around Pike Place Market"), the area's approximate lat/lng, and a "why"/"note" that says what to look for there plus one or two example spots (e.g. "Seafood counters everywhere; e.g. Pike Place Chowder"). Never invent hours, wait times, or menu prices for an area-level stop. The area must sit within or next to that part of the day's route — a meal should never pull the day across town.`;

// Lodging came back as the same mid-range city hotel every night regardless of who
// was travelling or where the days actually went. The type of stay is a real choice
// (hostel, B&B, apartment, camp, houseboat, farmstay) and often the memorable part of
// a trip — so pick the type from the traveler + destination first, and offer an
// alternative rather than presenting one property as settled.
const LODGING_INSTRUCTION = `For "lodging", choose the TYPE of stay, not just a hotel. Consider hostels/social guesthouses (solo, younger, tight budget), B&Bs/guesthouses/homestays (local and cultural interests), apartments (families, groups, longer stays), hotels (when convenience, accessibility or a late check-in matters), and stays the destination is genuinely known for — riverside or desert camps, glamping, mountain huts, houseboats, farmstays, ryokan-style inns. When the traveler's interests lean adventurous or outdoorsy, actively offer the adventurous option (e.g. a riverside camp) on the night whose location makes it natural, instead of defaulting to a city hotel — but only where such stays genuinely exist at that destination, and never when the night's weather, a remote location after dark, or a family/accessibility need makes it a bad idea. Phrase the lodging "name" as the type FIRST, then the area — "Boutique hotel in Capitol Hill", "Riverside camp near Shivpuri", "Family apartment in Fremont". Never write it the other way round ("Capitol Hill Boutique Hotel"), which reads as a specific property and invents one that may not exist; name an actual property only when it is itself the draw or needs booking far ahead. Use "note" to say in one line why this type suits this traveler plus ONE alternative of a different type or price band. Keep the same base while consecutive days share an area — switch only when the itinerary's geography actually moves. Never invent specific prices, availability, or ratings beyond the cost estimate.`;

const BUDGET_INSTRUCTION = `The itinerary's total cost (lodging + stops combined) MUST come close to the full stated budget (aim for 85-100% of it), not just "under" it. If standard sightseeing and dining wouldn't use up a high budget, add premium extras appropriate to the tier (private guides, exclusive experiences, shopping, spa, upgraded transport) rather than leaving the budget unused.`;

const STOP_FIELD_INSTRUCTION = `Each stop needs: a realistic estimated cost in USD (0 is fine for free attractions); a "time" (approximate start time, e.g. "9:00 AM") — times across a day's stops must be sequential and non-overlapping; a "durationLabel" (short human label, e.g. "1 hour", "45 minutes"); 1-2 short "tags" describing the stop (e.g. "Local Pick", "Reservation Needed", "Free", "Must-See"); and a "category" — "food" for meals/cafes/restaurants, "entry" for paid attractions/tickets, "transit" for explicit transport legs, "other" for everything else.`;

export function buildGeneratePrompt(params: {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  tier: TierId;
  weather: DayWeather[];
  preferences?: ItineraryPreferences | null;
  contextInsight?: string;
  resolvedFlags?: ResolvedFlags | null;
  dietary?: DietaryNeeds | null;
  logistics?: TripLogistics | null;
}): string {
  return `Plan a day-by-day trip itinerary for ${params.destination}, from ${params.startDate} to ${params.endDate}, with a total budget of $${params.budget}.

Style: ${tierStyle(params.tier)}

Daily weather:
${formatWeather(params.weather)}
${formatPreferences(params.preferences)}${formatTravelerProfile(params.resolvedFlags ?? null)}${formatTravelLegs(params.logistics ?? null)}${formatDietary(params.dietary ?? null)}${formatContextBlock(params.contextInsight)}
Use the weather to favor indoor activities on days with high rain probability or extreme temperatures, and outdoor activities on good-weather days.
Every day except the last should include a "lodging" entry representing that night's stay, priced to the style above. Use the SAME hotel for every night in the same city — repeat its name and nightly cost on each of those days. Only switch lodging when the trip actually relocates to a different city or region, and say so in that day's note. Do not invent a different hotel each night: it costs the traveler more, wastes time re-checking in, and no one moves hotels nightly in one city. Pick one well-located base and plan the days around it.
${LODGING_INSTRUCTION}
${STOP_FIELD_INSTRUCTION}
${STOP_LINES_INSTRUCTION}
${FOOD_STOP_INSTRUCTION}
${BUDGET_INSTRUCTION}
Include real, well-known places (or real, well-known areas, per the food-stop rule) for the destination with their real approximate latitude/longitude.
For each day, also write a short, elegant 1-2 sentence "summary" capturing that day's theme and flow, with 1-2 tasteful emojis, e.g. "A relaxing mix of historic sightseeing in Asakusa followed by local dining along the river. 🏯🍜"

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
${SHAPE_HINT}`;
}

export function buildRefinePrompt(params: {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  previousItinerary: Itinerary;
  feedback: string;
  contextInsight?: string;
  resolvedFlags?: ResolvedFlags | null;
  dietary?: DietaryNeeds | null;
  logistics?: TripLogistics | null;
}): string {
  return `Here is a trip itinerary for ${params.destination} (${params.startDate} to ${params.endDate}, budget $${params.budget}):

${JSON.stringify(params.previousItinerary)}

Style: ${tierStyle(params.previousItinerary.tier)}

The user's feedback on this itinerary: "${params.feedback}"
${formatTravelerProfile(params.resolvedFlags ?? null)}${formatTravelLegs(params.logistics ?? null)}${formatDietary(params.dietary ?? null)}${formatContextBlock(params.contextInsight)}
Revise the itinerary to address this feedback. Keep real, well-known places with real approximate latitude/longitude, keep the lodging entries, and keep per-stop costs realistic.
${STOP_FIELD_INSTRUCTION}
${STOP_LINES_INSTRUCTION}
${FOOD_STOP_INSTRUCTION}
${LODGING_INSTRUCTION}
${BUDGET_INSTRUCTION}
For each day, also write (or rewrite, if the feedback changes its theme) a short, elegant 1-2 sentence "summary" with 1-2 tasteful emojis capturing that day's theme and flow.

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
${SHAPE_HINT}`;
}

export function buildPlaceDetailPrompt(params: {
  name: string;
  destination: string;
  lat: number;
  lng: number;
}): string {
  return `Give a compact travel-guide entry for "${params.name}" in ${params.destination} (approx. coordinates ${params.lat}, ${params.lng}).

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
{"history":"1-2 sentence history or significance","bestTime":"short best time of day or season to visit","tips":["practical tip 1","practical tip 2"],"duration":"suggested visit duration, e.g. '1-2 hours'"}`;
}

export function buildRebalancePrompt(params: {
  destination: string;
  remainingDays: Itinerary["days"];
  remainingBudget: number;
  tier: TierId;
}): string {
  return `Here are the remaining days of a trip itinerary for ${params.destination}:

${JSON.stringify(params.remainingDays)}

Style: ${tierStyle(params.tier)}

The traveler overspent on an earlier day. Only $${params.remainingBudget} is left for these remaining days combined (lodging + stops). Revise these remaining days so their total cost fits within $${params.remainingBudget}, keeping the same dates, weather summaries, and style. Reduce or swap stops/lodging as needed rather than just noting the overage.
${STOP_FIELD_INSTRUCTION}
${STOP_LINES_INSTRUCTION}
${FOOD_STOP_INSTRUCTION}
${LODGING_INSTRUCTION}

Respond with ONLY valid JSON, no markdown code fences, no commentary, as a JSON array of day objects in this shape:
[{"date":"YYYY-MM-DD","weather":"short weather summary","lodging":{"name":"lodging name","cost":0,"note":"short note"},"stops":[${STOP_SHAPE}]}]`;
}

export function buildContextPrompt(params: {
  destination: string;
  startDate: string;
  endDate: string;
}): string {
  return `Give background context useful for planning a trip to ${params.destination} between ${params.startDate} and ${params.endDate}.

Cover: any festivals or notable events happening in that window, general safety notes a traveler should know, notable shopping areas/districts, and any current travel trends (popular new spots, seasonal crowds, etc.). Leave a category's array empty if you don't have anything genuinely relevant — don't invent filler.

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
{"festivals":[{"name":"festival name","dates":"date range or day","note":"short note"}],"safety":[{"note":"short safety note","severity":"low|medium|high"}],"shopping":[{"name":"area/market name","area":"neighborhood","note":"short note"}],"trends":[{"note":"short trend note"}]}`;
}

export function buildCritiquePrompt(params: {
  itinerary: Itinerary;
  budget: number;
  contextInsight?: string;
  interestTags?: string[];
  resolvedFlags?: ResolvedFlags | null;
  dietary?: DietaryNeeds | null;
}): string {
  const interestLine =
    params.interestTags && params.interestTags.length > 0
      ? `\nThe traveler said they're especially interested in: ${params.interestTags.join(", ")}.\n`
      : "";
  return `Here is a generated trip itinerary with a total budget of $${params.budget}:

${JSON.stringify(params.itinerary)}
${formatContextBlock(params.contextInsight)}${interestLine}${formatTravelerProfile(params.resolvedFlags ?? null)}${formatDietary(params.dietary ?? null)}
Review it for: (1) total cost (lodging + stops) landing within 85-100% of the budget, (2) stop times being sequential, non-overlapping, and realistically spaced (no implausibly tight back-to-back stops), (3) reasonable use of the destination context above, if any was given, (4) whether the itinerary genuinely reflects the traveler's stated interests above, if any were given — not just generic sightseeing, (5) whether each day respects the traveler profile above, if one was given — the stops-per-day target and any mobility or family constraints, (6) whether every food stop actually fits the traveler's dietary needs above, if any were given — a stop they could not eat at is a defect even if the rest of the day is good.

If it already looks good, respond with exactly: {"issues":[],"revisedDays":null}
Otherwise, respond with the specific issues found and a corrected "days" array in the same shape as the input, fixing those issues.

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
{"issues":["short issue description"],"revisedDays":[{"date":"YYYY-MM-DD","weather":"short weather summary","lodging":{"name":"lodging name","cost":0,"note":"short note"},"stops":[${STOP_SHAPE}]}]}`;
}
