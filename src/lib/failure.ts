/* Reads any failed request into one typed Failure, so no screen shows `e.message` from fetch or a
 * status code. Copy lives elsewhere; this only decides which kind of failure it was. */
import { holdAction, isBucket } from "./actionHolds";
import type { Bucket } from "./ipThrottle";

export type Failure =
  | { kind: "offline" }
  | { kind: "timeout" }
  | { kind: "rate_limited"; bucket: Bucket; retryAfterSeconds: number; limit: number; windowMinutes: number }
  | { kind: "daily_cap"; resumesAt: Date }
  | { kind: "not_found" }
  | { kind: "signed_out" }
  | { kind: "invalid"; message: string }
  | { kind: "server" };

type Body = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Same mapping for an HTTP error body and for an SSE `error` event's data. */
function fromCode(body: Body, retryHeader: number | null, now: number, hint: Bucket): Failure | null {
  if (body.code === "timeout") return { kind: "timeout" };
  if (body.code === "daily_cap") {
    return { kind: "daily_cap", resumesAt: new Date(now + (num(body.retryAfterSeconds) ?? retryHeader ?? 60) * 1000) };
  }
  if (body.code === "rate_limited") {
    return {
      kind: "rate_limited",
      bucket: isBucket(body.bucket) ? body.bucket : hint,
      retryAfterSeconds: num(body.retryAfterSeconds) ?? retryHeader ?? 60,
      limit: num(body.limit) ?? 0,
      windowMinutes: num(body.windowMinutes) ?? 0,
    };
  }
  return null;
}

/** The caller names its action: a 429 with no readable body must hold that action, never a guess. */
export async function failureFromResponse(res: Response, bucketHint: Bucket, now = Date.now()): Promise<Failure> {
  let body: Body = {};
  try {
    const j = await res.json();
    if (j && typeof j === "object") body = j as Body;
  } catch {
    /* no body: fall back to the status and Retry-After */
  }
  const header = num(parseInt(res.headers.get("Retry-After") ?? "", 10));
  const coded = fromCode(body, header, now, bucketHint);
  if (coded) return coded;
  if (res.status === 429) return fromCode({ ...body, code: "rate_limited" }, header, now, bucketHint)!;
  if (res.status === 400 || res.status === 422) {
    return typeof body.error === "string" && body.error ? { kind: "invalid", message: body.error } : { kind: "server" };
  }
  if (res.status === 401) return { kind: "signed_out" };
  if (res.status === 404) return { kind: "not_found" };
  if (res.status === 504) return { kind: "timeout" };
  return { kind: "server" };
}

/** An SSE `error` event: the stream's HTTP status was already 200, so the code is all there is. */
export function failureFromStreamError(data: unknown, bucketHint: Bucket, now = Date.now()): Failure {
  const body = data && typeof data === "object" ? (data as Body) : {};
  return fromCode(body, null, now, bucketHint) ?? { kind: "server" };
}

/** A user cancel (AbortController.abort()), not a failure: check this first and show nothing. */
export const isAbort = (e: unknown): boolean => (e as { name?: string } | null)?.name === "AbortError";

/** Maps a thrown fetch error. An abort is not a `Failure`: callers test `isAbort` first. */
export function failureFromThrown(
  e: unknown,
  online = typeof navigator === "undefined" ? true : navigator.onLine,
): Failure {
  const name = (e as { name?: string } | null)?.name;
  if (name === "TimeoutError") return { kind: "timeout" };
  if (e instanceof TypeError && !online) return { kind: "offline" };
  return { kind: "server" };
}

export function holdFromFailure(f: Failure): void {
  if (f.kind === "rate_limited") holdAction(f.bucket, Date.now() + f.retryAfterSeconds * 1000);
}
