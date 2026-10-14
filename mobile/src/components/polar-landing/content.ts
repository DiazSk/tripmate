import type { ImageSource } from 'expo-image';

/**
 * The landing's copy — TripMate's own, transcribed from `sceneBeats.ts`, `planExamples.ts` and the
 * Swift app's `LandingContent.swift` — and the app's shipped Pexels photography.
 */

export type Dest = { id: string; word: string; coord: string; img: ImageSource };
export const DESTS: Dest[] = [
  { id: 'petra', word: 'Petra', coord: '[ 30º 19’ 20” N, 35º 27’ 07” E ]', img: require('@/assets/images/scenes/petra-treasury.webp') },
  { id: 'engadin', word: 'Engadin', coord: '[ 46º 29’ 52” N, 9º 50’ 17” E ]', img: require('@/assets/images/scenes/graubunden-autumn-valley.webp') },
  { id: 'tuscany', word: 'Tuscany', coord: '[ 43º 03’ 54” N, 11º 36’ 41” E ]', img: require('@/assets/images/scenes/tuscany-cypress-road.webp') },
  { id: 'jaipur', word: 'Jaipur', coord: '[ 26º 54’ 45” N, 75º 47’ 14” E ]', img: require('@/assets/images/scenes/jaipur-amber-fort-elephant.webp') },
  { id: 'sinaia', word: 'Sinaia', coord: '[ 45º 21’ 00” N, 25º 33’ 00” E ]', img: require('@/assets/images/scenes/peles-castle-romania-snow.webp') },
];

export const PLANS = [
  { title: 'Nine slow days in Tuscany', price: 2600, where: "Val d'Orcia, Italy", when: 'Sep 12–20, 2027', length: '9 days, 8 nights', party: '2 adults', season: 'Early autumn', img: require('@/assets/images/scenes/tuscany-cypress-road.webp') },
  { title: 'Jaipur on a real budget', price: 900, where: 'Jaipur, India', when: 'Nov 7–13, 2026', length: '7 days, 6 nights', party: '1 adult', season: 'Cool season', img: require('@/assets/images/scenes/jaipur-amber-fort-elephant.webp') },
  { title: 'Sinaia when the weather decides', price: 1700, where: 'Sinaia, Romania', when: 'Feb 6–11, 2027', length: '6 days, 5 nights', party: '2 adults, 1 child', season: 'Deep winter', img: require('@/assets/images/scenes/peles-castle-romania-snow.webp') },
  { title: 'Wadi Rum, three ways to travel', price: 1200, where: 'Wadi Rum, Jordan', when: 'Mar 20–26, 2027', length: '7 days, 6 nights', party: '2 adults', season: 'Spring', img: require('@/assets/images/scenes/wadi-rum-desert.webp') },
] as const;

export const BEATS = [
  { label: 'The Blue Hour', stat: 'One 20-minute window, every evening', prose: 'Dusk decides whether a city reads as ordinary or unforgettable — every stop we place is timed around catching it.', img: require('@/assets/images/scenes/vernazza-blue-hour.webp') },
  { label: 'Real Prices', stat: 'Lodging, food, and transit — itemized', prose: 'Say what you want to spend and get a plan that actually spends it, priced in before you land — not a lowball guess.', img: require('@/assets/images/scenes/spice-market-barrels.webp') },
  { label: 'Live Weather', stat: 'Real forecast, up to 16 days out', prose: 'Indoor days when it rains, golden hour when it doesn’t — the plan already knows before you pack.', img: require('@/assets/images/scenes/storm-over-forest-ridge.webp') },
  { label: 'Three Ways To Travel', stat: 'Budget · Mid-range · Luxury', prose: 'Every tier is priced against your actual dates before you commit to any of them.', img: require('@/assets/images/scenes/balcony-morning-view.webp') },
] as const;

export const STEPS = [
  { n: '01', title: 'You set the constraints', prose: 'Where, when, how much, and who is going. The budget is a target to hit, not a ceiling to stay under.' },
  { n: '02', title: 'Real data goes in first', prose: 'Forecast for your actual dates, public holidays, opening hours and travel times — fetched before a single word is written.' },
  { n: '03', title: 'Written, then critiqued', prose: 'A second pass reviews the finished plan against your budget and pace, and rewrites the days it finds fault with.' },
  { n: '04', title: 'Every place is checked', prose: 'Coordinates are corrected against OpenStreetMap, so the pins land where the place actually is rather than where the model guessed.' },
] as const;

/** `lat`/`lng`, not `latitude`/`longitude`: the shape `regionForStops` and `legBearingRad` take. */
export type DayStop = { time: string; name: string; note: string; lat: number; lng: number; tagLeft?: boolean };
export type DayCity = { id: string; name: string; country: string; day: string; lat: number; lng: number; labelLeft?: boolean; stops: DayStop[] };

// Illustrative days. The places and coordinates are real; the times are an example.
export const CITIES: DayCity[] = [
  {
    id: 'jaipur', name: 'Jaipur', country: 'India', day: 'Day 2 of 7', lat: 26.95, lng: 75.835,
    stops: [
      { time: '08:30', name: 'Amber Fort', note: 'Before the heat and the coaches', lat: 26.9855, lng: 75.8513 },
      { time: '10:45', name: 'Panna Meena ka Kund', note: 'Stepwell, a short walk below the fort', lat: 26.9876, lng: 75.8556, tagLeft: true },
      { time: '13:00', name: 'Hawa Mahal', note: 'Old city, lunch nearby', lat: 26.9239, lng: 75.8267, tagLeft: true },
      { time: '15:15', name: 'Jantar Mantar', note: 'Open-air instruments, mostly shade-free', lat: 26.9248, lng: 75.8246 },
      { time: '18:10', name: 'Nahargarh Fort', note: 'The blue hour over the Pink City', lat: 26.9373, lng: 75.8155 },
    ],
  },
  {
    // Val d'Orcia and Sinaia are ~1,100 km apart — a few points on a globe. One label mirrors.
    id: 'orcia', name: "Val d'Orcia", country: 'Italy', day: 'Day 3 of 9', lat: 43.055, lng: 11.6, labelLeft: true,
    stops: [
      { time: '08:00', name: 'Cappella di Vitaleta', note: 'Mist still in the valley', lat: 43.0606, lng: 11.6403 },
      { time: '10:00', name: 'Pienza', note: 'Pecorino, the walls, the view south', lat: 43.0766, lng: 11.6789 },
      { time: '13:00', name: 'Bagno Vignoni', note: 'Lunch beside the thermal pool', lat: 43.0278, lng: 11.6175 },
      { time: '15:30', name: "San Quirico d'Orcia", note: 'Horti Leonini, slow afternoon', lat: 43.0587, lng: 11.6053 },
      { time: '18:30', name: 'Montalcino', note: 'Last light from the fortress', lat: 43.0581, lng: 11.489 },
    ],
  },
  {
    id: 'sinaia', name: 'Sinaia', country: 'Romania', day: 'Day 1 of 6', lat: 45.352, lng: 25.54,
    stops: [
      { time: '09:00', name: 'Peleș Castle', note: 'First tour of the day', lat: 45.3599, lng: 25.5427 },
      { time: '11:00', name: 'Pelișor Castle', note: 'Next door, quieter', lat: 45.3586, lng: 25.541, tagLeft: true },
      { time: '13:00', name: 'Sinaia Monastery', note: 'Warm lunch in town after', lat: 45.3539, lng: 25.5513 },
      { time: '15:00', name: 'Cota 1400', note: 'Cable car — only if the wind allows', lat: 45.3423, lng: 25.5196 },
      { time: '17:30', name: 'Casino Sinaia', note: 'Park walk as the lamps come on', lat: 45.3508, lng: 25.5527 },
    ],
  },
];

export const TIERS = ['Budget', 'Mid-range', 'Luxury'] as const;
export const PHASES = ['Fetching the forecast for your dates', 'Checking holidays and opening hours', 'Writing the days', 'Critiquing against your budget and pace'];
