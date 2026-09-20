# The iOS app is not the web app in a phone

**Status:** accepted 2026-09-19. Supersedes Track C's "match every web surface" premise.

## Why this exists

Track C was written as *port the web design faithfully*. Four phases in, that premise produced a
specific, measurable defect: `MapSearchView` was gated on `hasLiveMap`, a condition true only in
the docked ≥600pt layout, so **map search never rendered on an iPhone at all** — the feature most
cited as the reason to build native was unreachable on the device the app is for. That was not a
porting mistake. It was a faithful port of a composition that assumes a wide viewport.

So the question became: how much of `DESIGN.md` is design, and how much is a browser?

## The measurement

`DESIGN.md` is 1,735 lines carrying ~337 substantive decisions. Classified:

| Bucket | Share | What it is |
|---|---|---|
| **A — medium-independent rule** | ~205 decisions, **55%** | Perceptual, typographic, colour-contrast and information-design facts. True on any platform. |
| **B — web composition** | ~57 decisions, **20%** | Layout, navigation and interaction that exist because of a browser, a mouse or a wide viewport. |
| **C — browser workaround** | ~75 decisions, **25%** | Exists purely to fight CSS, Tailwind, the DOM or a WebGL engine. No reason to exist natively. |

**A quarter of the design document is scar tissue.** The Unlayered-Beats-Utility rule, the
Focus-Ring longhands, `pointer-events-none` overlay machinery, `-webkit-backdrop-filter` pairing,
the Named-Timeline rule, `overflow-anchor: none`, the Cesium `CallbackProperty` batching notes.
Porting those would smuggle a browser's constraints into a platform that does not have them.

### The web design records its own phone failures — six times

This is the strongest evidence, and it is the file's own words:

1. **`:558-561`** — below `sm` the docked panel is full-bleed and *"the map controls are hidden
   until the panel collapses into its capsule"*; the tilt slider and 2D/3D toggle stay behind
   `sm:` because *"a 15px rotated thumb is not a touch target."* The phone loses half the map
   controls, and it loses them **because the panel is on top of them**.
2. **`:947-951`** — the landing's four plan markers are `display: none` below `lg`: three targets
   13px apart *"fail WCAG 2.2's target spacing outright."* The phone gets decoration where the
   desktop gets controls.
3. **`:697-699`** — *"a full pill on a tall stacked box renders as a lozenge"*: the system's own
   round-what-you-touch rule breaks at phone width and needs an exemption.
4. **`:1676-1680`** — the hero crop cannot satisfy both orientations. Marked **"Partial, open."**
5. **`:1093-1096`** — a 16:9 frame in a 9:16 viewport keeps 27% of the width, *"which on a phone
   is canyon wall and no Treasury"*, so portrait needs a wholly separate asset tier.
6. **`:546-549`** — `--capsule-h` and the mobile map-control rule that must stack above it are a
   hand-built reimplementation of a sheet the platform already ships.

### Nineteen decisions depend on hover or a pointer

Each is a forced redesign. The worst is `:913-922`: **eighty-seven destination names on the
landing are reachable only by hovering.** The file states *"never ship a control that only appears
on hover"* at `:1626` and then breaks it at `:920` with an explicit justification. That is the one
place in the document where a stated rule and a shipped decision openly disagree — and it is
exactly where touch gets nothing.

## The decision

**Keep the vocabulary. Redesign the compositions. Delete the plumbing.**

This is not new behaviour; it is naming what the last two shipped phases already did. C0 ported
bucket A — tokens, type scale, three faces — and it worked. P0 *replaced* a composition rather
than porting it, and it both worked and fixed the search bug. Two phases, two strategies, and the
seam between them is exactly the A/B line.

### What ports unchanged (bucket A)

- **Colour** — the Kiln palette; one slate at varying alpha as the only surface material; three
  semantic roles (jade acts, gold counts, coral warns); the One Meaning Rule; the Two Foregrounds
  Rule; Darken-Never-Lighten; the Photograph-Is-Not-A-Surface Rule with its measured ratios; the
  Contrast Floor.
- **Type** — three faces and the Three Faces Rule; tracking as `em` tokens; the 58ch measure; the
  single label step; the Figure Rule narrowed to columns.
- **Shape** — the radius ladder; round-what-you-touch, square-what-you-read; hairlines over boxes.
- **Map perception** — the five day-colour pairs at a tight luminance band; casing rather than hue
  for legibility over imagery; rings-are-the-figure; *colour is never the whole message, the label
  says which day in words*; night is deep blue, not grey.
- **Motion** — one curve, four named sizes, reduced-motion gating.

### What is deleted (bucket C)

Recorded once in `ios/DESIGN-iOS.md` under **Deliberately absent**, so nobody re-derives them:
every Tailwind layering rule, every `backdrop-filter` vendor-pairing note, the overlay hit-test
machinery, the scroll-anchor rule, the custom-property-to-dodge-React pattern in all four of its
instances (`--story`, `--hero-p`, `--gen-progress`, `--marker-depth`), and the Cesium-specific
mechanics that die with Cesium rather than with the browser.

### What is redesigned (bucket B)

| Web composition | iOS |
|---|---|
| Fixed top navbar, `h-[var(--nav-h)]` | Bottom tab bar — **shipped, `e52ded8`** |
| Full-screen mobile menu | Gone; the tabs are the menu |
| `DockedPanel`, `fixed` over the map | **Sheet with detents** (see below) |
| `--capsule-h` collapsed capsule | The sheet's small detent |
| Map controls hidden behind the panel | Above the sheet's small detent, at 44pt |
| Hover emphasis on a stop | Tap to emphasise — already done; `hover` and `active` collapse to one state |
| Hover lift on memory cards | Press state only |
| Cursor-driven tilt on tier cards | Deleted (already `(pointer: fine)`-gated on the web) |
| Hover-revealed destination names | N/A — landing is cut |
| Scroll-driven six-beat landing | Cut |
| Generation screen covering the globe | The sheet at its large detent |
| Story mode's capsule hand-off | A detent change |

**One rule replaces all nineteen hover dependencies:** *there is no hover tier. Rest and pressed
are the only two states, and anything that was hover-only is either always visible or tap-revealed.*

## The sheet

The docked panel is the web's central layout idea and the one that fails hardest on a phone.
`AppShell`'s docstring records that it is deliberately **not** a split — it floats *over* the map —
so at phone width it covers the globe completely.

The native idiom for a map with information over it is a sheet with detents, which is what Apple
Maps, Find My and Transit all do. `UISheetPresentationController`, three detents:

- **small** — one line over a live map. P0b ships this showing the trip and the day in focus (the
  content the web's capsule carries); **P7 replaces it with the next stop, its time and its walk.**
  This is the in-trip screen, and it is the thing the web cannot offer at any width on a phone.
- **medium** — the day.
- **large** — the full plan, the generation progress, the wizard.

The Map tab **stays**. It is not made redundant: it owns search, and selecting it is a deliberate
"show me the ground" rather than a drag. But the sheet is what finally puts plan and map on screen
together, which is the composition `DESIGN.md:538-586` wants and cannot have in a browser.

**Built and verified 2026-09-19. The risk flagged here was not the one that bit.**

The native `.sheet` with `.presentationDetents` was tried first and photographed. It *works*:
`.presentationBackgroundInteraction(.enabled(upThrough: .medium))` does keep the map live behind
it, which was the flagged concern. But a sheet presents at **window level and covers the tab
bar** — the spike screenshot shows the map, the sheet, and no navigation at all. Apps shipping
both put the tabs inside the sheet, which is a different design and would undo P0.

So it is hand-rolled (`Shell/PlanSheet.swift`, ~100 lines), for the same second reason the tab bar
is: the map must inset its framing by the sheet's current height, and a system sheet will not tell
you what that is. Here the height is a value the view computes and publishes through
`PanelMetrics.bottomInset`.

**One deviation from this document:** it said not to add a vertical companion to `PanelMetrics`,
on the grounds that the bar's height is a constant. That reasoning holds and now argues the other
way — the *sheet* is 132pt or 46% or nearly the display and moves under a drag, so it is exactly
what a measured environment value is for. `bottomInset` was added; the top inset stays a token.

The hand-rolled sheet also differs from a real one deliberately: **it never covers the tab bar.**
`large` stops short of it, so navigation is reachable at every height.

**This is a frame change, like P0, so it lands before the page that lives in it** — P1 is trip
detail, and trip detail *is* the sheet's content.

## The landing is cut, again

Cut 2026-09-19 on the grounds that a marketing film serves a visitor at a desk; reinstated the
same day under "both — parity plus in-trip." **Parity is no longer the target, so the reason it
came back no longer holds.**

It is also the most purely bucket-B surface in the app: six scroll beats, a 100-frame film driven
by scroll across a 400dvh track with a sticky stage, hover-only names on 87 destinations, and four
markers deleted below `lg`. On iOS the App Store listing, its screenshots and its preview video do
the conversion job before the app is ever installed; nobody who has already downloaded it needs to
be sold. Returns **4.5 weeks**, and `scripts/build-frame-sequence.mjs` needs no iOS tier after all.

## Revised cost

| | Page | Wk | |
|---|---|---|---|
| P0 | The frame — bottom bar | — | **done**, `e52ded8` |
| P6 | Profile | — | **done**, absorbed into P0 |
| **P0b** | **The sheet** | **1** | frame change; blocks P1 |
| P1 | Trip detail, in the sheet | 3 | largest single port |
| P2 | Map, search, control stack | 3 | the native win |
| P3 | Memories wall | 0.5 | mostly done |
| P4 | Plan wizard | 1 | tier cards, POI picker |
| P5 | Generation | 1.5 | replaces B5's placeholder |
| P7 | Today / near me / offline | 3 | the reason this app exists |
| P8 | Story mode | 2.5 | is B7's story half |
| ~~P9~~ | ~~Landing + hero film~~ | — | **cut** |

**~15.5 weeks**, from ~18.5. The landing returns 4.5 and the sheet costs 1.

## Documentation

`DESIGN.md` stays the web's document and remains the source of the shared vocabulary — it is
rewritten from the built web app and that is still what it is for.

A new **`ios/DESIGN-iOS.md`** records only what differs:

1. **Inherited** — a pointer to `DESIGN.md`'s bucket-A sections, by line range, not a copy. A
   second copy of the contrast measurements is a second copy to drift.
2. **Native compositions** — the table above, each entry naming the web decision it replaces and
   the phone failure it fixes.
3. **Deliberately absent** — the bucket-C list, so a future session does not helpfully re-add
   `pointer-events-none`.

The one-way rule: **a value may never be transcribed from `DESIGN.md` prose into Swift.** Four
defects have now come from exactly that — the retired palette, `.kerning(-2.5)`, `.semibold`
Melodrama, and `navHeight = 44` read off the comment above `--nav-h`. Bucket-A values enter the
app through `Token` and `TextStyle` or not at all.

## Verification

Per page, unchanged from the plan, plus two additions this decision forces:

- **The side-by-side against the web at 390pt is retired as the acceptance test.** It was the right
  test for parity and is the wrong one now — a native composition *should* differ. Replaced by: the
  bucket-A vocabulary matches (colour, type, material, contrast), and the composition is judged
  against the iOS HIG and the in-trip case.
- **Any page with an `AsyncImage` gets two screenshots, taken after the image has landed.** A
  photograph sized its own tile and pushed the panel off-screen in `825d008`, and it was reported
  as visually verified because the first screenshot caught the slate placeholder. The same trap
  caught the first screenshot of P0.

Throughout: `swift test` green, `xcodebuild` at zero warnings.

## What this does not change

- **The flat map.** No native iOS map SDK has a custom render layer — not MapKit, and not MapLibre
  Native, whose custom layers went away with its OpenGL renderer. Verified against
  `maplibre/maplibre-native#1609`. The elevated glass ribbons are browser-only however long this
  runs.
- **The API contract.** This is a client-side design decision; Track A is untouched.
- **The Trip Line export** (`DESIGN.md:1418-1519`), which is ~90% bucket A despite being an HTML
  artifact. A native share path reuses that HTML unchanged rather than redesigning it.
