import { drawableStops, regionForStops, altitudeForRegion } from './mapRegion';

const KYOTO = { lat: 34.9671, lng: 135.7727 };

test('an empty day frames nothing rather than somewhere arbitrary', () => {
  expect(regionForStops([])).toBeNull();
});

// Without the floor a single stop has a span of zero and iOS frames a rooftop.
test('one stop still gets a neighbourhood, not a roof', () => {
  const region = regionForStops([KYOTO])!;
  expect(region.latitude).toBeCloseTo(KYOTO.lat, 6);
  expect(region.latitudeDelta).toBeCloseTo(400 / 111320, 6);
  // Kyoto is at 35°N, where a degree of longitude is ~0.82 of a degree of latitude, so the same
  // 400m must span proportionally more of one.
  expect(region.longitudeDelta).toBeGreaterThan(region.latitudeDelta);
});

test('two stops ten metres apart are still framed at the floor', () => {
  const region = regionForStops([KYOTO, { lat: KYOTO.lat + 0.00009, lng: KYOTO.lng }])!;
  expect(region.latitudeDelta).toBeCloseTo(400 / 111320, 6);
});

test('a wide day is framed by its own span, padded', () => {
  const region = regionForStops([KYOTO, { lat: KYOTO.lat + 0.5, lng: KYOTO.lng + 0.5 }])!;
  expect(region.latitude).toBeCloseTo(KYOTO.lat + 0.25, 6);
  expect(region.latitudeDelta).toBeCloseTo(0.5 * 1.35, 6);
});

// The failure this prevents: (0,0) is finite and passes every type check, and one of them
// stretches the box across a hemisphere and draws the real day as a single pixel.
test('a null-island stop does not widen the box', () => {
  const region = regionForStops([KYOTO, { lat: 0, lng: 0 }])!;
  expect(region.latitude).toBeCloseTo(KYOTO.lat, 6);
  expect(region.latitudeDelta).toBeLessThan(0.01);
});

test('a day of only unplaceable stops frames nothing', () => {
  expect(regionForStops([{ lat: 0, lng: 0 }, { lat: NaN, lng: 1 }])).toBeNull();
});

// Filtering renumbers unless the original index rides along, and then a marker tap emphasises
// the wrong row with nothing to show for it.
test('dropping an unplaceable stop keeps the others on their own ordinals', () => {
  const drawn = drawableStops([KYOTO, { lat: 0, lng: 0 }, { lat: 35, lng: 135 }]);
  expect(drawn.map((entry) => entry.index)).toEqual([0, 2]);
});

describe('altitudeForRegion', () => {
  it('rises with the span it has to show', () => {
    const near = altitudeForRegion({ latitude: 0, longitude: 0, latitudeDelta: 0.004, longitudeDelta: 0.004 });
    const far = altitudeForRegion({ latitude: 0, longitude: 0, latitudeDelta: 0.04, longitudeDelta: 0.04 });
    expect(far).toBeCloseTo(near * 10, 0);
  });

  it('puts a minimum-span day at street altitude rather than in orbit', () => {
    // The 400m floor `MIN_SPAN_M` enforces. A camera that answered tens of kilometres here would
    // make the 3D button read as a zoom-out button, which is the defect this exists to fix.
    const alt = altitudeForRegion({ latitude: 38.71, longitude: -9.13, latitudeDelta: 400 / 111_320, longitudeDelta: 400 / 111_320 });
    expect(alt).toBeGreaterThan(300);
    expect(alt).toBeLessThan(1200);
  });
});
