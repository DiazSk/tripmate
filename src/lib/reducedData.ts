/**
 * Whether the visitor has asked us — or their network has told us — to move less data.
 *
 * This exists for one caller and one asset: the hero film is **9.76MB**, which is the largest
 * thing this product will ever hand a stranger, and it is decorative. Somebody on a metered plan
 * should not pay for it to look nice. The gate is free because `Hero` already has one: the film is
 * opt-in behind `data-seq`, so declining is a no-op that leaves the poster hero in place — the same
 * path `prefers-reduced-motion` takes.
 *
 * Deliberately a sibling of `reducedMotion.ts` rather than an addition to it. That module's own
 * doc insists it is a pure leaf with no React import and one job; motion and bandwidth are two
 * different questions that happen to gate the same element, and `Hero` composes them.
 *
 * ## Three signals, and why the third is different from the first two
 *
 * - **`prefers-reduced-data: reduce`** — the standards-track query. Thinly shipped today, and
 *   that is fine: `matchMedia` on an unrecognised query returns `matches: false`, so an
 *   unsupporting browser reads as "no preference" rather than throwing. It costs nothing to
 *   honour early and it is the signal that will outlive the other two.
 * - **`navigator.connection.saveData`** — Data Saver, an explicit user setting. Chromium and
 *   Android only; `navigator.connection` is simply absent in Safari and Firefox, hence the guard.
 *
 * Both of those are the visitor *asking*. The third is us guessing:
 *
 * - **`effectiveType` of `2g` or `slow-2g`** — inferred, not declared, and heuristics are wrong
 *   sometimes. Included anyway because the error is asymmetric: a false positive costs a decorative
 *   film that has a good fallback, while a false negative means 9.76MB saturating a connection the
 *   visitor is trying to use for the actual page. `3g` is deliberately *not* included — the film
 *   loads progressively and is scrubbable from about a quarter of the frames, so a 3G visitor gets
 *   something rather than nothing.
 */

/** The slice of the Network Information API this needs. Not in TypeScript's DOM lib. */
type NetworkInformationLike = {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

const connection = (): NetworkInformationLike | undefined =>
  typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { connection?: NetworkInformationLike }).connection;

const CRAWLING = new Set(["slow-2g", "2g"]);

export const prefersReducedData = (): boolean => {
  if (typeof window === "undefined") return true;
  if (window.matchMedia("(prefers-reduced-data: reduce)").matches) return true;
  const c = connection();
  if (!c) return false;
  return c.saveData === true || (!!c.effectiveType && CRAWLING.has(c.effectiveType));
};

/**
 * Subscribe form, for `useSyncExternalStore`. Pair it with a server snapshot of `true` — the
 * server cannot know the connection, and the version that has to be correct without JavaScript is
 * the one that downloads nothing.
 *
 * Both sources are watched, because both change mid-session: the visitor can toggle Data Saver,
 * and `effectiveType` is re-estimated as the connection changes.
 */
export function subscribeReducedData(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia("(prefers-reduced-data: reduce)");
  query.addEventListener("change", onChange);
  const c = connection();
  c?.addEventListener?.("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
    c?.removeEventListener?.("change", onChange);
  };
}
