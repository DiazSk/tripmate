import { NextResponse } from "next/server";
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

export type CapCheck = { ok: true } | { ok: false; status: 400 | 413; error: string };

// Copy table SV-17.
const tooLong = (n: number) =>
  `That’s longer than TripMate can read at once. Shorten it to under ${n} characters and send it again.`;

/** A non-string is ok: the route's own validation handles it. */
export function checkText(value: unknown, max: number): CapCheck {
  return typeof value === "string" && value.length > max ? { ok: false, status: 413, error: tooLong(max) } : { ok: true };
}

/** True when any string anywhere under `v` (plain objects and arrays) is over `max`. */
function hasLongString(v: unknown, max: number): boolean {
  if (typeof v === "string") return v.length > max;
  if (Array.isArray(v)) return v.some((x) => hasLongString(x, max));
  if (v && typeof v === "object") return Object.values(v).some((x) => hasLongString(x, max));
  return false;
}

/** For a client-sent itinerary: day and stop counts, and every string in it. */
export function checkItinerary(it: unknown): CapCheck {
  const days = (it as { days?: unknown } | null)?.days;
  if (Array.isArray(days)) {
    if (days.length > MAX_TRIP_DAYS) return { ok: false, status: 400, error: "That plan has more days than TripMate can read." };
    for (const d of days) {
      const stops = (d as { stops?: unknown } | null)?.stops;
      if (Array.isArray(stops) && stops.length > CAPS.stopsPerDay) {
        return { ok: false, status: 400, error: "That plan has more stops in a day than TripMate can read." };
      }
    }
  }
  return hasLongString(it, CAPS.stringField) ? { ok: false, status: 400, error: tooLong(CAPS.stringField) } : { ok: true };
}

/**
 * Parse a JSON body, counting the bytes actually read. `content-length` is only a fast path: it is
 * client-supplied and a chunked request can omit it, so the stream is counted too (same shape as
 * importRequest.ts). Returns the parsed value, or a failed CapCheck.
 */
export async function readJsonCapped(req: Request, maxBytes: number = CAPS.bodyBytes): Promise<unknown | CapCheck> {
  const over: CapCheck = { ok: false, status: 413, error: tooLong(maxBytes) };
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
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    return { ok: false, status: 400, error: "Invalid request body." } satisfies CapCheck;
  }
}

export function tooLongResponse(check: Extract<CapCheck, { ok: false }>): NextResponse {
  return NextResponse.json({ error: check.error, code: "too_long" }, { status: check.status });
}
