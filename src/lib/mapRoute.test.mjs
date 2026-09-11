import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_PALETTES,
  arcLift,
  buildDayClusters,
  dayColorToken,
  dayGlowToken,
  dayPalette,
  emphasisColorFor,
  DAY_LABEL_LIFT_M,
  dayPhase,
  dayVisualState,
  frameRouteBesidePanel,
  lateralPanelBiasM,
  routeViewHeadingDeg,
} from "./mapRoute.ts";


/** A day's worth of stops at the given coordinates. `day` is what the colour ramp and the
 *  cluster labels are keyed on, so it is set explicitly rather than inferred. */
const day = (index, coords) =>
  coords.map(([lat, lng], i) => ({ lat, lng, name: `stop ${i}`, day: index }));

test("day 1 opens the pool on cyber cyan", () => {
  // Anchored rather than merely "some token": day 1 is the palette a one-day trip is drawn in,
  // and the pool's whole premise is that it opens on a hue no satellite imagery contains.
  assert.deepEqual(dayPalette(0), {
    core: "--route-day-1",
    glow: "--route-day-1-glow",
  });
});

test("every day resolves to a core and a glow, and they are never the same token", () => {
  // A palette whose glow equals its core is a halo that reads as a blur rather than as light —
  // the reason the pool holds pairs at all.
  for (const i of [0, 1, 2, 3, 4, 5, 12, 99]) {
    assert.equal(dayColorToken(i), dayPalette(i).core);
    assert.equal(dayGlowToken(i), dayPalette(i).glow);
    assert.notEqual(dayPalette(i).core, dayPalette(i).glow);
  }
});

test("each of the first five days gets a distinct palette", () => {
  const cores = [0, 1, 2, 3, 4].map(dayColorToken);
  assert.equal(new Set(cores).size, DAY_PALETTES.length);
});

test("the pool cycles rather than running off the end", () => {
  // A 30-day trip is expressible; `undefined` reaching Cesium.Color.fromCssColorString throws
  // and would take the whole route with it.
  assert.equal(dayColorToken(DAY_PALETTES.length), dayColorToken(0));
  assert.equal(dayColorToken(DAY_PALETTES.length + 1), dayColorToken(1));
  for (const i of [0, 7, 29, 100]) {
    assert.ok(DAY_PALETTES.some((p) => p.core === dayColorToken(i)));
  }
});

test("consecutive days never share a palette", () => {
  // The one thing the colour has to do, and the reason the mapping is `index % pool.length`
  // rather than a hash of the day: modulo cannot collide on adjacent days, a hash can.
  for (let i = 0; i < 40; i++) {
    assert.notEqual(dayColorToken(i), dayColorToken(i + 1));
    assert.notEqual(dayGlowToken(i), dayGlowToken(i + 1));
  }
});

/** Cesium's Color, near enough for `emphasisColorFor` — it reads red/green/blue only. */
const rgb = (red, green, blue) => ({ red, green, blue });

/** The live accent, jade #28b981 at hue 156.8. The band it owns is 135-180. */
const ACCENT = rgb(0.157, 0.725, 0.506);
const WHITE = rgb(1, 1, 1);

test("no shipped day palette falls inside the accent's hue band", () => {
  // The regression this replaced a narrower test with. Under the previous neon ramp exactly one
  // day (Verdant Drift, 155.4 degrees) collided with the accent and relied on `emphasisColorFor`
  // swapping to white. The re-derived earth-pigment ramp is spaced so that none of the five does:
  // 190.4, 318.9, 22.3, 89.0, 244.4, against a band of 135-180. That is strictly better than a
  // handled collision, and it is the property worth guarding — if a future ramp edit walks a day
  // into the band, the mitigation still fires but it has exactly one fallback colour to spend.
  for (const core of [
    rgb(0.306, 0.549, 0.6),   // --route-day-1 #4e8c99  190.4
    rgb(0.643, 0.431, 0.576), // --route-day-2 #a46e93  318.9
    rgb(0.769, 0.471, 0.294), // --route-day-3 #c4784b   22.3
    rgb(0.494, 0.612, 0.369), // --route-day-4 #7e9c5e   89.0
    rgb(0.482, 0.467, 0.682), // --route-day-5 #7b77ae  244.4
  ]) {
    assert.equal(emphasisColorFor(core, ACCENT, WHITE), ACCENT);
  }
});

test("the guard still fires for a colour inside the band", () => {
  // Kept as a live test even though no shipped palette reaches it: it is the mitigation, and a
  // mitigation nothing exercises is a mitigation nobody notices breaking. A day drawn near the
  // accent's own hue would tint on hover to a colour it is already drawn in, so the feedback would
  // read as nothing happening; white is the fallback and there is only one of it.
  assert.equal(emphasisColorFor(rgb(0.247, 0.639, 0.478), ACCENT, WHITE), WHITE);
});

test("the accent's own hue sits inside the band it owns", () => {
  // ACCENT_HUE_BAND is a .ts literal, so a palette sweep through globals.css cannot move it, and
  // getting it wrong fails silently — hover keeps firing and simply stops being visible. If
  // --accent changes and this fails, move the band.
  assert.equal(emphasisColorFor(ACCENT, ACCENT, WHITE), WHITE);
});

test("a cluster sits at the mean of its day's stops", () => {
  const [cluster] = buildDayClusters([
    day(0, [
      [10, 20],
      [20, 40],
    ]),
  ]);
  assert.equal(cluster.lat, 15);
  assert.equal(cluster.lng, 30);
});

test("the centroid follows the mass, not the bounding box", () => {
  // Four stops in one quarter and one across town: the label belongs with the four. A
  // bounding-box centre would put it at 5, in the gap between them.
  const [cluster] = buildDayClusters([
    day(0, [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 10],
    ]),
  ]);
  assert.equal(cluster.lng, 2);
});

test("a day with no stops produces no cluster, and does not shift the days after it", () => {
  // The bug this guards: using the array position as `day` would relabel and recolour every
  // day after an empty one, so the map and the panel would disagree about which day is which.
  const clusters = buildDayClusters([day(0, [[1, 1]]), [], day(2, [[3, 3]])]);
  assert.equal(clusters.length, 2);
  assert.deepEqual(
    clusters.map((c) => c.day),
    [0, 2]
  );
  assert.equal(clusters[1].label, "Day 3");
  assert.equal(clusters[1].colorToken, dayColorToken(2));
});

test("labels are one-based, matching the panel's day tabs", () => {
  const clusters = buildDayClusters([day(0, [[1, 1]]), day(1, [[2, 2]])]);
  assert.deepEqual(
    clusters.map((c) => c.label),
    ["Day 1", "Day 2"]
  );
});

test("an itinerary with no stops at all yields no clusters", () => {
  assert.deepEqual(buildDayClusters([]), []);
  assert.deepEqual(buildDayClusters([[], []]), []);
});

// --- Framing beside the panel ---------------------------------------------------------------
// 60° horizontal fov, Cesium's default, so the numbers below are the real ones.
const TAN_HALF_FOV = Math.tan(Math.PI / 6);

/** Where a point `biasM` east of the route's centre lands on screen, in pixels from the left.
 *  The aim point always projects to the viewport centre, so the route sits that far west of it.
 *  `tanHalfFov` must match whatever the framing was computed with, or this measures a different
 *  lens than the one under test. */
const routeCentreOnScreen = ({ biasM, rangeM }, viewWidth, tanHalfFov = TAN_HALF_FOV) => {
  const metresPerPx = (2 * rangeM * tanHalfFov) / viewWidth;
  return viewWidth / 2 - biasM / metresPerPx;
};

test("with no panel, the route stays in the middle of the screen", () => {
  const framing = frameRouteBesidePanel(1000, 1440, 1440, TAN_HALF_FOV);
  assert.equal(framing.biasM, 0);
  assert.equal(routeCentreOnScreen(framing, 1440), 720);
});

test("the route lands in the middle of the strip the panel leaves", () => {
  // The whole point of the feature: a 1440px viewport with the panel's left edge at 900 should
  // centre the route at 450, not 720 — otherwise half the day sits under the panel and an equal
  // band of dead space opens on the left.
  const framing = frameRouteBesidePanel(1000, 1440, 900, TAN_HALF_FOV);
  assert.ok(Math.abs(routeCentreOnScreen(framing, 1440) - 450) < 0.001);
});

test("the aim holds for any panel width", () => {
  for (const freeWidth of [1200, 900, 700, 520]) {
    const framing = frameRouteBesidePanel(800, 1440, freeWidth, TAN_HALF_FOV);
    assert.ok(
      Math.abs(routeCentreOnScreen(framing, 1440) - freeWidth / 2) < 0.001,
      `free strip ${freeWidth}`
    );
  }
});

test("a stop flight puts the stop in the middle of the strip the panel leaves", () => {
  // Same rule as the route framing, for a point whose range is already decided — a hover peek or
  // a marker click. Without it the camera aims at 720 on a 1440px window, which is *inside* a
  // panel whose left edge is at 900, so the stop being pointed at lands behind the plan.
  const rangeM = 600;
  for (const freeWidth of [1440, 1200, 900, 700, 520]) {
    const biasM = lateralPanelBiasM(rangeM, 1440, freeWidth, TAN_HALF_FOV);
    const metresPerPx = (2 * rangeM * TAN_HALF_FOV) / 1440;
    const onScreen = 1440 / 2 - biasM / metresPerPx;
    assert.ok(Math.abs(onScreen - freeWidth / 2) < 0.001, `free strip ${freeWidth}`);
  }
});

test("a stop flight is unbiased when nothing covers the map", () => {
  assert.equal(lateralPanelBiasM(600, 1440, 1440, TAN_HALF_FOV), 0);
  // A full-bleed panel is the phone layout: no strip to aim into, so centred is correct.
  assert.equal(lateralPanelBiasM(600, 1440, 1600, TAN_HALF_FOV), 0);
  // Nonsense measurements degrade to centred rather than to NaN metres.
  assert.equal(lateralPanelBiasM(0, 1440, 900, TAN_HALF_FOV), 0);
  assert.equal(lateralPanelBiasM(600, 0, 900, TAN_HALF_FOV), 0);
});

test("the camera pulls back so the route fits the strip rather than the viewport", () => {
  const wide = frameRouteBesidePanel(1000, 1440, 1440, TAN_HALF_FOV);
  const narrow = frameRouteBesidePanel(1000, 1440, 720, TAN_HALF_FOV);
  // Half the width to work with means twice the distance.
  assert.ok(Math.abs(narrow.rangeM / wide.rangeM - 2) < 0.001);
});

test("a sliver of free space does not fling the camera into orbit", () => {
  // A narrow desktop window against the panel's 360px minimum. Without the clamp this divides
  // by the sliver and pulls back far enough to lose the city, which is worse than letting the
  // route run a little under the panel's edge.
  const framing = frameRouteBesidePanel(1000, 1440, 20, TAN_HALF_FOV);
  const unclamped = frameRouteBesidePanel(1000, 1440, 1440, TAN_HALF_FOV);
  assert.ok(framing.rangeM <= unclamped.rangeM * 2.5 + 0.001);
});

test("the range floor still applies to a single stop", () => {
  // A lone stop gives a zero-radius sphere; without the floor the camera drives into the mesh.
  assert.equal(frameRouteBesidePanel(0, 1440, 1440, TAN_HALF_FOV).rangeM, 800);
});

test("a full-bleed panel is treated as no panel", () => {
  // The phone layout. There is no strip to aim at, so centred framing is the correct answer
  // rather than a division by zero.
  assert.equal(frameRouteBesidePanel(1000, 390, 0, TAN_HALF_FOV).biasM, 0);
  assert.equal(frameRouteBesidePanel(1000, 390, 390, TAN_HALF_FOV).biasM, 0);
});

test("a nonsense viewport measurement centres rather than throwing", () => {
  for (const [view, free] of [[0, 0], [-1, 100], [1440, -5], [NaN, 100], [1440, NaN]]) {
    const framing = frameRouteBesidePanel(1000, view, free, TAN_HALF_FOV);
    assert.equal(framing.biasM, 0);
    assert.ok(Number.isFinite(framing.rangeM));
  }
});

test("the shift tracks the lens, and both lenses still centre the route in the strip", () => {
  // The conversion is real geometry, not a tuned constant. A wider lens covers more world per
  // pixel, so clearing the same panel edge takes more metres — and the route lands in the middle
  // of the strip either way, which is the invariant that actually matters.
  const narrowLens = Math.tan(Math.PI / 12);
  const wideLens = Math.tan(Math.PI / 6);
  const narrow = frameRouteBesidePanel(1000, 1440, 900, narrowLens);
  const wide = frameRouteBesidePanel(1000, 1440, 900, wideLens);
  assert.ok(wide.biasM > narrow.biasM);
  assert.ok(Math.abs(routeCentreOnScreen(narrow, 1440, narrowLens) - 450) < 0.001);
  assert.ok(Math.abs(routeCentreOnScreen(wide, 1440, wideLens) - 450) < 0.001);
});

// --- Label placement ---------------------------------------------------------------------
// The badge is anchored ON the day's route — the stop nearest that day's centre — and lifted
// above it by DAY_LABEL_LIFT_M in the marker layer. Height is what separates it from the pins,
// so nothing here moves it sideways. See buildDayClusters for the two sideways placements that
// were tried and read as detached.

/** Is this label exactly on one of the day's stops? */
const onAStop = (c, stops) =>
  stops.some(([lat, lng]) => Math.abs(c.labelLat - lat) < 1e-12 && Math.abs(c.labelLng - lng) < 1e-12);

test("the cluster centre is still the mean of its stops", () => {
  const [c] = buildDayClusters([day(0, [[10, 20], [20, 40]])]);
  assert.equal(c.lat, 15);
  assert.equal(c.lng, 30);
});

test("the radius still reaches the furthest stop, for anything that asks how big a day is", () => {
  const [c] = buildDayClusters([day(0, [[0, 0], [0, 4]])]);
  assert.ok(Math.abs(c.radiusDeg - 2) < 1e-9);
});

test("the label sits on the route, not out beside it", () => {
  const coords = [[0, 0], [0, 0.02], [0, 0.04]];
  const [c] = buildDayClusters([day(0, coords)]);
  assert.ok(onAStop(c, coords), "label is on one of the day's own stops");
});

test("it takes the stop nearest the day's centre", () => {
  // Centre of these is lng 0.05; the middle stop at 0.04 is nearest it.
  const [c] = buildDayClusters([day(0, [[0, 0], [0, 0.04], [0, 0.11]])]);
  assert.ok(Math.abs(c.labelLng - 0.04) < 1e-12, `labelLng ${c.labelLng}`);
});

test("a bent day labels on its route, not in the block it goes around", () => {
  // An L-shaped afternoon: the centroid falls inside the corner, off the line entirely. The
  // reason the anchor is a stop rather than the centre.
  const coords = [[0, 0], [0, 0.04], [0.04, 0.04]];
  const [c] = buildDayClusters([day(0, coords)]);
  assert.ok(onAStop(c, coords));
});

test("a long thin day labels on its line rather than a kilometre off it", () => {
  // The circumradius rule put this day's badge ~0.2 degrees away; it is now on the route.
  const coords = [[0, 0], [0, 0.2], [0, 0.4]];
  const [c] = buildDayClusters([day(0, coords)]);
  assert.ok(onAStop(c, coords));
  assert.ok(Math.hypot(c.labelLat - c.lat, c.labelLng - c.lng) < 1e-9, "and at the centre stop");
});

test("nearest-stop is measured with longitude scaled by cos(lat)", () => {
  // At 60N a degree of longitude is half a degree of latitude on the ground. Centre is
  // (60.02, 0.03). The stop 0.04 east of centre is ~0.02 degrees-equivalent away; the one 0.03
  // north is 0.03. So the eastern stop is nearer on the ground and must win — an unscaled
  // comparison would pick the northern one.
  const coords = [[60, 0], [60.05, 0.03], [60.01, 0.07]];
  const [c] = buildDayClusters([day(0, coords)]);
  assert.ok(Math.abs(c.labelLat - 60.01) < 1e-12 && Math.abs(c.labelLng - 0.07) < 1e-12,
    `picked ${c.labelLat},${c.labelLng}`);
});

test("a day whose stops share one spot labels on that spot", () => {
  const [c] = buildDayClusters([day(0, [[10, 10], [10, 10]])]);
  assert.equal(c.radiusDeg, 0);
  assert.equal(c.labelLat, 10);
  assert.equal(c.labelLng, 10);
});

test("an empty day still contributes no cluster and shifts nothing after it", () => {
  const clusters = buildDayClusters([day(0, [[1, 1]]), [], day(2, [[3, 3]])]);
  assert.deepEqual(clusters.map((c) => c.day), [0, 2]);
  assert.equal(clusters[1].label, "Day 3");
});

test("the lift clears the tallest arc, or the badge sits inside its own line", () => {
  // MAX_ARC_LIFT_M is 180m above stem top; anything less than that leaves the label buried in
  // the arc at an oblique camera angle, which is the whole reason the lift exists.
  assert.ok(DAY_LABEL_LIFT_M > 180);
});

// --- Day visual state -------------------------------------------------------------------------

test("with nothing selected every day is baseline, and hover changes nothing", () => {
  // There is no dimming to lift, so hover has nothing to say.
  assert.equal(dayVisualState(0, null, null), "baseline");
  assert.equal(dayVisualState(3, null, 3), "baseline");
});

test("the selected day is active and the rest dim behind it", () => {
  assert.equal(dayVisualState(1, 1, null), "active");
  assert.equal(dayVisualState(0, 1, null), "dimmed");
});

test("hovering a dimmed day lifts only that day, and never the selection", () => {
  assert.equal(dayVisualState(2, 1, 2), "hover");
  assert.equal(dayVisualState(0, 1, 2), "dimmed");
  // Hovering the selected day cannot demote it.
  assert.equal(dayVisualState(1, 1, 1), "active");
});


test("a walk between two stops on the same block still gets a visible bow", () => {
  // The floor is the whole reason it exists: 30m * 0.3 is 9m, which at any camera height that
  // fits a day is a straight line.
  assert.equal(arcLift(30), 80);
});

test("a cross-city hop peaks at a fraction of the ground it covers", () => {
  // 5km apart is the ordinary case — two neighbourhoods of one city — and this is the number
  // the whole redesign is about: high enough that two hops over the same ground separate.
  assert.equal(arcLift(5000), 1500);
});

test("an intercity leg is capped rather than leaving the atmosphere", () => {
  // 1000km at the raw ratio would be a 300km apex, which no camera framing both ends contains.
  assert.equal(arcLift(1_000_000), 30_000);
});

test("the lift is monotonic in distance across the whole clamped range", () => {
  const distances = [0, 10, 100, 267, 1_000, 5_000, 40_000, 99_999, 1e7];
  const lifts = distances.map(arcLift);
  for (let i = 1; i < lifts.length; i++) {
    assert.ok(lifts[i] >= lifts[i - 1], `${distances[i]}m lifted less than ${distances[i - 1]}m`);
  }
});

test("a NaN distance lifts to the floor rather than poisoning a vertex", () => {
  // A NaN position is the failure mode this guards: Cesium draws nothing and logs nothing.
  assert.equal(arcLift(NaN), 80);
  assert.equal(arcLift(Infinity), 80);
});

test("the model's own time format buckets into the right phase", () => {
  // "9:00 AM" is the shape STOP_SHAPE in itineraryPrompt.ts asks for, so it is the only one
  // that really has to work.
  assert.equal(dayPhase("6:30 AM"), "dawn");
  assert.equal(dayPhase("9:00 AM"), "day");
  assert.equal(dayPhase("4:45 PM"), "day");
  assert.equal(dayPhase("6:00 PM"), "dusk");
  assert.equal(dayPhase("8:30 PM"), "night");
  assert.equal(dayPhase("2:00 AM"), "night");
});

test("each band boundary belongs to the later phase", () => {
  // Pinned because these are the numbers the doc comment quotes, and a stop landing exactly on
  // one is common — the model writes times on the half hour.
  assert.equal(dayPhase("5:29 AM"), "night");
  assert.equal(dayPhase("5:30 AM"), "dawn");
  assert.equal(dayPhase("7:29 AM"), "dawn");
  assert.equal(dayPhase("7:30 AM"), "day");
  assert.equal(dayPhase("4:59 PM"), "day");
  // 5:00 PM sharp is golden hour, not afternoon — a viewpoint stop planned for then wants the
  // warm tint, which is the whole reason the dusk band starts this early.
  assert.equal(dayPhase("5:00 PM"), "dusk");
  assert.equal(dayPhase("7:29 PM"), "dusk");
  assert.equal(dayPhase("7:30 PM"), "night");
});

test("midnight and noon land on opposite sides, which is where a %12 goes wrong", () => {
  assert.equal(dayPhase("12:00 AM"), "night");
  assert.equal(dayPhase("12:00 PM"), "day");
});

test("a bare 24-hour time works too, since a chat edit can produce one", () => {
  assert.equal(dayPhase("19:30"), "night");
  assert.equal(dayPhase("06:15"), "dawn");
  assert.equal(dayPhase("13:00"), "day");
});

test("a missing or unreadable time gets daylight, i.e. no tint at all", () => {
  // Older saved itineraries, and anything the model phrased instead of clocked. Daylight is the
  // no-op: the tiles are daylight photography already.
  assert.equal(dayPhase(undefined), "day");
  assert.equal(dayPhase(""), "day");
  assert.equal(dayPhase("late afternoon"), "day");
  assert.equal(dayPhase("25:00"), "day");
  assert.equal(dayPhase("14:99"), "day");
  assert.equal(dayPhase("0:00 PM"), "day");
});

test("the phase reads a time embedded in a longer label", () => {
  // Nothing validates `Stop.time`, and the model has been known to pad it.
  assert.equal(dayPhase("around 7:00 PM"), "dusk");
  assert.equal(dayPhase("8:00 p.m."), "night");
});

/** Stops along a straight line through (lat, lng) at the given bearing, in degrees of latitude.
 *  Longitude is divided by cos(lat) so the line is straight on the *ground*, which is the space
 *  routeViewHeadingDeg works in — building it in raw degrees would tilt the axis it reports. */
const line = (lat, lng, bearingDeg, spanDeg = 0.1, count = 5) => {
  const rad = (bearingDeg * Math.PI) / 180;
  const lonScale = Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: count }, (_, i) => {
    const t = (i / (count - 1) - 0.5) * spanDeg;
    return {
      lat: lat + t * Math.cos(rad),
      lng: lng + (t * Math.sin(rad)) / lonScale,
      name: `stop ${i}`,
      day: 0,
    };
  });
};

test("a north-south corridor is viewed from the side, not down its length", () => {
  // The case the whole function exists for: Mumbai's trip runs almost due north-south, and
  // looking north stacked eight days of arcs into one line.
  assert.equal(Math.round(routeViewHeadingDeg(line(19, 72.85, 0))), 90);
});

test("an east-west route keeps facing north, exactly as it always did", () => {
  // Both perpendicular headings frame it the same; the nearer-north tiebreak spends that on
  // leaving the old behaviour alone.
  assert.equal(Math.round(routeViewHeadingDeg(line(19, 72.85, 90))), 0);
});

test("a diagonal route is viewed across its diagonal", () => {
  // A bounding box would report no axis here at all — its box is square.
  assert.equal(Math.round(routeViewHeadingDeg(line(19, 72.85, 45))), 315);
  assert.equal(Math.round(routeViewHeadingDeg(line(19, 72.85, 135))), 45);
});

test("the heading is perpendicular to the route's own axis at any bearing", () => {
  for (const bearing of [0, 15, 30, 60, 75, 105, 120, 150, 165]) {
    const heading = routeViewHeadingDeg(line(19, 72.85, bearing));
    const off = Math.abs(((heading - bearing) % 180) + 180) % 180;
    assert.ok(
      Math.abs(off - 90) < 0.5,
      `bearing ${bearing} gave heading ${heading}, ${off.toFixed(2)} deg off its axis`
    );
  }
});

test("the chosen heading is always the one nearer north", () => {
  for (const bearing of [0, 20, 45, 70, 110, 135, 160]) {
    const heading = routeViewHeadingDeg(line(19, 72.85, bearing));
    assert.ok(
      Math.min(heading, 360 - heading) <= 90.5,
      `bearing ${bearing} turned the map ${heading} deg from north`
    );
  }
});

test("a round cluster keeps facing north rather than picking an axis out of noise", () => {
  // Otherwise a day-tab click would spin the map to an arbitrary heading, and a different one
  // each time the stops changed slightly.
  const ring = [0, 72, 144, 216, 288].map((deg, i) => ({
    lat: 19 + 0.01 * Math.cos((deg * Math.PI) / 180),
    lng: 72.85 + 0.01 * Math.sin((deg * Math.PI) / 180),
    name: `stop ${i}`,
    day: 0,
  }));
  assert.equal(routeViewHeadingDeg(ring), 0);
});

test("a barely-elongated cluster is still treated as round", () => {
  // 1.1:1 is not a corridor, and turning the map for it would be noise.
  const stops = line(19, 72.85, 0, 0.011).concat(line(19, 72.85, 90, 0.01));
  assert.equal(routeViewHeadingDeg(stops), 0);
});

test("degenerate routes face north instead of throwing or returning NaN", () => {
  assert.equal(routeViewHeadingDeg([]), 0);
  assert.equal(routeViewHeadingDeg(line(19, 72.85, 0, 0.1, 1)), 0);
  // Every stop on one coordinate — normal, not bad data: PREVIEW_TRIP's day 1 puts three at the
  // same hotel.
  const same = [0, 1, 2].map((i) => ({ lat: 19, lng: 72.85, name: `stop ${i}`, day: 0 }));
  assert.equal(routeViewHeadingDeg(same), 0);
});

test("the axis is measured on the ground, not in raw degrees of longitude", () => {
  // A degree of longitude is cos(lat) of a degree of latitude. Without the scaling, this route —
  // which is longer north-south on the ground — would read as east-west at Reykjavik's latitude
  // and the camera would turn the wrong way by 90 degrees.
  const stops = [
    { lat: 64.13, lng: -21.9, name: "a", day: 0 },
    { lat: 64.16, lng: -21.85, name: "b", day: 0 },
    { lat: 64.19, lng: -21.8, name: "c", day: 0 },
  ];
  const heading = routeViewHeadingDeg(stops);
  // 0.06 deg of latitude against 0.1 deg of longitude, which is only 0.0435 deg-equivalent at
  // cos(64.16) — so the ground axis is atan2(0.0435, 0.06) = 35.9 deg from north, and the camera
  // has to sit 90 deg off that. Unscaled it would read atan2(0.1, 0.06) = 59 deg instead and the
  // camera would be aimed 23 deg wrong, which is what this pins.
  const groundAxis = (Math.atan2(0.1 * Math.cos((64.16 * Math.PI) / 180), 0.06) * 180) / Math.PI;
  const offAxis = Math.abs((((heading - groundAxis) % 180) + 180) % 180);
  assert.ok(
    Math.abs(offAxis - 90) < 0.5,
    `heading ${heading.toFixed(1)} is ${offAxis.toFixed(1)} deg off the ground axis ${groundAxis.toFixed(1)}`
  );
  const unscaledAxis = (Math.atan2(0.1, 0.06) * 180) / Math.PI;
  const offUnscaled = Math.abs((((heading - unscaledAxis) % 180) + 180) % 180);
  assert.ok(
    Math.abs(offUnscaled - 90) > 5,
    "heading is perpendicular to the unscaled axis, so the cos(lat) scaling is not being applied"
  );
});
