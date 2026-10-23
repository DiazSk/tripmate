/**
 * The holding pen for events fired before the SDK is up (a screen's mount effect runs before the
 * provider has read the stored answer and imported the SDK). It is a plain queue; the consent
 * rules live in the three calls `client.ts` makes on it:
 *
 * - `hold(item, allowed)` keeps an item only while `allowed` (no stored answer, not withdrawn).
 * - `clear()` on a Yes tapped in the prompt or the Profile switch, so nothing from before the tap is sent.
 * - `take()` on a stored Yes found at load: what is still fresh comes out, the rest is dropped.
 */
export function createHeld<T>({ cap = 50, ttlMs = 10_000, now = Date.now }: { cap?: number; ttlMs?: number; now?: () => number } = {}) {
  let items: { item: T; until: number }[] = [];
  return {
    hold(item: T, allowed: boolean): void {
      if (!allowed) return;
      const t = now();
      items = items.filter((i) => i.until > t);
      if (items.length < cap) items.push({ item, until: t + ttlMs });
    },
    clear(): void {
      items = [];
    },
    take(): T[] {
      const t = now();
      const fresh = items.filter((i) => i.until > t).map((i) => i.item);
      items = [];
      return fresh;
    },
  };
}
