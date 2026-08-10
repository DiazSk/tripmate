# Map marker refinement — making the globe readable without the panel

## The report

The itinerary map draws the active day as flat geometry: one cased blue polyline through the
stops, plus an 11px blue `point` entity at each. Nothing on the globe says what any stop *is*.
The names live only in the right-docked itinerary panel, and the two surfaces are strangers —
hovering a panel row does nothing to the map, hovering the map does nothing to the panel, and
`setActivePin` takes only `{ lat, lng }`, so it cannot even tell "hovered" from "selected".

The ask: stops become floating frosted-glass cards on glowing stems, the flat route becomes
raised dashed arcs with a traveling shimmer, and hover/click close the loop in both directions.

## What the request got wrong about this codebase

Four items in the brief do not survive contact with the repo. All four are resolved below rather
than implemented as written.

**`head()` does not exist in the App Router.** `node_modules/next/dist/docs` carries `head.md`
only under `02-pages/`. The App Router equivalent is `generateMetadata`, and metadata exports are
Server-Component-only — while `trip/[id]/page.tsx` is `"use client"`. This needs a file split, not
a function.

**`src/styles.css` does not exist.** Global CSS is `src/app/globals.css`: Tailwind v4, CSS-first,
no config file, tokens declared as `:root` custom properties and re-exported through
`@theme inline`. Adding a second stylesheet would split the token vocabulary in two.

**"A dark cosmic theme" is a reskin, not a refinement.** The theme is already dark and already
documented — "The Lit Cockpit Over a Turning Earth", slate `#0b0f19` canvas, one amber accent.
Adapting costs nothing; reskinning discards `DESIGN.md`'s north star for a synonym.

**Per-day accent colours collide with a documented rule, twice.** `DESIGN.md` states that
map-native colours "must never appear in a panel, chip or button", and conversely that interface
colours must never reach the globe. Separately, `Stop` in `types.ts` has no `day` field and no
accent field — day identity is only the array index in `Itinerary.days[]`.

### How the accent question resolves

Only the active day is drawn, and that is staying. Once one day is on screen, the per-day accent
axis collapses on its own — there is no second day to distinguish from.

So the axis is repurposed rather than invented. Arcs and markers stay Route Blue (`#0A84FF`,
already map-native), and amber (`--accent`) marks **interaction only**: the hovered or selected
marker and its two adjacent arcs. This is a narrow, deliberate amendment to the map-native
palette rule — amber on the globe means *the user is touching this*, never *this is a Tuesday*.
It adds no palette and keeps the One Accent Rule intact.

## The load-bearing invariant: there is no globe to clamp to

`scene.globe.show = false` whenever the Google Photorealistic 3D tileset is active. That single
line invalidates the obvious way to place all of this geometry.

`CLAMP_TO_GROUND` and `HeightReference.TERRAIN` resolve against the hidden globe at height 0, so
anything clamped detaches from everything unclamped. `clampToGround` on a polyline is worse than
it sounds — it is not "drape on the ground", it builds a classification primitive that projects
onto the tile geometry *rooftops included*, so a straight hop across a block climbs every
building in its path. `classificationType` cannot rescue it: `CESIUM_3D_TILE` is that same
behaviour, and `TERRAIN` draws nothing at all because the classification shader reads back the
globe depth texture that `globe.show = false` never wrote.

The existing answer is `sampleRouteAltitude()`: probe the stops **and the midpoints between
them** with `clampToHeightMostDetailed`, then take the **minimum**. Stops sit on buildings — Paris
returned 81–139 m against ~35 m of actual street — while the gaps between venues are usually road
or open space, so the minimum biases toward the ground. Sampling takes ~1.3 s alone and several
seconds when day-tab clicks stack, so the route draws immediately at the *previous* day's
altitude and corrects when the real sample lands, guarded by `routeGenerationRef` so a slow
sample from an older day cannot win.

**Consequence for this work:** stems, glow pools, and 96-point arcs must all participate in that
one correction pass. Anything that misses it detaches visibly at an oblique angle. This is the
single most likely thing to break, which is why the first commit is a behaviour-neutral split
that gives the correction exactly one code path:

```
buildRouteGeometry(viewer, Cesium, stops, altitude) → { entities, reposition(altitude) }
```

`reposition` is called by both the initial draw and the settle. Patching properties rather than
removing and re-adding also avoids a flicker at ~1.3 s.

## Per-frame positioning without React

`scene.postRender` already carries two listeners: the auto-rotate spin in `GlobeBackground` at
~160 fps, and the compass/tilt readout in `MapControls`, which writes `style.transform` and
`input.value` **directly to the DOM** to hold steady-state re-renders at zero. The marker layer
is the third and follows the same discipline — one reusable `Cartesian2` and hoisted scratch
`Cartesian3`s, no allocation in the loop, and only `transform`/`opacity` written (both
composited, so no layout thrash).

It is *not* throttled, unlike `MapControls`. A compass needle can lag 100 ms unnoticed; a marker
that lags its own stem reads as broken.

`SceneTransforms.worldToWindowCoordinates` is the correct transform here — it returns CSS pixel
space. `worldToDrawingBufferCoordinates` would be wrong, and not academically: `GlobeBackground`
sets `useBrowserRecommendedResolution = false` and a custom `resolutionScale`, so the two
coordinate spaces genuinely diverge on this app.

Horizon occlusion is the surface normal at the stop against the vector to the camera:

```ts
const normal = ellipsoid.geodeticSurfaceNormal(anchor, scratchNormal);
const toCamera = Cesium.Cartesian3.subtract(camera.positionWC, anchor, scratchView);
if (Cesium.Cartesian3.dot(normal, toCamera) <= 0) hide(node);   // far side of the globe
```

The card anchors at the **top of the stem**, not at the stop, with `translate(-50%, -100%)`. Card
and stem are then self-consistent by construction, with no coupling between the DOM node and the
entity.

## Declutter is not optional

`PREVIEW_TRIP` day 1 places **three stops at the identical coordinate** `48.8566, 2.3642` — the
hotel transfer, the hotel breakfast, and the Marais shopping. They are all "at the hotel", and an
LLM emitting one coordinate for one place is correct behaviour, not a data bug. Real generations
cluster the same way.

Three cards stacked pixel-for-pixel is an illegible pile, so the marker loop walks stops
nearest-camera-first and hides any card landing within `MIN_MARKER_SEPARATION_PX` of one already
placed. The hovered and active stops are placed first, so the stop the user is pointing at can
never be the one hidden.

```ts
// ponytail: O(n²) separation scan, fine for n ≤ ~15 stops/day.
// Swap for a screen-space grid if a day ever carries dozens.
```

### A ceiling worth naming

HTML overlays have no depth test, so a marker whose stop sits behind a building still draws. This
matches the existing convention rather than breaking it — every current entity already sets
`disableDepthTestDistance: Number.POSITIVE_INFINITY` for exactly this reason, because the
photorealistic tiles otherwise bury pins inside nearby buildings.

## Arcs

One arc per consecutive pair, 96 samples via `EllipsoidGeodesic`, lifted on a sine so the ends
meet the ground flat:

```ts
const lift = Math.min(Math.max(geo.surfaceDistance * 0.18, MIN_ARC_LIFT_M), MAX_ARC_LIFT_M);
// height = altitude + lift * Math.sin(t * Math.PI)
```

Lift scales with segment length so a cross-city hop arcs and a next-door step stays nearly flat,
with a ceiling so a long leg does not leave the frame. Two polylines per arc: a wide
`PolylineGlowMaterialProperty` base and a narrow `PolylineDashMaterialProperty` on top, both
keeping the existing `depthFailMaterial` so segments running behind buildings dim rather than
vanish — the whole reason the route is unclamped in the first place.

The shimmer is a `CallbackProperty` pulsing alpha, matching the pulse idiom already in
`setActivePin`. It is gated on `prefers-reduced-motion`:

```ts
const color = reduceMotion
  ? new Cesium.ConstantProperty(routeBlue.withAlpha(0.7))
  : new Cesium.CallbackProperty(() => /* sine over SHIMMER_PERIOD_MS */, false);
```

That gate matters because `globals.css` kills animation with a blanket `*` rule that reaches
**CSS only**. A WebGL shimmer driven from `performance.now()` would pulse straight through a
reduced-motion preference, unseen by the stylesheet.

## Where things live

`mapCamera.tsx` is 446 lines already carrying the context, the camera flights, the pending-request
replay queues, and the altitude machinery. This change roughly doubles the geometry it owns, so
geometry and overlay move out:

| File | Responsibility |
|---|---|
| `src/lib/mapCamera.tsx` | Context, `flyTo*`, `resetToHome`, pending queues, hover/active state |
| `src/lib/mapRoute.ts` | Cesium geometry: arcs, stems, pools, altitude sampling, `cssColor()` |
| `src/components/StopMarkerLayer.tsx` | HTML overlay, per-frame positioning, hit area |
| `src/lib/useStopTour.ts` | Play tour timer and cancellation |

`StopMarkerLayer` mounts in `AppShell` as a **sibling** of the content overlay, beside `BrandMark`
and `MapControls` — not a child. The content overlay is `overflow-y-auto`, so a marker layer
inside it would scroll away from the globe it is supposed to be pinned to. Per the Pointer-Events
Opt-In Rule the container stays `pointer-events-none` and each card opts back in.

Hover state is plain React state in the provider, not an external store. Hover changes are
user-paced — a few per second — so a context re-render is free. The marker layer reads
`hoveredIndex` in an effect and toggles a `data-hovered` attribute on the one affected node; it
never re-renders per frame. `activeIndex` replaces the coordinate-only `setActivePin`, which
carried no index and so could not distinguish hover from selection.

`RouteStop` widens from `{ lat, lng }` to `{ lat, lng, name }`. Index is the array position — no
new field on `Stop`, no schema change, no API change.

## Tokens

New `:root` properties in `globals.css`, re-exported through `@theme inline`: `--marker-glass`,
`--marker-blur`, `--marker-border`, `--marker-lift`, `--marker-transition`, `--marker-glow`,
`--marker-glow-active`, plus `--route-blue` and `--route-casing` lifted out of the JS constants
they currently live in.

`--marker-glass` derives from `rgb(var(--surface-deep-rgb) / α)` per the One Slate Rule — no new
greys. Cards use a `.glass-marker` utility beside `.glass-itinerary` and `.glass-control`, so
`backdrop-filter` stays in one place and the Never-Prefix Rule holds: a hand-written
`-webkit-backdrop-filter` makes Lightning CSS collapse the pair to the prefixed property alone,
which Chrome 148 dropped, silently killing the blur.

"No hardcoded colours" is satisfied by a cached `cssColor(name)` in `mapRoute.ts` reading
`getComputedStyle(document.documentElement)` — `GlobeBackground` already reads `--canvas` this
way for `scene.backgroundColor`. It must be called lazily inside the client-only build path:
`mapCamera.tsx` is imported during SSR, which is why the existing pin SVG uses
`encodeURIComponent` rather than `btoa`. This also retires the hand-sync comment on
`LABEL_COLOR`/`LABEL_OUTLINE`.

## Play tour

One `setInterval` at 6500 ms, owned by `useStopTour`. Flights are 2.5 s, leaving a 4 s dwell.
Cancels on toggle, day change, unmount, any manual stop click, and `pointerdown` on the Cesium
canvas — grabbing the globe should end the tour. Stops at the last stop rather than looping.

`flyToPlace` already calls `stopAutoRotate()`, which is a **permanent** lock; the tour does not
need to manage the spin itself, and must not try to restore it.

## Verification

At `/trip/preview` — Paris, 3 days, 8/7/8 stops, no LLM round-trip:

1. Cards track their stems under drag and zoom with no lag or drift.
2. Rotating Paris behind the limb makes cards vanish, not smear across the edge.
3. Day 1's three co-located stops resolve to one visible card.
4. Scale holds inside the 0.55–1.0 clamp at hero altitude and at street level.
5. On the altitude settle, arcs, stems, and pools move **together**.
6. Hover works both directions and releases cleanly.
7. Fast day switching leaves no orphaned entities (`viewer.entities.values.length`).
8. The tour cancels on day change, manual click, and canvas drag.
9. Under `prefers-reduced-motion`, marker transitions are off *and* the shimmer holds constant.
10. `resetToHome` wipes markers and resumes the spin; the landing poster shows none.

Then `og:`/`twitter:` tags in the served HTML, `tsc --noEmit`, and lint.

## Risks

- **The correction pass** is the failure mode with teeth. Step 1 exists to reduce it to one path.
- **postRender cost** — three listeners now. Measure before adding a throttle, and call
  `stopAutoRotate()` first: the spin listener once corrupted a tile-detail probe into reporting
  2,054 m of geometric error at 900 m altitude.
- **Marker density** — if a tight day still reads busy after declutter, the fallback is name
  cards for hovered/active/first/last only, dots elsewhere.
- **Amber on the globe** must stay confined to interaction state, or the separation `DESIGN.md`
  draws between map and interface erodes one exception at a time.
