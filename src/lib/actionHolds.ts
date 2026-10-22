/* A limited action stays held until its wait ends, wherever the traveller navigates.
 *
 * State is a module store (survives client-side navigation) mirrored to sessionStorage (survives
 * a reload). Expiry needs no event: `secondsLeft` is derived from the clock, and the hook's one
 * timer just re-reads it each second until it reads null. */
import { useSyncExternalStore } from "react";
import type { Bucket } from "./ipThrottle";

const KEY = "tripmateHolds";

/** Mirrors `Bucket` (ipThrottle.ts is server code, so it can't be imported as a value). `satisfies` rejects a
 *  stale entry, the line below a missing one. */
const BUCKETS = [
  "plan", "edit", "place-detail", "story", "import", "import-plan", "import-plan-complete", "geocode-place", "idea",
  "context", "lookup", "refusal",
] as const satisfies readonly Bucket[];
const _exhaustive: Exclude<Bucket, (typeof BUCKETS)[number]> extends never ? true : never = true;
void _exhaustive;
export const isBucket = (v: unknown): v is Bucket => (BUCKETS as readonly unknown[]).includes(v);
let holds: Record<string, number> = {};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function load() {
  try {
    const raw = JSON.parse(globalThis.sessionStorage?.getItem(KEY) ?? "{}");
    const now = Date.now();
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (isBucket(k) && typeof v === "number" && v > now) holds[k] = v;
    }
  } catch {
    /* storage blocked or corrupt: start empty */
  }
}
load();

function save() {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(holds));
  } catch {
    /* in-memory hold still works */
  }
}

/** Hold `bucket` until `untilMs`; a later call replaces an earlier one. */
export function holdAction(bucket: Bucket, untilMs: number): void {
  holds = { ...holds, [bucket]: untilMs };
  save();
  listeners.forEach((l) => l());
}

/** The hold's end time, or null when there is none or it has passed. */
export function heldUntil(bucket: Bucket, now = Date.now()): number | null {
  const t = holds[bucket];
  return t !== undefined && t > now ? t : null;
}

export function secondsLeft(bucket: Bucket, now = Date.now()): number | null {
  const t = heldUntil(bucket, now);
  return t === null ? null : Math.ceil((t - now) / 1000);
}

/** 342 -> "5:42", 3605 -> "1:00:05". */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function subscribe(l: () => void) {
  listeners.add(l);
  timer ??= setInterval(() => listeners.forEach((fn) => fn()), 1000);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Re-renders each second while held, then once to null. */
export function useHold(bucket: Bucket): { secondsLeft: number | null } {
  const s = useSyncExternalStore(
    subscribe,
    () => secondsLeft(bucket),
    () => null,
  );
  return { secondsLeft: s };
}
