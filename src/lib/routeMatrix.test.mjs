/* Run: node --test src/lib/routeMatrix.test.mjs
 *
 * The OSRM route-matrix fetch (`fetchDayTravelMinutes`/`distilRouteMatrix`) was removed: this
 * app never requests drive-mode day trips, `walk` had no entry in the mode map (OSRM's public
 * demo can't serve real walking-network data), so the whole fetch path was unreachable dead code.
 * `probeTransitAvailable` is the one function from this module that's still real and reachable.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { probeTransitAvailable } from "./routeMatrix.ts";

test("probeTransitAvailable is unconditionally false — no free transit data source exists", async () => {
  assert.equal(await probeTransitAvailable(), false);
});
