import { DayWeather } from "./weather";
import { Itinerary, ItineraryPreferences } from "./types";

const SHAPE_HINT = `{"days":[{"date":"YYYY-MM-DD","weather":"short weather summary","summary":"1-2 sentence elegant narrative with 1-2 tasteful emojis capturing the day's theme and flow","stops":[{"name":"stop name","lat":0.0,"lng":0.0,"cost":0,"note":"short note"}]}]}`;

function formatPreferences(preferences?: ItineraryPreferences | null): string {
  if (!preferences || (preferences.tags.length === 0 && !preferences.vibe)) return "";
  const parts: string[] = [];
  if (preferences.vibe) parts.push(`leans toward a "${preferences.vibe}" vibe`);
  if (preferences.tags.length > 0) parts.push(`especially interested in ${preferences.tags.join(", ")}`);
  return `\nTraveler preferences: ${parts.join("; ")}.\nWeight stop selection toward these interests without ignoring the weather/budget constraints above.\n`;
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

export function buildGeneratePrompt(params: {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  weather: DayWeather[];
  preferences?: ItineraryPreferences | null;
}): string {
  return `Plan a day-by-day trip itinerary for ${params.destination}, from ${params.startDate} to ${params.endDate}, with a total budget of $${params.budget}.

Daily weather:
${formatWeather(params.weather)}
${formatPreferences(params.preferences)}
Use the weather to favor indoor activities on days with high rain probability or extreme temperatures, and outdoor activities on good-weather days.
Each stop needs a realistic estimated cost in USD (0 is fine for free attractions) such that the stops across all days roughly fit the total budget.
Include real, well-known places for the destination with their real approximate latitude/longitude.
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
}): string {
  return `Here is a trip itinerary for ${params.destination} (${params.startDate} to ${params.endDate}, budget $${params.budget}):

${JSON.stringify(params.previousItinerary)}

The user's feedback on this itinerary: "${params.feedback}"

Revise the itinerary to address this feedback. Keep real, well-known places with real approximate latitude/longitude, and keep per-stop costs realistic and roughly within the total budget.
For each day, also write (or rewrite, if the feedback changes its theme) a short, elegant 1-2 sentence "summary" with 1-2 tasteful emojis capturing that day's theme and flow.

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
${SHAPE_HINT}`;
}
