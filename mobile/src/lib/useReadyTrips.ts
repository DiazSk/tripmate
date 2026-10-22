import { useEffect, useState } from 'react';

import type { ReadyTrip } from '@shared/readyTrips';

import { loadReadyTrips, readCachedReadyTrips } from '@/lib/tripCache';

/**
 * The catalogue, for a screen opened from it: the copy on disk at once (Home wrote it when it drew
 * the card), so the sheet opens drawn and offline; else one live read. `undefined` while that read
 * runs, `null` when nothing came back. `enabled: false` (the planner opened without a trip) reads
 * and asks nothing, and is `null`.
 */
export function useReadyTrips(enabled = true): ReadyTrip[] | null | undefined {
  const [trips, setTrips] = useState<ReadyTrip[] | null | undefined>(() => (enabled ? readCachedReadyTrips()?.value : null));
  useEffect(() => {
    if (!enabled || trips !== undefined) return;
    let alive = true;
    loadReadyTrips().then((r) => alive && setTrips(r && 'value' in r ? r.value : null));
    return () => {
      alive = false;
    };
  }, [enabled, trips]);
  return enabled ? trips : null;
}
