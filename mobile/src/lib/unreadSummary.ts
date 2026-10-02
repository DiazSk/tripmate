/**
 * The import's refusals, said once each.
 *
 * `/api/import` reports one reason per item it could not read, so four unreadable files produced
 * four copies of "Couldn't read this screenshot" stacked under the composer — a wall rather than a
 * report, and the repetition carried no information the count doesn't.
 *
 * **The count is appended, not folded in.** These sentences are the server's, and turning
 * "Couldn't read this screenshot" into a plural would mean rewriting someone else's prose from
 * the client — which breaks the moment the server adds a reason with a different shape. A suffix
 * works on any sentence.
 *
 * First-seen order is kept, so the list still reads in the order the items were sent.
 */
export function summariseUnread(reasons: string[]): string[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => (n > 1 ? `${reason} (${n} of them)` : reason));
}
