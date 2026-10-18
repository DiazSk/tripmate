import { NextResponse } from "next/server";
import { insertRefusalTrace } from "./db";
import { throttle, type Bucket, type ThrottleResult } from "./ipThrottle";
import { ModelTimeoutError } from "./modelTimeout";
import { screenRequest } from "./promptScope";

/**
 * The structured refusals: a 429 for a per-IP limit, a 503 for the daily cap, a 504 for a model
 * that ran out of time. The body carries what a client needs to hold the control and count down
 * (`code`, `bucket`, `retryAfterSeconds`) so it never has to parse the sentence; the sentence is
 * for a client with no row of its own, such as the phone app.
 *
 * Every `error` sentence is a copy-table row (docs/superpowers/plans/2026-10-17-error-messages-copy.md,
 * section 9, SV-*), typographic apostrophes included. Change them there first.
 */

/** The unit for a count: `unit(1, "minute")` is "minute", `unit(2, "minute")` is "minutes". */
export function unit(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/** "1 minute", "2 minutes". */
const count = (n: number, word: string) => `${n} ${unit(n, word)}`;

/** `refusal` is internal (the scope guard counts it) and is never answered as a 429, so it has no sentence. */
type LimitedBucket = Exclude<Bucket, "refusal">;

const LIMIT_SENTENCES: Record<LimitedBucket, (wait: string) => string> = {
  plan: (w) => `You’ve planned 3 trips in the last 10 minutes, which is the limit. You can plan another in about ${w}.`,
  edit: (w) => `You’ve asked TripMate for 6 changes in the last 10 minutes, which is the limit. You can ask for another in about ${w}.`,
  "place-detail": (w) =>
    `You’ve opened the details of 10 places in the last 10 minutes, which is the limit. You can open another in about ${w}.`,
  story: (w) => `You’ve started 6 new stories in the last 10 minutes, which is the limit. New stories are back in about ${w}.`,
  import: (w) =>
    `You’ve asked TripMate to read places 30 times in the last 10 minutes, which is the limit. You can try again in about ${w}.`,
  "import-plan": (w) => `You’ve brought in 30 plans in the last 10 minutes, which is the limit. You can try again in about ${w}.`,
  "import-plan-complete": (w) =>
    `You’ve saved 30 imported plans in the last 10 minutes, which is the limit. You can try again in about ${w}.`,
  "geocode-place": (w) => `You’ve looked up 60 places in the last 10 minutes, which is the limit. You can look again in about ${w}.`,
  context: (w) =>
    `TripMate looked up 10 destinations in the last 10 minutes, which is the limit. It can look up another in about ${w}.`,
  lookup: (w) => `TripMate looked up a lot of places in the last 10 minutes. It can look again in about ${w}.`,
};

/** SV-09, for `/api/route`'s own limiter. */
export function routeLimitSentence(seconds: number): string {
  return `Too many walking-time lookups in the last minute. They’ll be ready again in about ${count(seconds, "second")}.`;
}

/** SV-11..SV-13: what ran out of time, keyed by the allowance it belongs to. */
export const TIMEOUT_SENTENCES = {
  plan: "Writing your plan took longer than TripMate allows, so it stopped. Your answers are kept. Try again.",
  edit: "TripMate took longer than it allows to make that change, so it stopped. Your plan is unchanged. Try again.",
  "place-detail":
    "Writing the details for this place took longer than TripMate allows, so it stopped. Your plan is unchanged. Try again.",
} satisfies Partial<Record<Bucket, string>>;

/** SV-14..SV-16: what the scope guard says when it refuses, per surface. */
export const OFF_TOPIC_SENTENCES = {
  chat: "TripMate can only help with this trip: its stops, timing, costs and getting around. Ask about the plan, or ask for a change to it.",
  element: "TripMate can only swap this stop for another place to go. Describe the stop you’d like instead.",
  refine: "TripMate can only change this trip. Say what you’d like different about the plan.",
};

export function offTopicResponse(kind: keyof typeof OFF_TOPIC_SENTENCES): NextResponse {
  return NextResponse.json({ error: OFF_TOPIC_SENTENCES[kind], code: "off_topic" }, { status: 422 });
}

/**
 * The free check, run before the route's throttle so a refusal costs the traveller none of their
 * allowance. Null when the text passes. A refusal is logged as a trace row only while the caller's
 * `refusal` bucket has room: it costs an attacker nothing, so unbounded logging would let anyone
 * fill the table. Over the bucket it is still refused, just not written down.
 */
export function prefilterRefusal(
  req: { headers: { get(name: string): string | null } },
  text: unknown,
  type: string,
  kind: keyof typeof OFF_TOPIC_SENTENCES
): NextResponse | null {
  if (typeof text !== "string") return null;
  const screen = screenRequest(text);
  if (!screen.refused) return null;
  if (!throttle(req, "refusal").limited) insertRefusalTrace({ type, prompt: text, rule: screen.rule });
  return offTopicResponse(kind);
}

export function limitResponse(r: Extract<ThrottleResult, { limited: true }>, bucket: LimitedBucket): NextResponse {
  const { retryAfterSeconds, limit, windowMinutes } = r;
  return NextResponse.json(
    {
      error: LIMIT_SENTENCES[bucket](count(Math.ceil(retryAfterSeconds / 60), "minute")),
      code: "rate_limited",
      bucket,
      retryAfterSeconds,
      limit,
      windowMinutes,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

/** The server does not know the traveller's clock, so the sentence says hours and the client
 *  turns `retryAfterSeconds` into a local time. */
export function capResponse(resumesAt: Date, now = Date.now()): NextResponse {
  const retryAfterSeconds = Math.max(1, Math.ceil((resumesAt.getTime() - now) / 1000));
  const hours = Math.ceil(retryAfterSeconds / 3600);
  return NextResponse.json(
    {
      error: `Planning and changes by TripMate are paused for everyone for about ${hours} more ${unit(hours, "hour")}. It has reached its limit for the day; it isn’t anything you did. Your trips, hand edits and the map still work.`,
      code: "daily_cap",
      retryAfterSeconds,
    },
    { status: 503, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

/**
 * A model call's failure as a response: 504 with `code: "timeout"` and the action's timeout
 * sentence when it ran out of time, so the client can say "it took too long" rather than "it
 * broke"; the route's own 500 otherwise.
 */
export function modelFailureResponse(err: unknown, error: string, action: keyof typeof TIMEOUT_SENTENCES): NextResponse {
  return err instanceof ModelTimeoutError
    ? NextResponse.json({ error: TIMEOUT_SENTENCES[action], code: "timeout" }, { status: 504 })
    : NextResponse.json({ error }, { status: 500 });
}
