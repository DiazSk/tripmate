/* Run: node --test src/lib/pois.test.mjs
 *
 * One branch, and it shipped a lie: with no `OPENTRIPMAP_API_KEY` this answered `[]`, which every
 * caller reads as "we asked and this place has nothing" — so a deployment without the key told
 * travellers their destination had no notable places in it. `null` is the house signal for "we
 * could not ask", and `tripFetch`'s `available` flag hangs off exactly this distinction. */
import assert from "node:assert/strict";
import test from "node:test";
import { getCandidatePois } from "./pois.ts";

test("no API key is 'could not ask', not 'nothing here'", async () => {
  const had = process.env.OPENTRIPMAP_API_KEY;
  delete process.env.OPENTRIPMAP_API_KEY;
  try {
    const pois = await getCandidatePois(19.076, 72.8777);
    assert.equal(pois, null, "an empty array here reads as a real, empty answer");
  } finally {
    if (had !== undefined) process.env.OPENTRIPMAP_API_KEY = had;
  }
});
