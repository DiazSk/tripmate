# The Home tab: the landing, rebuilt rather than mirrored

**Status:** accepted 2026-09-19. Reverses the landing cut in
`2026-09-19-ios-native-design-language-design.md`, and revises P0's three-tab decision.

## Context

The landing was cut twice today and is now reinstated deliberately. The first cut argued a
marketing film serves a visitor at a desk and the App Store listing converts; that reasoning was
sound and has been overruled on the grounds that the landing is the product's most distinctive
visual work. **This is a decision, not a correction** — the cost is real and unchanged at ~4.5
weeks.

What *has* changed is the method. The instruction was to stop mirroring and design page by page,
which is what the design-language spec already concluded: the vocabulary ports, the compositions
get rebuilt. This document is the first page done that way.

**The web landing was measured at 375px in a real browser**, not read from source. Total scroll:
**11,304px**, roughly fourteen viewports.

| Band | Height at 375px | Content |
|---|---|---|
| Hero | 812 sticky inside a ~3,250px track | Petra film, "Somewhere.", entry capsule |
| JOURNEY | 2,387 | 4 items: hairline, jade headline, caps label, 11:12 photo, prose |
| METHOD | 1,048 | 4 steps, `01` in a 34px gutter, hairline each |
| PLANS | 3,475 | 4 cards, 365px photo, FROM $X, Where/When/Length/Party |
| REACH | 540 | heading, prose, stippled world map |
| Footer | 606 | photo strip, wordmark, +Memories, +Profile, taglines |

Every band opens identically: a right-aligned `✳ LABEL` over a bottom hairline, then a Melodrama
heading. **That rhythm is the page's spine and it ports unchanged.**

## Decisions

1. **The landing is a real, always-reachable screen with a working entry capsule** — not a
   first-run that disappears. Closest to the web.
2. **It becomes the first of four tabs: Home · Trips · Map · Profile.** This revises P0, which
   shipped three. The bar was built to take another cell and four is still comfortable at 44pt.
3. **The film plays once on appear and holds its last frame.** Not scroll-scrubbed.
4. **The capsule binds to the same `PlanDraft` the wizard uses.** Two entry points, one model,
   one set of date rules — this is the mitigation for the duplicate-form risk the "working
   capsule" choice accepts.

## The design

Mockup: `docs/superpowers/specs/2026-09-19-ios-landing-mockup.html` — real fonts, real Kiln
tokens, real photography, 393×852. Copy it to `public/` and open it from the dev server to view.

### Hero — 498pt, and the number is derived

`852 − 34` home indicator `− 56` bar `− 14` gap `= 748` usable, minus the capsule's measured 250. Re-derive it rather than copying 498 if any of those four change.

**This was found by building the mockup, not by reasoning.** At the first attempt the hero was
640pt and the capsule's "Plan it" sat *under the tab bar* — the screen's primary action, half
hidden at rest, on first paint. The web has no equivalent constraint because it has no permanent
bottom chrome.

No top navbar; P0 deleted it. "Somewhere." is Melodrama 46/400/−0.018em with the three-layer
text shadow `DESIGN.md:1118` specifies, which is the mechanism contrast maths does not model.

### The capsule — the one light surface

`#f7f5f2` at 0.94, **18px radius, not a full pill** — `DESIGN.md:697` records that a full pill on
a tall stacked box renders as a lozenge, and the phone capsule is always stacked. Three rows
(Where / Arriving / Leaving) on internal hairlines, then the jade action.

Reuses the wizard's own controls where they fit; the date rows open the same graphical picker
`DateField` already uses, and the whole thing writes to `PlanDraft`.

### JOURNEY, METHOD, REACH — port nearly as-is

The band rhythm, the 11:12 photo ratio, the two-column step grid and the stipple map all transfer.
Three deletions, all bucket-B or C:

- **The ImageRow hover tint goes.** It is `faded on hover and never shown on touch at all` — so
  on a phone it already does not exist.
- **The plan markers stay off the REACH map.** Three targets 13px apart fail WCAG 2.2 spacing,
  which is why the web hides them below `lg`; a native rebuild does not make them fit.
- **No `BlurredPhotoLayer`, no scroll-driven `--story` timeline, no `overflow-anchor`.**

### PLANS — the one structural change

The web stacks four cards down 3,475px. Native: **a horizontal snap carousel**, 268pt cards, four
in roughly 500pt. A page dot row and "Swipe for four" label carry the affordance, because a
carousel that does not announce its length reads as one card.

This is the clearest case in the page of a composition that exists because a desktop browser
scrolls vertically and a phone does not have to.

### Footer

Ports directly: photo strip, Melodrama wordmark, `+Memories` and `+Profile` as large links. On
iOS those two become tab switches rather than navigations, so they are the one place the footer
and the tab bar say the same thing — acceptable, since the footer is the end of a long read and
the bar is chrome.

## The film

100 AVIF frames at `public/scenes/petra/0329455b/`. **The `port` tier is 540×960, a 2.17× upscale
on a 3× iPhone** — worse than the 1.88× compound upscale `DESIGN.md:1099` rejects as mush. So
`scripts/build-frame-sequence.mjs` needs an iOS tier; it is already parameterised by `tiers`.

Two findings from `HeroFrames.tsx` that must not be re-derived:

- **`createImageBitmap` for 120 frames of 1152×648 RGBA is 358 MB resident.** Do not.
- **Sample by equal picture change, not even index** — consecutive frame difference swings 14×.

Playing once on appear removes the scroll-range problem entirely and means no pinning, no
`--hero-p`, and no sticky ancestor chain to keep free of `overflow`.

## Cost

~4.5 weeks, unchanged, of which the film is the soft number. The carousel and the dropped hover
work are small savings; the new frame tier is a small addition.

## Verification

- Every band against the web at 375px — **vocabulary matched by measurement** (colour, type,
  material, contrast), composition judged natively. The side-by-side is no longer the acceptance
  test; the design-language spec retired it.
- **The capsule must be fully above the tab bar on first paint** at 852pt, 874pt and 956pt. This
  is the check the mockup already failed once.
- The film on a cold launch over cellular, and on the second visit to Home — it must not replay.
- VoiceOver through one full band: the `✳` mark is decorative and must not be announced.
- Dynamic Type at AX3 through the capsule, where the three labels are 10pt.

## Open, and deliberately not decided here

**Whether Home should be the launch tab on every launch, or only until the first trip exists.**
A returning traveller with six saved trips arguably wants Trips. Deciding that needs someone
using it for a week, which is what the sideload is for.
