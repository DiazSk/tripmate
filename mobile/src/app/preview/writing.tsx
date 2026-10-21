import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';

import type { Stop } from '@/api/types';
import { WritingThePlan } from '@/components/writing-the-plan';
import type { PlanDay } from '@/lib/writingPlan';
import { STAGE_ORDER, type StageProgress } from '@shared/generationStages';

/**
 * The wait while a plan is written, driven by a simulated stream — a dev-only route, like
 * `preview/offline.tsx`, because the real screen starts a generation and writes a draft trip and a
 * profile the moment it opens. `tripmate://preview/writing` plays it: the place read, the days
 * sketched, a stop every two seconds, then the ready beat.
 */
const PLACES: [string, number, number, string][] = [
  ['Amber Fort', 26.9855, 75.8513, '09:00'],
  ['Lunch at Peacock Rooftop', 26.9239, 75.8267, '12:30'],
  ['Hawa Mahal', 26.9239, 75.8267, '14:30'],
  ['Nahargarh Fort at sunset', 26.9373, 75.8155, '16:45'],
  ['City Palace', 26.9258, 75.8237, '09:30'],
  ['Jantar Mantar', 26.9248, 75.8246, '11:45'],
  ['Bapu Bazaar', 26.9157, 75.8195, '15:00'],
];
const THEMES = ['Forts above the city', 'Royal Jaipur', 'Stepwells and gardens'];
const FACTS = [
  'The Pink City was painted in 1876 to welcome the Prince of Wales, and the law still keeps it pink.',
  'Jantar Mantar holds the largest stone sundial in the world, true to about two seconds.',
];

const stop = ([name, lat, lng, time]: (typeof PLACES)[number]): Stop => ({
  name,
  lat,
  lng,
  time,
  cost: 0,
  note: '',
  durationLabel: '1 hr',
  category: 'entry',
});

export default function WritingPreview() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!__DEV__) return null;

  const status = (stage: string): StageProgress['status'] => {
    if (stage === 'geocode') return t >= 1 ? 'done' : 'start';
    if (stage === 'context') return t >= 4 ? 'done' : t >= 1 ? 'start' : 'pending';
    if (stage === 'generate') return t >= 4 + PLACES.length * 2 ? 'done' : t >= 4 ? 'start' : 'pending';
    return 'pending';
  };
  const stages = STAGE_ORDER.map((stage) => ({ stage, status: status(stage) }));
  const shown = Math.max(0, Math.min(PLACES.length, Math.floor((t - 5) / 2)));
  const days: PlanDay[] = THEMES.map((theme, i) => ({
    theme: t >= 4 ? theme : null,
    date: `2026-11-0${6 + i}`,
    stops: PLACES.slice(0, shown)
      .map(stop)
      .filter((_, k) => (k < 4 ? 0 : k < 7 ? 1 : 2) === i),
  }));
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <WritingThePlan
        destination="Jaipur, India"
        dateRange="Nov 6 – 8"
        tripDays={3}
        tierName="Mid-range"
        budget={1800}
        stages={stages}
        days={days}
        facts={FACTS}
        raw={null}
        // What the planner holds once Where was picked: the map opens on Jaipur, not the world.
        seed={{ lat: 26.9124, lon: 75.7873 }}
        ready={shown >= PLACES.length && t > 4 + PLACES.length * 2 + 1}
        onCancel={() => setT(0)}
      />
    </>
  );
}
