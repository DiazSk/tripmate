/**
 * Score the coordinates of plans already on disk.
 *
 * **Why this is not `npm run bench`.** The harness calls `generateItinerary()` — the staged path —
 * and every geometric scorer in it resolves a stop through `findPoi(name, knownPois(fixture))`,
 * using the *fixture's* coordinate rather than the model's. So a stop carrying a confidently wrong
 * coordinate scores clean, and the bench cannot see this defect at any price. `scoreCoordinates`
 * reads what the model actually wrote; this points it at stored trips so the question costs
 * nothing to ask.
 *
 * Usage:
 *   node --import ./scripts/ts-resolve.mjs scripts/coord-check.mjs            # every stored trip
 *   node --import ./scripts/ts-resolve.mjs scripts/coord-check.mjs <tripId>…  # just these
 *
 * Reads whichever database `.env.local` points at — with `TURSO_DATABASE_URL` set that is the
 * hosted one, and the local `tripmate.db` is a stale artifact.
 */
import { getTrip, listTrips } from "../src/lib/db.ts";
import { itineraryToParsed } from "../src/lib/bench/itineraryToParsed.ts";
import { scoreCoordinates } from "../src/lib/bench/scorers/coordinates.ts";

const ids = process.argv.slice(2);
const targets = ids.length
  ? ids
  : [...listTrips("saved"), ...listTrips("draft")].map((t) => t.id);

if (targets.length === 0) {
  console.log("no trips stored");
  process.exit(0);
}

let worst = 1;

for (const id of targets) {
  const row = getTrip(id);
  if (!row) {
    console.log(`${id}  — not found`);
    continue;
  }

  let score;
  try {
    score = scoreCoordinates(itineraryToParsed(JSON.parse(row.itinerary_json)));
  } catch (err) {
    console.log(`${id}  ${row.destination} — unreadable: ${err.message}`);
    continue;
  }

  const pct = score.normalized === null ? " n/a" : `${(score.normalized * 100).toFixed(0)}%`;
  console.log(
    `\n${id.slice(0, 8)}  ${row.destination}  (${row.start_date} → ${row.end_date}, ${row.status})`
  );
  console.log(
    `  ${score.located} located · ${score.named} named a venue · ` +
      `${score.colliding} colliding · largest point holds ${score.maxCluster} · score ${pct}`
  );

  for (const c of score.collisions) {
    console.log(`  ${c.lat.toFixed(5)},${c.lng.toFixed(5)} claims ${c.venues.length}:`);
    for (const v of c.venues) console.log(`      ${v}`);
  }

  if (score.normalized !== null) worst = Math.min(worst, score.normalized);
}

// Non-zero when any plan has a venue collision, so this can gate something later if it earns it.
process.exit(worst < 1 ? 1 : 0);
