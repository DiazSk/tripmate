import { failureFromResponse, failureFromThrown, formatResumeTime, isAbort, type Failure } from "./failure";
import type { IdeaRead } from "./ideaRead";
import type { ReadyTrip } from "./readyTrips";

/** What the landing's Meri pill needs from the server: reading a sentence, and the ready-made trips. */

export type IdeaOutcome = { ok: true; read: IdeaRead } | { ok: false; failure: Failure } | { ok: false; aborted: true };

export async function readIdea(idea: string, signal?: AbortSignal): Promise<IdeaOutcome> {
  try {
    const res = await fetch("/api/read-idea", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea }),
      signal,
    });
    if (!res.ok) return { ok: false, failure: await failureFromResponse(res, "idea") };
    // The route has already run parseIdeaRead; nothing else reaches a 200.
    return { ok: true, read: (await res.json()) as IdeaRead };
  } catch (e) {
    return isAbort(e) ? { ok: false, aborted: true } : { ok: false, failure: failureFromThrown(e) };
  }
}

/** Copy rows SV-25..SV-28, PH-01 and LM-01 (docs/superpowers/plans/2026-10-17-error-messages-copy.md). */
export function ideaFailureCopy(f: Failure): string {
  switch (f.kind) {
    case "rate_limited": {
      const minutes = Math.max(1, Math.ceil(f.retryAfterSeconds / 60));
      // The server's own numbers when it sent them; 20 per 10 minutes is the row's wording.
      return `You’ve asked Meri to read ${f.limit || 20} trip ideas in the last ${f.windowMinutes || 10} minutes, which is the limit. You can ask again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
    }
    case "timeout":
      return "Reading your idea took longer than TripMate allows, so it stopped. Try again.";
    case "refused":
    case "invalid":
      return f.message;
    case "offline":
      return "Meri can read your idea when you’re back online.";
    case "daily_cap":
      return `Meri is paused for everyone until ${formatResumeTime(f.resumesAt)}. TripMate has reached its limit for the day; it isn’t anything you did. You can still plan step by step.`;
    default:
      return "Couldn’t read that idea. Try again, or plan it step by step.";
  }
}

/** A 200 that carries no place, kind or days is a sentence Meri could not use: show PH-02, not an empty plan. */
export const understoodNothing = (r: IdeaRead): boolean => !r.destination && !r.kind && r.days == null;

// Only a success is kept: a failure cached for the page's life would leave the pill without trips
// after one dropped request, with nothing to retry it.
let readyTrips: Promise<ReadyTrip[]> | null = null;

export function loadReadyTrips(): Promise<ReadyTrip[]> {
  if (readyTrips) return readyTrips;
  const p = (async () => {
    try {
      const res = await fetch("/api/ready-trips");
      if (!res.ok) return null;
      const body = (await res.json()) as { available?: boolean; trips?: ReadyTrip[] };
      return body.available ? (body.trips ?? []) : null;
    } catch {
      return null;
    }
  })();
  readyTrips = p.then((trips) => {
    if (!trips) readyTrips = null;
    return trips ?? [];
  });
  return readyTrips;
}
