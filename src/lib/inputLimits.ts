import { NextResponse } from "next/server";
import { screenRequest } from "./promptScope";
import { MAX_TRIP_DAYS } from "./tiers";

/**
 * How much text a request may hand the model. Nothing else bounds it (Next's own body limit is
 * ~10MB), so a single request could otherwise be made very expensive. The client validates before
 * sending; these answer a raw POST.
 */
export const CAPS = {
  message: 2000,
  instruction: 500,
  feedback: 2000,
  placeName: 200,
  destination: 200,
  historyTurns: 20,
  stopsPerDay: 15,
  stringField: 500,
  bodyBytes: 256 * 1024,
} as const;

export type CapFailure = { ok: false; status: 400 | 413; code: "too_long" | "bad_request"; error: string };
export type CapCheck = { ok: true } | CapFailure;

const MAX_DEPTH = 64;

// Copy table SV-17 (text and itinerary strings), SV-20 (body bytes), SV-21/22 (day and stop
// counts), SV-23 (unreadable body, or nested too deep).
const tooLong = (n: number) =>
  `That’s longer than TripMate can read at once. Shorten it to under ${n} characters and send it again.`;
const BODY_TOO_BIG = "That’s more than TripMate can read at once. Send less and try again.";
const TOO_MANY_DAYS = `That plan has more than ${MAX_TRIP_DAYS} days, which is more than TripMate can read at once. Remove some and send it again.`;
const TOO_MANY_STOPS = `A day in that plan has more than ${CAPS.stopsPerDay} stops, which is more than TripMate can read at once. Remove some and send it again.`;
const UNREADABLE = "TripMate couldn’t read that request. Try again, and if it keeps happening, reload the page.";

const badRequest = (error: string): CapFailure => ({ ok: false, status: 400, code: "bad_request", error });

/** SV-23, for a route whose request parsed but holds something it cannot read (a non-text message). */
export const UNREADABLE_REQUEST: CapFailure = badRequest(UNREADABLE);

/**
 * A non-string is ok: the route's own validation handles it. `.length` counts UTF-16 code units,
 * not characters, so an emoji counts as two.
 */
export function checkText(value: unknown, max: number): CapCheck {
  return typeof value === "string" && value.length > max
    ? { ok: false, status: 413, code: "too_long", error: tooLong(max) }
    : { ok: true };
}

/** Iterative (an explicit stack), so a hostile nesting depth cannot overflow the call stack. */
function scan(root: unknown, max: number): "long" | "deep" | null {
  const stack: [unknown, number][] = [[root, 0]];
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    if (typeof v === "string") {
      if (v.length > max) return "long";
    } else if (v && typeof v === "object") {
      if (depth >= MAX_DEPTH) return "deep";
      for (const x of Object.values(v)) stack.push([x, depth + 1]);
    }
  }
  return null;
}

/**
 * For a client-sent itinerary (`{ days }`, or a bare days array): day and stop counts, then every
 * string in it. A non-array `days` or `stops` passes: route validation owns the shape.
 */
export function checkItinerary(it: unknown): CapCheck {
  const days = Array.isArray(it) ? it : (it as { days?: unknown } | null)?.days;
  if (Array.isArray(days)) {
    if (days.length > MAX_TRIP_DAYS) return badRequest(TOO_MANY_DAYS);
    for (const d of days) {
      const stops = (d as { stops?: unknown } | null)?.stops;
      if (Array.isArray(stops) && stops.length > CAPS.stopsPerDay) return badRequest(TOO_MANY_STOPS);
    }
  }
  const found = scan(it, CAPS.stringField);
  if (found === "deep") return badRequest(UNREADABLE);
  return found ? { ok: false, status: 400, code: "too_long", error: tooLong(CAPS.stringField) } : { ok: true };
}

/**
 * Parse a JSON body, counting the bytes actually read. `content-length` is only a fast path: it is
 * client-supplied and a chunked request can omit it, so the stream is counted too (same shape as
 * importRequest.ts). The parsed body sits under `value`, never at the top level, so a body that
 * looks like a failure cannot be mistaken for one.
 */
export async function readJsonCapped(
  req: Request,
  maxBytes: number = CAPS.bodyBytes
): Promise<{ ok: true; value: unknown } | CapFailure> {
  const over: CapFailure = { ok: false, status: 413, code: "too_long", error: BODY_TOO_BIG };
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return over;
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return over;
      }
      chunks.push(value);
    }
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) };
  } catch {
    return badRequest(UNREADABLE);
  }
}

export function capFailureResponse(f: CapFailure): NextResponse {
  return NextResponse.json({ error: f.error, code: f.code }, { status: f.status });
}

type Turn = { role: "user" | "assistant"; content: string };

/**
 * The conversation a rebuilt chat prompt replays. A saved trip replays its own stored transcript
 * plus the client's latest message (always as the traveller's), so a client cannot hand the model
 * a history it never had. An unsaved trip has no transcript and keeps the client's array, minus any
 * traveller turn the free check refuses, so a refused message is never replayed on a rebuild.
 * Either way: the last `historyTurns`, each cut to the message cap.
 */
export function chatHistory(
  stored: { role: string; content: string }[] | null,
  client: { role?: unknown; content?: unknown }[]
): Turn[] {
  const turns: Turn[] = (
    stored ? [...stored, { ...client[client.length - 1], role: "user" }] : client
  ).map((t) => ({
    role: t?.role === "assistant" ? "assistant" : "user",
    content: String(t?.content ?? "").slice(0, CAPS.message),
  }));
  const kept = stored ? turns : turns.filter((t) => t.role === "assistant" || !screenRequest(t.content).refused);
  return kept.slice(-CAPS.historyTurns);
}
