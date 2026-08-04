import { DayWeather } from "./weather";
import { Itinerary } from "./types";

const SHAPE_HINT = `{"days":[{"date":"YYYY-MM-DD","weather":"short weather summary","stops":[{"name":"stop name","lat":0.0,"lng":0.0,"cost":0,"note":"short note"}]}]}`;

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
}): string {
  return `Plan a day-by-day trip itinerary for ${params.destination}, from ${params.startDate} to ${params.endDate}, with a total budget of $${params.budget}.

Daily weather:
${formatWeather(params.weather)}

Use the weather to favor indoor activities on days with high rain probability or extreme temperatures, and outdoor activities on good-weather days.
Each stop needs a realistic estimated cost in USD (0 is fine for free attractions) such that the stops across all days roughly fit the total budget.
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

The user's feedback on this itinerary: "${params.feedback}"

Revise the itinerary to address this feedback. Keep real, well-known places with real approximate latitude/longitude, and keep per-stop costs realistic and roughly within the total budget.

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
${SHAPE_HINT}`;
}
