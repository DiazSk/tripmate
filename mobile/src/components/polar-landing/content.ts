import type { ImageSource } from 'expo-image';

import { planExamples, type PlanExample } from '@shared/planExamples';
import type { PetraPhoto } from '@shared/petraDay';
import { sceneBeats, type SceneBeat } from '@shared/sceneBeats';

/**
 * The landing's content. The plans and the four beats are the web's own modules, shared through
 * `@shared` (`src/lib/planExamples.ts`, `src/lib/sceneBeats.ts`), so the two landings cannot
 * disagree about a price, a date or a claim. What is local is what has to be: the photographs,
 * which the phone bundles rather than fetching, matched to each record by its id.
 */

export type Dest = { id: string; word: string; coord: string; img: ImageSource };
export const DESTS: Dest[] = [
  { id: 'petra', word: 'Petra', coord: '[ 30º 19’ 20” N, 35º 27’ 07” E ]', img: require('@/assets/images/scenes/petra-treasury.webp') },
  { id: 'engadin', word: 'Engadin', coord: '[ 46º 29’ 52” N, 9º 50’ 17” E ]', img: require('@/assets/images/scenes/graubunden-autumn-valley.webp') },
  { id: 'tuscany', word: 'Tuscany', coord: '[ 43º 03’ 54” N, 11º 36’ 41” E ]', img: require('@/assets/images/scenes/tuscany-cypress-road.webp') },
  { id: 'jaipur', word: 'Jaipur', coord: '[ 26º 54’ 45” N, 75º 47’ 14” E ]', img: require('@/assets/images/scenes/jaipur-amber-fort-elephant.webp') },
  { id: 'sinaia', word: 'Sinaia', coord: '[ 45º 21’ 00” N, 25º 33’ 00” E ]', img: require('@/assets/images/scenes/peles-castle-romania-snow.webp') },
];

const PLAN_PHOTOS: Record<string, ImageSource> = {
  tuscany: require('@/assets/images/scenes/tuscany-cypress-road.webp'),
  jaipur: require('@/assets/images/scenes/jaipur-amber-fort-elephant.webp'),
  sinaia: require('@/assets/images/scenes/peles-castle-romania-snow.webp'),
  'wadi-rum': require('@/assets/images/scenes/wadi-rum-desert.webp'),
};
// The strip's season line, as the web prints it. Presentation copy, keyed by the plan's id.
const SEASON: Record<string, string> = { tuscany: 'Early autumn', jaipur: 'Cool season', sinaia: 'Deep winter', 'wadi-rum': 'Spring' };

export type LandingPlan = PlanExample & { img: ImageSource; season: string };
export const PLANS: LandingPlan[] = planExamples.map((p) => ({ ...p, img: PLAN_PHOTOS[p.id], season: SEASON[p.id] ?? '' }));

const BEAT_PHOTOS: Record<string, ImageSource> = {
  dusk: require('@/assets/images/scenes/vernazza-blue-hour.webp'),
  budget: require('@/assets/images/scenes/spice-market-barrels.webp'),
  weather: require('@/assets/images/scenes/storm-over-forest-ridge.webp'),
  tiers: require('@/assets/images/scenes/balcony-morning-view.webp'),
};
export type LandingBeat = SceneBeat & { img: ImageSource };
export const BEATS: LandingBeat[] = sceneBeats.map((b) => ({ ...b, img: BEAT_PHOTOS[b.id] }));

export const FOOT_PHOTO: ImageSource = require('@/assets/images/scenes/wadi-rum-desert.webp');

// The four steps the web's HowItWorks states, in the same words.
export const STEPS = [
  { n: '01', title: 'You set the constraints', prose: 'Where, when, how much, and who is going. The budget is a ceiling: the plan stays inside it rather than spending up to it.' },
  { n: '02', title: 'Real data goes in first', prose: 'Forecast for your actual dates, public holidays, opening hours and travel times, fetched before a single word is written.' },
  { n: '03', title: 'Written, then critiqued', prose: 'A second pass reviews the finished plan against your budget and pace, and rewrites the days it finds fault with.' },
  { n: '04', title: 'Every place is checked', prose: 'Coordinates are corrected against OpenStreetMap, so the pins land where the place actually is rather than where the model guessed.' },
] as const;

export const FACTS = [
  ['Forecast', 'For your actual dates, up to 16 days out'],
  ['Holidays & hours', 'Public holidays and opening times, fetched first'],
  ['Critiqued', 'A second pass against your budget and pace'],
] as const;

/** `PETRA_PHOTOS`'s keys, bundled. Metro needs a literal `require` per file, so the shared module
 *  names each photo and this maps the name to the file of the same name in `assets/images/scenes`. */
export const PETRA_IMG: Record<PetraPhoto, ImageSource> = {
  coffee: require('@/assets/images/scenes/petra-cardamom-coffee.webp'),
  siq: require('@/assets/images/scenes/petra-siq-morning.webp'),
  tea: require('@/assets/images/scenes/petra-tea-pour.webp'),
  above: require('@/assets/images/scenes/petra-above-ad-deir.webp'),
  candles: require('@/assets/images/scenes/petra-by-night-candles.webp'),
  fire: require('@/assets/images/scenes/petra-fire-coffee.webp'),
  overlook: require('@/assets/images/scenes/petra-treasury-from-above.webp'),
  bench: require('@/assets/images/scenes/petra-monastery-bench.webp'),
};
