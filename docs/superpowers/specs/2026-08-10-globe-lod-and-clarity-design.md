# Globe LOD and clarity — why Mumbai looked worse than Frankfurt

## The report

Flying to Römerberg Square in Frankfurt renders crisp, clearly separated buildings. Flying to
the Gateway of India in Mumbai renders flat rooftops with smeared edges and no building
silhouettes. The suspicion was camera angle.

## Diagnosis

It is not the angle. Measured at an **identical camera pose** — 900 m altitude, −35° pitch,
coordinates verified on the camera after `setView` — with only `maximumScreenSpaceError`
varying:

| | Frankfurt (50.1106, 8.6820) | Mumbai (18.9220, 72.8347) |
|---|---|---|
| **SSE 16** (Cesium default, what shipped) | 8.03 m · 165,656 tris · 99 tiles | **16.05 m · 21,242 tris · 110 tiles** |
| **SSE 8** | 4.01 m · 632,508 tris · 460 tiles | **8.03 m · 105,069 tris · 526 tiles** |

Two things follow.

**Mumbai's tile tree was not exhausted.** At SSE 16 it stopped at 16 m geometry; asking for
SSE 8 reached 8 m and 5× the triangles. The deeper tiles existed the whole time and we were
not requesting them.

**One fixed error threshold lands at different real-world detail per region.** Google's tile
tree is structured differently in Mumbai than in Frankfurt, so SSE 16 resolves to 8 m in one
city and 16 m — one full LOD level shallower — in the other. Frankfurt was flattering the
setting; Mumbai exposed it. Mumbai at SSE 8 reaches *exactly* Frankfurt's shipped quality
(8.03 m).

A supporting tell: at SSE 16 Mumbai pulled **more** texture than Frankfurt (661 MB vs 610 MB)
with **8× fewer triangles**. High-resolution photography painted onto near-flat geometry is
precisely the "awkward structure" being reported.

### Measurement caveat

An earlier probe returned nonsense (2,054 m minimum geometric error at 900 m altitude). Cause:
`GlobeBackground`'s auto-rotate listener runs on `postRender` at ~160 fps and was rotating the
camera away from the probe's `setView` for the whole settle window. Every figure above was taken
with `viewer.stopAutoRotate()` called first. Any future camera-dependent measurement in this app
must do the same.

`dynamicScreenSpaceError` was changed *together* with SSE and its contribution was not isolated.
It scales allowed error by distance from the camera, so it cannot affect the nearest tile — the
foreground improvement (16.05 → 8.03 m) is attributable to SSE alone. It is tied to the altitude
tier below on mechanism reasoning, not measurement.

## Design

### 1. Altitude-tiered LOD

A single controller in `GlobeBackground.tsx`, installed next to the tileset. Camera height
selects a tier; values are assigned only when the tier *changes*, so the per-frame cost is one
float read and two comparisons.

| Camera height | `maximumScreenSpaceError` | `dynamicScreenSpaceError` | View |
|---|---|---|---|
| < 2 km | **8** | off | Place detail (~344 m) — the only view where buildings are read |
| 2–50 km | 12 | on | Destination overview (~10.6 km), wide day routes |
| ≥ 50 km | 16 | on | Hero globe (2,500 km) — nothing resolvable |

Tier boundaries are derived from the app's actual camera targets: `flyToPlace` uses a 600 m
`HeadingPitchRange` range at −35°, landing ≈344 m above the target; `flyToDestination` uses
15,000 m at −45°, ≈10.6 km; `HERO_VIEW` is a true 2,500 km altitude.

The idle globe and hero cost exactly what they cost today. Detail is bought only where it is
legible.

### 2. Tint

`colorBlendAmount` drops from **0.2 to 0.1**, hue unchanged (`color('#9BA6B4')`).

`MIX` toward a mid grey pulls highlights down and shadows up simultaneously — it crushes
contrast, not just saturation. Frankfurt's imagery is high-contrast enough to absorb that;
Mumbai's is hazy and low-contrast to begin with, so the same blend reads as mud. Halving the
amount keeps the cool Apple-Maps register DESIGN.md asks for while returning the contrast that
separates one structure from the next.

The tint stays on the tileset rather than becoming a CSS canvas filter: a canvas filter would
also desaturate the route overlay, and pure blue cannot survive a round trip through one
(`#0A84FF` returns as `rgb(36,135,234)`).

### 3. Render resolution

`useBrowserRecommendedResolution` goes to **false**, with `resolutionScale` capped at 2×:

```js
viewer.useBrowserRecommendedResolution = false;
viewer.resolutionScale = Math.min(devicePixelRatio, 2) / devicePixelRatio;
```

When `useBrowserRecommendedResolution` is true Cesium renders at CSS pixels and ignores device
pixel ratio, so on any scaled display the canvas is upscaled and soft — building edges lose
definition regardless of how good the mesh is. Rendering at native density fixes that. The 2×
cap exists because fill cost grows with the square of the ratio and a 3× phone would otherwise
render 9× the pixels for detail no one can resolve. At `devicePixelRatio: 1` this is a no-op.

## Verification

Screenshots are unavailable this session (the Browser pane does not composite), so acceptance
is measured, not judged:

1. **Primary target** — Mumbai at place-view altitude reaches ≤ 8 m minimum geometric error,
   with triangle count within 2× of Frankfurt's at the same pose.
2. **Tier correctness** — SSE reads 16 at hero altitude, 12 at destination altitude, 8 at place
   altitude, and changes as the camera crosses each boundary.
3. **Cost** — frame time and texture payload recorded at the close tier, so the price of the
   detail is known rather than assumed.
4. **No regression** — auto-rotate still resumes via `resetToHome`, the route overlay keeps its
   colour, `tsc` / `eslint` / `next build` clean.

Every camera measurement calls `viewer.stopAutoRotate()` first.

Final visual acceptance belongs to the user — one screenshot from a real display closes it.

## Risks

- **Memory.** 633k triangles and >610 MB of texture at SSE 8 in Frankfurt. `cacheBytes` is
  1.5 GB with 1 GB overflow. Bounding the tight tier to below 2 km is what keeps this contained.
- **Bandwidth.** 5× geometry on the place view. Acceptable because that view is entered
  deliberately, one place at a time, and never during the idle spin.
- **Resolution × LOD compound.** Native-density rendering raises the pixel count *and* SSE 8
  raises the triangle count in the same view. If frame time at the close tier proves bad, the
  resolution cap is the cheaper knob to back off first — it is one number and costs no detail.

## Results (measured after implementation)

At the real place-view altitude (344 m, −35°), both settled, `stopAutoRotate()` first:

| | Mumbai before | Mumbai after | Frankfurt after |
|---|---|---|---|
| Min geometric error | 16.05 m | **2.01 m** | **2.01 m** |
| Triangles | 21,242 | 101,066 | 1,049,384 |
| Tiles selected | 110 | 510 | 551 |
| Frame rate | — | 57 fps | 52 fps |
| Render scale | 1.0× | 1.5× (native) | 1.5× (native) |

**Primary target met and exceeded.** Mumbai reaches 2.01 m against a ≤ 8 m target, and lands on
exactly the same minimum geometric error as Frankfurt. The LOD-selection gap is fully closed.

**One acceptance criterion was wrong.** "Triangle count within 2× of Frankfurt's" is not met and
never will be — the gap is 10×. But both cities now select tiles of *identical declared error* in
comparable numbers (510 vs 551), which means the difference is mesh density inside Google's tiles,
not anything a setting controls. Minimum geometric error is the correct measure of what we can
influence; triangle count conflates that with source data richness. Recorded rather than quietly
dropped.

**SSE 4 tested and rejected.** At the close tier, dropping to SSE 4 in Mumbai left minimum
geometric error unchanged at 2.01 m — that is Google's tree floor — while selecting 1,662 tiles
instead of 510, pulling 1,119 MB of texture instead of 253 MB, and falling to 21 fps from 57.
2.7× the frame time for zero additional detail where the user is looking. SSE 8 is the floor
worth paying for.

`devicePixelRatio` on the verification display was 1.5, so the resolution change is a genuine
1.5× increase in rendered pixels, not the no-op it would be at 1.0.

## Out of scope

- `dynamicScreenSpaceError`'s isolated contribution (see caveat above).
- Regional coverage genuinely absent from Google's dataset. Where no deeper tile exists, no
  setting invents one; this design only stops us from leaving existing detail unrequested.
