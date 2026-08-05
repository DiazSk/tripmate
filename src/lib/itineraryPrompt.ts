import { DayWeather } from "./weather";
import { Itinerary } from "./types";
import { TierId, TIERS } from "./tiers";

const SHAPE_HINT = `{"days":[{"date":"YYYY-MM-DD","weather":"short weather summary","lodging":{"name":"lodging name","cost":0,"note":"short note"},"stops":[{"name":"stop name","lat":0.0,"lng":0.0,"cost":0,"note":"short note"}]}]}`;

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

function tierStyle(tierId: TierId): string {
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[1];
  return `${tier.name} tier: ${tier.description}.`;
}

const BUDGET_INSTRUCTION = `The itinerary's total cost (lodging + stops combined) MUST come close to the full stated budget (aim for 85-100% of it), not just "under" it. If standard sightseeing and dining wouldn't use up a high budget, add premium extras appropriate to the tier (private guides, exclusive experiences, shopping, spa, upgraded transport) rather than leaving the budget unused.`;

export function buildGeneratePrompt(params: {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  tier: TierId;
  weather: DayWeather[];
}): string {
  return `Plan a day-by-day trip itinerary for ${params.destination}, from ${params.startDate} to ${params.endDate}, with a total budget of $${params.budget}.

Style: ${tierStyle(params.tier)}

Daily weather:
${formatWeather(params.weather)}

Use the weather to favor indoor activities on days with high rain probability or extreme temperatures, and outdoor activities on good-weather days.
Every day except the last should include a "lodging" entry representing that night's stay, priced to the style above. Each stop needs a realistic estimated cost in USD (0 is fine for free attractions).
${BUDGET_INSTRUCTION}
Include real, well-known places for the destination with their real approximate latitude/longitude.

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
}): string {
  return `Here is a trip itinerary for ${params.destination} (${params.startDate} to ${params.endDate}, budget $${params.budget}):

${JSON.stringify(params.previousItinerary)}

Style: ${tierStyle(params.previousItinerary.tier)}

The user's feedback on this itinerary: "${params.feedback}"

Revise the itinerary to address this feedback. Keep real, well-known places with real approximate latitude/longitude, keep the lodging entries, and keep per-stop costs realistic.
${BUDGET_INSTRUCTION}

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
${SHAPE_HINT}`;
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

Respond with ONLY valid JSON, no markdown code fences, no commentary, as a JSON array of day objects in this shape:
[{"date":"YYYY-MM-DD","weather":"short weather summary","lodging":{"name":"lodging name","cost":0,"note":"short note"},"stops":[{"name":"stop name","lat":0.0,"lng":0.0,"cost":0,"note":"short note"}]}]`;
}
