/**
 * One day in Petra, told four ways: the landing's "a day you can imagine" (web
 * `src/components/polar/ImagineDay.tsx`, phone `mobile/src/components/polar-landing/imagine.tsx`).
 *
 * **A sample journey, and every screen that shows it says so.** Prices are estimates in US dollars
 * per person. Checked 2026-10-14 against the Petra Development & Tourism Region Authority (one-day
 * ticket 50 JOD for visitors staying a night), Visit Petra (Petra by Night relaunched May 2025:
 * Sunday to Thursday, 20:30 to 22:30, 30 JOD, not in the Jordan Pass) and Aqaba tourism (Petra
 * Kitchen 30 JOD with dinner; no published start time, so the card says "evening" and the 18:30 is
 * the sample's). Coordinates are OpenStreetMap's (Nominatim), town centres for Wadi Musa stops.
 *
 * Photos are named by key, not path: the web serves `/scenes/<file>` and the phone `require`s the
 * same file, so each app maps `PETRA_PHOTOS` itself. All are Unsplash (free licence, no attribution
 * required); the ids are recorded so they can be re-cropped or replaced in kind.
 */
export const PETRA_PHOTOS = {
  coffee: "petra-cardamom-coffee.webp", // Unsplash photo-1774529233247-d3f34ed11994
  siq: "petra-siq-morning.webp", // Unsplash photo-1714577744181-735bd0b2dff7
  tea: "petra-tea-pour.webp", // Unsplash photo-1724618641221-5c3387cb5a9e
  above: "petra-above-ad-deir.webp", // Unsplash photo-1727140014874-245562946309
  candles: "petra-by-night-candles.webp", // Unsplash photo-1662747974561-f2f5ea3825a6
  fire: "petra-fire-coffee.webp", // Unsplash photo-1790933150272-565f2f3c0a64
  overlook: "petra-treasury-from-above.webp", // Unsplash photo-1580834341580-8c17a3a630ca
  bench: "petra-monastery-bench.webp", // Unsplash photo-1612020499914-7a5eef03e29c
} as const;
export type PetraPhoto = keyof typeof PETRA_PHOTOS;

export type LngLat = [number, number];
export type LensId = 'slow' | 'food' | 'adventure' | 'together';
export type Stop = {
  id: string;
  time: string;
  min: number;
  kind: string;
  title: string;
  why: string;
  practical: string;
  cost: number;
  at: LngLat;
  walkKm?: number;
  next?: { text: string; km: number };
};

const P = {
  hotel: [35.4755, 30.3222] as LngLat,
  treasury: [35.4515, 30.3221] as LngLat,
  urnTomb: [35.4493, 30.3276] as LngLat,
  qasr: [35.4401, 30.3295] as LngLat,
  monastery: [35.431, 30.3382] as LngLat,
};

const siq = (why: string): Stop => ({
  id: 'siq', time: '06:00', min: 75, kind: 'Sight', title: 'Through the Siq to the Treasury', why,
  practical: '1.2 km, gently downhill. One-day ticket 50 JOD, included in the Jordan Pass.',
  cost: 71, at: P.treasury, walkKm: 2,
});
const lunch = (why: string, time = '11:30', min = 90): Stop => ({
  id: 'lunch', time, min, kind: 'Food', title: 'A long lunch in the shade', why,
  practical: 'About 17 JOD. The last toilets before the Monastery steps.',
  cost: 24, at: P.qasr, next: { text: '45 min climb · 800 steps', km: 1.2 },
});
const night: Stop = {
  id: 'night', time: '20:30', min: 120, kind: 'Evening', title: 'Petra by Night',
  why: 'Candles from the Siq to the Treasury, and a valley quiet enough to hear them.',
  practical: 'Sunday to Thursday, 20:30 to 22:30. 30 JOD, bought at the Visitor Centre and not part of the Jordan Pass.',
  cost: 42, at: P.treasury, walkKm: 2.4,
};
const walkOut = { text: '1 h 20 walk out · 4.6 km', km: 4.6 };

export const LENSES: Record<LensId, { name: string; short: string; line: string; photo: PetraPhoto; changes: string[]; stops: Stop[] }> = {
  slow: {
    name: 'The slow way', short: 'Slow', line: 'Wander, sit, look twice.', photo: 'above',
    changes: ['Fewer stops, longer stays', 'A seat facing every view worth one', 'Out before the heat, back for the candles'],
    stops: [
      { id: 'coffee', time: '05:20', min: 30, kind: 'Food', title: 'Cardamom coffee on the roof',
        why: 'Wadi Musa is still asleep, and the cliffs above it go from grey to pink while you drink.',
        practical: 'Ask your hotel the night before: most only start breakfast at 06:00.',
        cost: 3, at: P.hotel, next: { text: '10 min walk · 0.7 km', km: 0.7 } },
      { ...siq('For the first hour the Siq is shade and your own footsteps, and the Treasury appears through the last gap while the light is still low.'), next: { text: '20 min walk · 1.3 km', km: 1.3 } },
      { id: 'tombs', time: '08:00', min: 150, kind: 'Sight', title: 'The Royal Tombs, unhurried',
        why: 'Climb to the Urn Tomb and sit inside its hall. The bands of colour across the ceiling are the reason to come.',
        practical: 'Steep steps and no shade after 10:00. Carry 1.5 L of water each.',
        cost: 0, at: P.urnTomb, next: { text: '15 min walk · 0.9 km', km: 0.9 } },
      lunch('The only shaded tables in the valley, at the hour nobody should be walking. Mint tea after, poured from a height.'),
      { id: 'monastery', time: '13:45', min: 150, kind: 'Pause', title: 'Tea facing the Monastery',
        why: 'Ad Deir is taller than the Treasury and sees a fraction of its visitors. Take the bench opposite and stay until the stone turns rose.',
        practical: 'The steps are in shade after 13:00. Taken slowly, the climb is not hard.',
        cost: 4, at: P.monastery, next: walkOut },
      night,
    ],
  },
  food: {
    name: 'For the food', short: 'Food', line: 'Eat your way through it.', photo: 'fire',
    changes: ['Bread from the oven at dawn', 'Tea brewed in the embers', 'A dinner you cook yourself'],
    stops: [
      { id: 'bread', time: '05:15', min: 30, kind: 'Food', title: 'Ka’ak, warm from the oven',
        why: 'Sesame rings and a twist of za’atar from a Wadi Musa bakery that has been open since four, eaten walking.',
        practical: 'Bakeries cluster around the central roundabout. Carry small change.',
        cost: 2, at: [35.4762, 30.3228], next: { text: '12 min walk · 0.9 km', km: 0.9 } },
      { ...siq('Eat the last of the bread at the Treasury while it is still in shadow.'), next: { text: '25 min walk · 1.4 km', km: 1.4 } },
      { id: 'fire', time: '09:30', min: 60, kind: 'Food', title: 'Tea brewed over a fire',
        why: 'Sage tea and cardamom coffee at a Bedouin family’s stall below the Royal Tombs, the kettle sitting right in the embers.',
        practical: 'Agree the price before you sit. Three or four JOD a glass is normal.',
        cost: 5, at: [35.4497, 30.3268], next: { text: '15 min walk · 0.9 km', km: 0.9 } },
      { ...lunch('Galayet bandora if it is on (tomatoes cooked down with garlic and chilli) and bread to drag through it.'), next: { text: '1 h walk out · 3.8 km', km: 3.8 } },
      { id: 'kitchen', time: '18:30', min: 150, kind: 'Food', title: 'Cook dinner at Petra Kitchen',
        why: 'Shoulder to shoulder at a long counter making mezze, then a maqluba turned out upside down at the table.',
        practical: 'Evening classes, so book a day ahead. Around 30 JOD with dinner.',
        cost: 42, at: [35.475, 30.3218], next: { text: '5 min walk · 0.3 km', km: 0.3 } },
      { id: 'knafeh', time: '21:15', min: 30, kind: 'Food', title: 'Knafeh on the way back',
        why: 'Warm, salty cheese under syrup and semolina, eaten standing at the counter.',
        practical: 'The sweet shops on the main street stay open late.',
        cost: 3, at: [35.4768, 30.3226] },
    ],
  },
  adventure: {
    name: 'The high trails', short: 'Adventure', line: 'See it from above.', photo: 'overlook',
    changes: ['The Treasury from the cliff opposite', 'An altar on a summit', 'The back way down'],
    stops: [
      { ...siq('Be first to the Treasury so you can climb above it while the light is still on the facade.'), min: 60, next: { text: '10 min walk · 0.5 km', km: 0.5 } },
      { id: 'khubtha', time: '07:15', min: 120, kind: 'Trail', title: 'Al-Khubtha, above the Treasury',
        why: 'The view everyone photographs from the ground, taken from high on the cliff opposite, with nobody else on the stairs.',
        practical: 'Steep stone stairs, about 3.5 km return. Starts beside the Royal Tombs.',
        cost: 0, at: [35.453, 30.3229], walkKm: 3.5, next: { text: '25 min walk · 1.4 km', km: 1.4 } },
      { id: 'highplace', time: '10:00', min: 150, kind: 'Trail', title: 'The High Place of Sacrifice',
        why: 'A Nabataean altar on a summit, then the Wadi Farasa trail down past tombs most visitors never see.',
        practical: 'Steep for the first 40 minutes. Go clockwise so the hard part is done in the morning.',
        cost: 0, at: [35.447, 30.3215], walkKm: 3, next: { text: '10 min walk · 0.7 km', km: 0.7 } },
      lunch('Refuel properly. The afternoon is 800 steps up.', '12:45', 60),
      { id: 'edge', time: '14:30', min: 120, kind: 'Trail', title: 'The Monastery, and past it',
        why: 'Beyond Ad Deir the path keeps going to a lip of rock that drops away into Wadi Araba.',
        practical: 'The last viewpoint is unfenced. Start down by 16:30.',
        cost: 0, at: [35.4296, 30.3392], next: walkOut },
    ],
  },
  together: {
    name: 'Just the two of you', short: 'Together', line: 'Make room for each other.', photo: 'bench',
    changes: ['Coffee for two before anyone is up', 'A bench facing the Monastery', 'Candles to end it'],
    stops: [
      { id: 'coffee2', time: '05:20', min: 30, kind: 'Food', title: 'Coffee for two, before anyone’s up',
        why: 'The roof to yourselves, a pot between you, and the cliffs turning pink.',
        practical: 'Ask your hotel the night before: most only start breakfast at 06:00.',
        cost: 3, at: P.hotel, next: { text: '10 min walk · 0.7 km', km: 0.7 } },
      { ...siq('Walk it side by side and say nothing. You will both remember the moment the Treasury appears.'), next: { text: '25 min walk · 1.6 km', km: 1.6 } },
      lunch('Two glasses of mint tea, and nowhere either of you has to be.', '11:00', 120),
      { id: 'bench', time: '13:45', min: 150, kind: 'Pause', title: 'The bench facing the Monastery',
        why: 'The two of you, a pot of tea and the biggest facade in Petra. Stay as long as the shade does.',
        practical: 'The steps are in shade after 13:00. Taken slowly, the climb is not hard.',
        cost: 4, at: P.monastery, next: walkOut },
      { id: 'hammam', time: '17:45', min: 90, kind: 'Rest', title: 'A hammam in Wadi Musa',
        why: 'Steam, a scrub and an hour of lying down: the kindest thing you can do for tomorrow’s legs.',
        practical: 'Couples’ sessions need booking; around 25 JOD each.',
        cost: 35, at: [35.477, 30.323], next: { text: '15 min walk · 1 km', km: 1 } },
      night,
    ],
  },
};
export const LENS_ORDER: LensId[] = ['slow', 'food', 'adventure', 'together'];

// The valley's main path: Wadi Musa → Visitor Centre → the Siq → Treasury → Street of Facades →
// Colonnaded Street → Qasr al-Bint → the Monastery steps. Routes follow it between stops.
export const TRAIL: LngLat[] = [
  [35.4755, 30.3222], [35.4678, 30.3238], [35.4635, 30.3225], [35.4603, 30.3218], [35.4515, 30.3221],
  [35.45, 30.3245], [35.4485, 30.3262], [35.444, 30.329], [35.4401, 30.3295], [35.436, 30.333],
  [35.4335, 30.336], [35.431, 30.3382],
];
const nearest = (at: LngLat) =>
  TRAIL.reduce((best, t, i) => (Math.hypot(t[0] - at[0], t[1] - at[1]) < Math.hypot(TRAIL[best][0] - at[0], TRAIL[best][1] - at[1]) ? i : best), 0);
export function routeAlongTrail(stops: LngLat[]) {
  const out: LngLat[] = [];
  stops.forEach((at, k) => {
    out.push(at);
    const next = stops[k + 1];
    if (!next) return;
    const a = nearest(at);
    const b = nearest(next);
    const step = a <= b ? 1 : -1;
    for (let i = a; i !== b + step; i += step) out.push(TRAIL[i]);
  });
  return out;
}

export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fmtDur = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`);
export const fmtCost = (n: number) => (n === 0 ? 'Free' : `$${n}`);
export const dayCost = (stops: Stop[]) => stops.reduce((s, x) => s + x.cost, 0);

// The sample's date is a season, not a date (planExamples.ts learnt why: a stored date rots into
// one the form rejects). It is the first Wednesday on or after the next 12 April, because Petra by
// Night runs Sunday to Thursday and April is the season the costs and light were written for.
const SAMPLE_MONTH_DAY = "04-12";
const WEDNESDAY = 3;
export function petraSampleDate(todayISO: string): string {
  const year = Number(todayISO.slice(0, 4));
  let d = new Date(`${year}-${SAMPLE_MONTH_DAY}T00:00:00Z`);
  if (d.toISOString().slice(0, 10) < todayISO) d = new Date(`${year + 1}-${SAMPLE_MONTH_DAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((WEDNESDAY - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/** "Open this day in the planner": Petra, with the sample day as day 2 of three. Money is not
 *  asked here, so it is not sent (see PlanPrefill on why absent is not zero). */
export function petraPrefill(todayISO: string, adults: number) {
  const day = petraSampleDate(todayISO);
  const shift = (n: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return { destination: "Petra, Jordan", startDate: shift(-1), endDate: shift(1), adults, children: 0 };
}

/** The slow day as the story tells it, morning to night. Each beat is a stop in `LENSES.slow`, so
 *  the story and the plan are the same day told twice; `sky` is the background the landing eases
 *  to while that beat is on screen (dawn grey, sand, noon white, rose, night). */
export type Sky = { bg: string; fg: string; fg2: string; rule: string };
export const PETRA_BEATS: { stop: string; part: string; time: string; line: string; body: string; photo: PetraPhoto; caption: string; sky: Sky }[] = [
  { stop: "coffee", part: "Morning", time: "05:20", photo: "coffee", caption: "Wadi Musa, before the gates",
    line: "Coffee before the town wakes.",
    body: "Cardamom, a little too sweet, poured on a roof while the cliffs above you go from grey to pink.",
    sky: { bg: "#e7eaee", fg: "#1f2a44", fg2: "#4a5368", rule: "rgba(31,42,68,0.14)" } },
  { stop: "siq", part: "Morning", time: "06:00", photo: "siq", caption: "The Siq, 1.2 km of it",
    line: "The Siq, with nobody else in it.",
    body: "Shade, cool stone and your own footsteps, until the gap at the end fills with rose-coloured light.",
    sky: { bg: "#f3f1ec", fg: "#1f2a44", fg2: "#535353", rule: "rgba(31,42,68,0.12)" } },
  { stop: "lunch", part: "Afternoon", time: "11:30", photo: "tea", caption: "Near Qasr al-Bint",
    line: "A long lunch with nowhere to rush.",
    body: "The only shade in the valley at the hour nobody should be walking. Then mint tea, poured from a height.",
    sky: { bg: "#ffffff", fg: "#1f2a44", fg2: "#535353", rule: "rgba(31,42,68,0.12)" } },
  { stop: "monastery", part: "Afternoon", time: "13:45", photo: "above", caption: "Above Ad Deir",
    line: "A long sit above it all.",
    body: "Eight hundred steps, then a bench, a glass of tea and nothing to do until the stone turns rose.",
    sky: { bg: "#f1e3d4", fg: "#1f2a44", fg2: "#5a4a3e", rule: "rgba(90,74,62,0.18)" } },
  { stop: "night", part: "Evening", time: "20:30", photo: "candles", caption: "Petra by Night",
    line: "Back down the Siq by candlelight.",
    body: "The same walk as this morning, in the dark, to a Treasury lit by candles and a valley gone quiet.",
    sky: { bg: "#090b10", fg: "#ffffff", fg2: "#a8acb3", rule: "rgba(255,255,255,0.14)" } },
];
