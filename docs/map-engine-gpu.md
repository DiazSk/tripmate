# Two map engines, and what each one costs

TripMate can draw the world behind the itinerary with either **CesiumJS + Google Photorealistic 3D
Tiles** (what it shipped with) or **MapLibre GL JS + OpenFreeMap vector tiles** (added
2026-08-31). They are interchangeable: both implement `MapRenderer` in `src/lib/mapRenderer.ts`,
and everything above that interface — the camera state machine in `mapCamera.tsx`, the marker
layer, the map chrome — is written against it rather than against either engine.

**MapLibre is the default.** Cesium is one flag away and fully wired; nothing about it was
removed.

## Switching

**In the app: the Map / Satellite toggle**, top-left under the wordmark (`MapEngineToggle`). Map is
MapLibre, Satellite is Cesium — the labels name the *view*, not the engine, because that is what the
traveler is choosing.

The switch **keeps the view and the trip**. The outgoing engine's `cameraState()` — the point under
the middle of the screen, the range to it, the heading and the pitch — is captured synchronously on
the click and applied to the incoming engine the moment it registers, and the route geometry,
highways, city outline and search pin are replayed from the provider's own caches. Nothing is
refetched: Overpass answers take seconds and are throttled by IP, so paying for them again would
make the toggle the most expensive control in the app. Measured on a 2-day Lisbon trip: the screen
centre moves **127 m** across the swap (≈22px at that zoom), the heading is preserved exactly
(-16° → 344°), and 360 Cesium entities are drawn without a single new request.

That residual 127 m is the honest cost of the boundary. MapLibre's centre is a point on the terrain;
Cesium's is a pick against the *rendered photogrammetry surface*, which at a 45° pitch over a hill
is not the same point. There is no framing that makes a globe and a mercator map agree exactly.

**Neither map is destroyed on a toggle.** Both stay mounted with their canvases hidden and their
render loops stopped, so the second switch onto an engine is instant and its tile cache is still
warm. That is the same argument `GlobeBackground`'s construction effect makes for never swapping a
viewer — it just applies to swapping *between* two as well. The cost is that after one round trip
you are holding both a Cesium viewer and a MapLibre map; both idle at zero draw calls, so this
shows up as memory rather than as GPU work.

**Without clicking anything**, the engine at load resolves most-specific-first:

1. `?map=cesium` or `?map=maplibre` on any URL. Sticky — it writes to `localStorage`. **Caveat:**
   `/trip/latest` answers with a 307 and the redirect drops the query string, so put the parameter
   on a real trip URL or set the storage key directly.
2. `localStorage.tripmateMapEngine` — which is also what the toggle writes, so a preference carries
   to the next page load.
3. `NEXT_PUBLIC_MAP_ENGINE=cesium` in `.env.local` — the build default.
4. Falls back to `maplibre`.

## The measurement

`node scripts/map-engine-probe.mjs --base http://localhost:3011 --path /trip/latest`

Both engines, same trip (2-day Lisbon), same 1440×900 viewport, same scripted drag across the map,
then nine seconds of stillness. Playwright + Chromium, `--use-angle=default`, real GPU — the probe
prints the unmasked WebGL renderer string precisely so a SwiftShader run can be thrown away.

**GPU work is measured as draw calls**, by wrapping `drawElements`/`drawArrays`/the instanced pair
on both WebGL context prototypes before any app code runs. That is engine-agnostic and, unlike
hooking Cesium's `postRender` or MapLibre's `render` event, needs no `window.__tripmate*` handle —
those are dev-only, so the earlier version of this probe could not measure the build worth
measuring. Draw calls are not milliseconds of GPU time (no page can read that), but a canvas
issuing zero of them is doing no GPU work, and 3× the draw calls for the same frame is 3× the
command stream.

**2026-08-31, Apple M4, `ANGLE Metal Renderer`, `next start` production build:**

| | MapLibre | Cesium | Ratio |
|---|---|---|---|
| **Draw calls/s while idle** | **0** | **0** | — |
| **Draw calls/s during a drag** | **2,539** | **8,706** | **3.4×** |
| Frame time during a drag, median | 8.3 ms | 8.3 ms | 1.0× |
| Frame time during a drag, p95 | 9.8 ms | 25.2 ms | **2.6×** |
| Page rAF rate during a drag | 119.5/s | 91.3/s | 0.8× |
| HTTP requests | 158 | 798 | **5.1×** |
| Bytes transferred | 9.2 MB | 16.9 MB | **1.8×** |
| JS heap after the run | 86 MB | 212 MB | **2.5×** |
| Main-thread task time, cumulative | 1.9 s | 5.8 s | **3.1×** |
| Script time, cumulative | 1.0 s | 4.5 s | **4.5×** |
| Time to a sized canvas | 990 ms | 942 ms | 1.1× |

### Reading it

**Idle is a tie at zero, and idle is what governs this app.** Every map frame forces every
`backdrop-filter` glass panel above the canvas to re-blur, so a canvas that repaints when nothing is
happening is the single most expensive thing on the page. Cesium gets to zero through
`requestRenderMode`; MapLibre gets there through its own repaint-on-change loop. Both hold. Whatever
else the table says, neither engine burns the GPU while a plan is being read — which is most of the
time a trip is on screen.

**Under interaction, Cesium issues 3.4× the draw calls.** That is the GPU answer: same frame, same
viewport, same trip, a command stream three and a half times as long. It comes from the
photogrammetry tile tree — hundreds of resident meshes, each its own draw — against MapLibre's
handful of batched vector layers.

**The cost shows up in the tail, not the median.** Both engines hit the 8.3 ms the display asks for
on a typical frame; an M4 is not troubled by either. Cesium's p95 is 25.2 ms — a dropped frame every
twentieth frame, from decoding and uploading meshes mid-drag — and its 91.3/s page rAF rate is that
same contention from the other side: the main thread was busy enough to delay the *page's* own
animation callbacks. MapLibre's p95 is 9.8 ms, effectively its median. On a weaker GPU the median
would separate too; this machine is the best case for Cesium.

**Cesium's other cost is streaming.** 798 requests against 158, and 16.9 MB against 9.2 MB, for the
same two days in the same city — the tile tree again, and the source of both the 512 MB `cacheBytes`
and the 212 MB JS heap. MapLibre's 9.2 MB is vector tiles plus a terrarium DEM, which decode to far
less resident memory.

**Boot is a wash** (990 ms vs 942 ms), which is worth stating because it is the one place intuition
says Cesium should lose badly. It does not: the tileset streams *after* first paint.

**Caveats.** One machine, one trip, one run per engine. GPU *memory* is not in the table because no
page can read it — bytes transferred and JS heap are the honest proxies, and a real answer needs a
native GPU profiler. Draw calls are a proxy for GPU work, not a measurement of it.

## What MapLibre does not reproduce

Deliberate, and none of it is above the `MapRenderer` boundary:

- **Photorealistic imagery.** The whole point of the exercise. Buildings are OpenMapTiles
  `fill-extrusion` prisms, not photogrammetry.
- **Arched routes.** Cesium lifts each hop onto a raised great circle so two trips over the same
  ground read as separate. MapLibre drapes lines on the terrain. `frameRoute` correspondingly stops
  reserving frame height for arc apexes.
- **The glass-ribbon shader.** `glassRibbon.ts` is a Cesium fabric material with a cylindrical body
  and a specular streak; MapLibre's line shader is not user-extensible. The vector path uses a
  blurred wide line under a solid narrow one, which reads similarly at a fraction of the cost.
- **Route altitude.** Cesium samples the *rendered* tile surface (`clampToHeightMostDetailed`,
  ~1.3 s) so its geometry floats just above the roofs. MapLibre drapes on terrain and reports
  altitude 0, which is the correct answer for it — the marker layer then lifts cards by
  `STEM_HEIGHT_M` alone and still lands on the stem.
- **`centreHeightM`.** MapLibre aims at a ground point; there is no way to ask it to centre
  something 150 m up. A stop flight lands slightly high in frame rather than dead centre.
- **Horizon culling.** A mercator map has no far side, so `project` rejects only what is behind the
  camera.

Everything else is the same feature on both: per-day colour, focus/dim/hover day states, stop
emphasis, stems, ground pools, day badges, highways, the city outline, the search pin, route
framing beside the panel, the hover peek, the zoom/compass/tilt/2D-3D chrome, and click-to-pick in
the split editor.

## One trap worth knowing about

**MapLibre's tile-parsing worker does not survive Turbopack.** It builds the worker from
`new URL("./maplibre-gl-worker.mjs", import.meta.url)`, Turbopack does not serve that path, the
module worker dies on its own import, and **not one tile is ever parsed** — silently. The style
loads, the sprite loads, the raster natural-earth layers load, `map.getStyle()` shows every layer
present, and the canvas stays a flat fill forever. Symptoms while chasing it: zero live workers,
zero `.pbf` requests, and `queryRenderedFeatures()` empty for every layer *including the app's own
GeoJSON ones*.

`scripts/copy-maplibre-assets.mjs` copies the worker (and the shared chunk it imports) into
`public/maplibre/` at postinstall, and `createMapLibreMap` calls `setWorkerUrl` at it. Same shape
as `copy-cesium-assets.mjs`, and for the same underlying reason: no CopyWebpackPlugin under
Turbopack.

Two smaller ones, both documented at their call sites:

- Waiting on `load` or on `isStyleLoaded()` before `addLayer` **deadlocks** when the style carries
  terrain. `style.load` is the event that actually gates adding sources and layers.
- The construction guard has to be the in-flight **promise**, not the finished map. React's
  StrictMode runs the effect twice, construction is async, so a guard on the map is still null the
  second time — which built two maps into one container, with two WebGL contexts and two tile
  streams.
