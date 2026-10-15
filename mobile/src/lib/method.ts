/**
 * How TripMate plans, in four steps: Home's widget of that name and the screen it opens
 * (`app/how-it-works.tsx`). Static, and true today: this is what the backend actually does when a
 * plan is generated. Transcribed from `ios/TripMate/TripMate/Home/LandingContent.swift`.
 *
 * **Step 02 no longer matches the Swift original, deliberately.** It said "forecast for your
 * actual dates" full stop, which for a trip a month out is a promise the product cannot keep:
 * `fetchWeatherBundle` only reaches the forecast endpoint inside `FORECAST_HORIZON_DAYS` and falls
 * back to the historical archive beyond it.
 */
export const METHOD = [
  { number: '01', title: 'You set the constraints', prose: 'Where, when, how much, and who is going. The budget is a ceiling: the plan stays inside it rather than spending up to it.' },
  { number: '02', title: 'Real data goes in first', prose: 'A real forecast for your dates inside the 16-day window and seasonal norms beyond it, plus public holidays, opening hours and travel times, fetched before a single word is written.' },
  { number: '03', title: 'Written, then critiqued', prose: 'A second pass reviews the finished plan against your budget and pace, and rewrites the days it finds fault with.' },
  { number: '04', title: 'Every place is checked', prose: 'Coordinates are corrected against OpenStreetMap, so the pins land where the place actually is rather than where the model guessed.' },
];
