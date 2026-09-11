/**
 * Whether the destination has public transit. Still unproven, and still deliberately `false`.
 *
 * No free transit-routing data source exists. A driving-only route matrix (OSRM's public demo) was
 * evaluated and removed: this app never requests drive-mode day trips, and the demo instance
 * silently returns driving-speed numbers under the walking/cycling profile names too, so it could
 * never honestly back a walking estimate either. A negative result here means "not proven", not
 * "no transit" — which is why `reconcile.ts` degrades to an assumed walk + transit rather than
 * planning a car-only city.
 *
 * **`RawFetch.transportModes` is no longer permanently unavailable, though, and that is new.** It
 * was documented for the whole life of the pipeline as a gap nothing could fill. `bikeshare.ts`
 * now fills the bike half of it from GBFS — a free, keyless source — so a destination with a
 * resolved bikeshare reaches Step 3 with `available: true` and a real mode in the list. This
 * function is the transit half, and it remains the stub it always was. Don't read the sibling
 * change as license to guess here: the reason bikeshare could be answered is that operators
 * publish their own dock coordinates, and nobody publishes an equivalent for buses.
 */
export async function probeTransitAvailable(): Promise<boolean> {
  return false;
}
