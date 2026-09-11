import test from "node:test";
import assert from "node:assert/strict";
import {
  PEEK_MIN_HEIGHT_M,
  PEEK_ZOOM_FACTOR,
  metresBetween,
  nearestSeparableM,
  peekFlightSeconds,
  peekRangeM,
  ringRangeM,
  centreHeightOffsetPx,
} from "./peekRange.ts";

/** Distances taken from the trips in this repo's database, so the cases are the real shapes:
 *  a walkable pocket, a normal city day, and a day with an outlier hours away. */
const POCKET = [80, 151, 190, 260, 632];
const CITY_DAY = [296, 380, 520, 935, 1200];
const OUTLIER_STOP = [4682, 6359, 12077];
/** Fushimi Inari on its Kyoto day: 12km from anything else on it. */
const FAR_STOP = [12_077, 13_500];

test("great-circle distance matches a known separation", () => {
  // Kyoto Station to Kiyomizu-dera, ~2.1km apart.
  const d = metresBetween({ lat: 34.9858, lng: 135.7588 }, { lat: 34.9949, lng: 135.7851 });
  assert.ok(d > 2400 && d < 2700, `expected ~2.5km, got ${Math.round(d)}m`);
});

test("distance to itself is zero", () => {
  assert.equal(metresBetween({ lat: 35, lng: 135 }, { lat: 35, lng: 135 }), 0);
});

test("the scale is the nearest neighbour, not an average of the nearest few", () => {
  // The case an average got wrong: one close neighbour among distant ones is exactly the blob
  // a peek has to break apart, and averaging it with the distant ones erases it.
  assert.equal(nearestSeparableM([80, 2400, 3100]), 80);
  assert.equal(nearestSeparableM(POCKET), 80);
});

test("co-located stops are ignored rather than collapsing the scale to nothing", () => {
  // "Lunch at the temple café" on the temple's own coordinates is a real itinerary shape.
  assert.equal(nearestSeparableM([0, 0, 300, 400, 500]), 300);
});

test("a stop alone in its day has no neighbour to separate from", () => {
  assert.equal(nearestSeparableM([]), null);
});

test("a stop whose every neighbour shares its coordinates has none either", () => {
  // Nothing a closer look could separate, so there is no scale to derive.
  assert.equal(nearestSeparableM([0, 3, 12]), null);
});

test("the innermost ring that catches a neighbour is the one that answers", () => {
  assert.equal(ringRangeM([80, 900, 4000]), ringRangeM([99]));
  assert.notEqual(ringRangeM([99]), ringRangeM([101]));
  // Monotonic across the whole table, and every ring distinct from its neighbours.
  const edges = [50, 100, 101, 200, 201, 400, 401, 800, 801, 1600, 1601, 3200, 3201, 6400];
  const ranges = edges.map((d) => ringRangeM([d]));
  assert.deepEqual(ranges, [...ranges].sort((a, b) => a - b));
  assert.equal(new Set(ranges).size, 7);
});

test("a stop with nothing inside the outermost ring has no pocket to frame", () => {
  // Fushimi Inari, 12km from anything else on its day. The answer is the city, not a dive.
  assert.equal(ringRangeM(FAR_STOP), null);
  assert.equal(peekRangeM(30_000, FAR_STOP), 15_000);
});

test("a spread-out day still gets exactly the plain halving", () => {
  // The behaviour that was already right: the rings must not touch it.
  assert.equal(peekRangeM(9000, OUTLIER_STOP), 4500);
});

test("a ring is never much wider than the neighbour it is framing asked for", () => {
  // The failure of an edge-anchored table: a 128m neighbour framed as if it were 200m away.
  // Every distance in the saved trips, against the 2.5x its own nearest neighbour asks for —
  // no stop may be framed more than 1.45x wider than that, except where the mesh floor rules.
  for (const d of [52, 76, 100, 128, 151, 178, 263, 317, 413, 632, 935, 1200, 4682]) {
    const ring = ringRangeM([d]);
    assert.ok(ring <= 2.5 * d * 1.45 || ring <= 250, `${d}m neighbour framed at ${ring}m`);
  }
});

test("the same pocket gets the same range however wide the day was framed", () => {
  // The bug this rewrite exists for: the old cap tied the peek to the day's framing, so a pair
  // 76m apart resolved to 728m on one day and 5099m on another. A ring is a ring.
  const tightlyFramedDay = peekRangeM(1700, [76, 1400]);
  const dayWithAnOutlier = peekRangeM(12_500, [76, 1400]);
  assert.equal(tightlyFramedDay, dayWithAnOutlier);
});

test("every stop of one pocket resolves to one range, so a sweep pans instead of re-scaling", () => {
  const pocket = [80, 90, 100].map((d) => peekRangeM(6000, [d, 700]));
  assert.equal(new Set(pocket).size, 1);
});

test("a crowded pocket gets closer than the plain halving would", () => {
  const lean = 2000 / PEEK_ZOOM_FACTOR;
  const range = peekRangeM(2000, POCKET);
  assert.ok(range < lean, `expected closer than ${lean}m, got ${range}m`);
  assert.ok(range >= PEEK_MIN_HEIGHT_M);
});

test("the tighter of two neighbourhoods is always the closer look", () => {
  const tight = peekRangeM(4000, [120, 160, 210]);
  const loose = peekRangeM(4000, [600, 700, 900]);
  assert.ok(tight < loose, `${tight}m should be closer than ${loose}m`);
});

test("a pocket in a sprawling day is dived into rather than held back", () => {
  // The case the old 8x cap decided, and got wrong: 52m apart, on a day framed at 12km.
  const range = peekRangeM(12_000, [52, 3400, 8000], (-70 * Math.PI) / 180);
  assert.equal(range, ringRangeM([52]));
  assert.ok(range < 400, `expected the innermost ring, got ${range}m`);
});

test("range rises monotonically with the neighbourhood it is framing", () => {
  const ranges = [100, 200, 400, 800, 1600, 3200].map((d) => peekRangeM(40_000, [d, d, d]));
  for (let i = 1; i < ranges.length; i++) {
    assert.ok(ranges[i] >= ranges[i - 1], `range fell from ${ranges[i - 1]}m to ${ranges[i]}m`);
  }
});

test("a close pair in an otherwise spread day is treated as the pocket it is", () => {
  // Nishiki Market and the sushi counter 76m away, on a day whose other stops are kilometres off.
  const range = peekRangeM(5800, [76, 1400, 2100, 2600], (-70 * Math.PI) / 180);
  assert.equal(range, ringRangeM([76]));
});

test("the plain lean keeps the flight time it always had", () => {
  assert.equal(peekFlightSeconds(4000, 2000), 0.8);
  assert.equal(peekFlightSeconds(4000, 4000), 0.8);
});

test("a deeper dive is given longer to travel, and the same time coming back", () => {
  const deep = peekFlightSeconds(12_000, 300);
  assert.ok(deep > 1.2 && deep <= 1.8, `expected a longer flight, got ${deep}s`);
  assert.equal(peekFlightSeconds(300, 12_000), deep);
});

test("flight time is capped however deep the dive", () => {
  assert.equal(peekFlightSeconds(2_000_000, 250), 1.8);
});

test("never closer than the building mesh allows", () => {
  // A camera looking almost straight down is the one case where the innermost ring is what
  // constrains rather than the clearance; below that the clearance takes over.
  const steep = peekRangeM(1000, [50], (-85 * Math.PI) / 180);
  assert.equal(steep, ringRangeM([50]));
  assert.ok(steep >= PEEK_MIN_HEIGHT_M);
  // 200m of height at -30° is a 400m range, wider than the ring wanted.
  assert.equal(Math.round(peekRangeM(1000, [50], (-30 * Math.PI) / 180)), 400);
});

test("a shallow camera angle is held further out, to clear the building mesh", () => {
  // Same crowded pocket, same camera distance; only the angle it is being looked at from differs.
  // 400m of range is 346m of height at -60° and 137m at -20°, and a tower is taller than that.
  const steep = peekRangeM(2000, [90, 120, 400], (-60 * Math.PI) / 180);
  const shallow = peekRangeM(2000, [90, 120, 400], (-20 * Math.PI) / 180);
  assert.equal(steep, ringRangeM([90]));
  assert.ok(shallow > steep * 1.5, `expected a shallow peek to stay back, got ${shallow}m`);
});

test("a camera looking level is not asked for a kilometres-wide range", () => {
  // sin(pitch) -> 0 would divide the height floor by nothing; the guard caps what it can demand.
  assert.ok(peekRangeM(2000, [90, 120], 0) <= 1000);
});

test("never flies backwards from a camera already on top of the stop", () => {
  // The clearance floor is close to this camera's whole distance, and pulling *out* is not a peek.
  assert.ok(peekRangeM(300, CITY_DAY) <= 300);
  assert.ok(peekRangeM(120, CITY_DAY) <= 120);
});

test("a day with no other stops falls back to the plain halving", () => {
  assert.equal(peekRangeM(6000, []), 3000);
});

// --- centreHeightOffsetPx: the lift that puts a stop's floating card on centre ------------------

const VIEW = 900;

/** The module's own Mercator scale, recomputed here so the lift assertions check an independently
 *  derived number rather than echoing the implementation back at itself. */
function metresPerPixelAt(zoom, lat) {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

test("looking straight down needs no lift — a column projects to a point", () => {
  assert.equal(centreHeightOffsetPx(150, 16, 19, 0), undefined);
});

test("nothing floating means nothing to offset", () => {
  assert.equal(centreHeightOffsetPx(0, 16, 19, 60), undefined);
  assert.equal(centreHeightOffsetPx(-10, 16, 19, 60), undefined);
});

test("the offset is positive-y, which pushes the ground point *down* the screen", () => {
  const o = centreHeightOffsetPx(150, 16, 19, 60);
  assert.ok(Array.isArray(o), "expected a [x, y] pair");
  assert.equal(o[0], 0, "no horizontal component — the card floats straight up");
  assert.ok(o[1] > 0, "a card above the ground must pull the ground point below centre");
});

test("more pitch leans the column further across the screen", () => {
  const shallow = centreHeightOffsetPx(150, 16, 19, 20)[1];
  const steep = centreHeightOffsetPx(150, 16, 19, 70)[1];
  assert.ok(steep > shallow, `expected ${steep} > ${shallow}`);
});

test("the offset scales with the height it is compensating for", () => {
  const one = centreHeightOffsetPx(150, 16, 19, 60)[1];
  const two = centreHeightOffsetPx(300, 16, 19, 60)[1];
  assert.ok(Math.abs(two - one * 2) < 1e-6, "doubling the anchor should double the lift");
});

test("zooming in spends more pixels per metre, so the same card lifts further", () => {
  const far = centreHeightOffsetPx(150, 13, 19, 60)[1];
  const near = centreHeightOffsetPx(150, 16, 19, 60)[1];
  assert.ok(near > far, `expected ${near} > ${far}`);
});

test("a tall anchor at a steep pitch is lifted in full, not clamped to the viewport", () => {
  // The regression this replaces a clamp with. 150m at z20 and 85° projects to far more than a
  // third of a viewport, and truncating it there stranded the card near the top of the screen
  // while leaving the stop at the bottom — the exact framing the clamp was added to avoid. Cesium
  // aims at the real 3D point and has no equivalent limit; this is the same aim on a flat map.
  const [, offset] = centreHeightOffsetPx(150, 20, 19, 85);
  const columnPx = (150 * Math.sin((85 * Math.PI) / 180)) / metresPerPixelAt(20, 19);
  assert.ok(offset > VIEW / 3, `expected the full lift, not a clamp: ${offset}`);
  assert.ok(Math.abs(offset - columnPx) < 1e-6, `expected ${columnPx}, got ${offset}`);
});

test("sub-pixel lifts are dropped rather than passed on as noise", () => {
  // Whole-world zoom: 150m is a rounding error on screen.
  assert.equal(centreHeightOffsetPx(150, 3, 19, 60), undefined);
});
