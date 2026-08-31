/**
 * Fills the `transportModes` placeholder in `RawFetch`, a permanent `available: false` since the
 * pipeline shipped ("no reliable free data source for this yet").
 *
 * No free transit-routing data source exists. A driving-only route matrix (OSRM's public demo)
 * was evaluated and removed: this app never requests drive-mode day trips, and the demo instance
 * silently returns driving-speed numbers under the walking/cycling profile names too, so it could
 * never honestly back a walking estimate either. Always false, consistent with this function's
 * own documented contract: a negative result means "not proven," not "no transit."
 */
export async function probeTransitAvailable(): Promise<boolean> {
  return false;
}
