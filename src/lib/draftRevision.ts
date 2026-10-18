/**
 * Tells the trip page showing a draft that a critique revision has landed on its row.
 *
 * A finished plan opens on `/trip/[id]` while the critique is still reading it, so the stream that
 * will carry the revision belongs to a view that has already unmounted. A client-side navigation
 * keeps this module (and that fetch) alive, so this is the one piece of state both sides can see.
 * The server has already written the revision to the row (`applyRevisionIfUnedited`); this only
 * says so, and the page re-reads the row, which would otherwise show the old plan until a reload.
 *
 * One slot, held until taken: the revision can arrive before the trip page has mounted, and it is
 * delivered once, so a later visit to the same trip never re-reads on its account.
 */

let held: string | null = null;
let listener: { tripId: string; take: () => void } | null = null;

export function announceDraftRevision(tripId: string): void {
  if (listener?.tripId === tripId) listener.take();
  else held = tripId;
}

/** Subscribe the trip page for `tripId`. Returns the unsubscribe, for an effect's cleanup. */
export function onDraftRevision(tripId: string, take: () => void): () => void {
  const mine = { tripId, take };
  listener = mine;
  if (held === tripId) {
    held = null;
    take();
  }
  return () => {
    if (listener === mine) listener = null;
  };
}
