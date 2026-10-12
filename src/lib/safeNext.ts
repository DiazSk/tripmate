const BASE = "http://tripmate.invalid";

/**
 * A `?next=` value that is safe to navigate to: a path on this site, else `fallback`. It resolves the
 * value and compares origins rather than pattern-matching the string — the URL parser strips tabs and
 * newlines and treats `\` as `/`, so `"/\t/evil.com"` passes every string test and lands off-site.
 */
export function safeNextPath(next: unknown, fallback = "/trips"): string {
  if (typeof next !== "string") return fallback;
  try {
    const url = new URL(next, BASE);
    return url.origin === BASE ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}
