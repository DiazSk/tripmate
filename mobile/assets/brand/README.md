# TripMate logo — Meridian

A glass globe, a route that lifts off it, and one jade stop. The globe is the live map behind the
product, the arc is its route tubes, the jade dot is "jade acts": the place you are going.

## Files (SVG masters, 256-unit viewBox)

| File | Use |
|---|---|
| `icon.svg` | Full-bleed square app icon (iOS `icon.png`, PWA 192/512, apple-touch). Never pre-round it; the platform masks it. |
| `background.svg` + `mark-ios.svg` | The same icon as two layers, for the iOS 26 Icon Composer bundle (`../expo.icon`). `mark-ios.svg` has no baked shadow. |
| `mark-android.svg` | Foreground scaled into Android's adaptive safe zone (lens is ~60% of the canvas). |
| `icon-maskable.svg` | PWA maskable icon: mark inset to the 80% safe zone. |
| `small.svg` | Small cut for 16–48px (favicon, `favicon.ico`, `src/app/icon.svg`): the same lit glass globe, with one meridian and one latitude instead of five lines, and a bolder route and stop. Not a line drawing: stripped to strokes it read as a different, cheaper logo. |
| `mono.svg` | Alpha-only glyph for Android themed (monochrome) icons. Uses opacity for depth (glass disc, glow, fading latitudes) rather than a flat outline. |
| `lockup.svg` / `.png` | Mark plus `TRIPMATE` in Switzer 600, 7 units tracking. For splash art, App Store, print. |
| `glow.svg` | Warm glow behind the launch overlay. |
| `logo-primary.svg` / `.png` | **Primary logo**: the mark and `TripMate` side by side, for dark grounds (ivory type). Transparent. |
| `logo-primary-onlight.svg` / `.png` | The same lockup with ink type (`#121110`), for light documents and slides. The globe is already dark, so the mark does not change. |
| `logo-mark.svg` / `.png` | **Logo mark**: the glass globe alone, transparent, no baked shadow. For avatars, social, anywhere the name is already nearby. |
| `logo-clearspace.svg` / `.png` | **Clear-space diagram** for the primary logo and the mark, with minimum sizes and misuse. A documentation board, so it uses live text (Switzer); the logo files themselves have none. |

## Rules

- **No text in the app icon.** The name appears only in the lockup.
- Clear space **x = the lens radius** (half the mark's height), free on every side, measured from the
  lens edge, not from the file edge (the files carry 6 units of padding for the rim glow). The same
  x applies to the primary logo and the mark; see `logo-clearspace.svg`.
- Minimum sizes: primary logo 120px wide, mark 24px, app icon 29px. Below those use `small.svg`
  (16px minimum).
- Colours are fixed: ground `#121110`, ivory `#f7f5f2`, jade `#28b981`, dawn `#ff9254`. The jade
  dot is the only jade in the mark; do not recolour it or use it for anything decorative beside it.
- Don't put the full-colour mark on a light ground; use `mono.svg` in `#121110`.
- The glass, glow and blur in the masters are SVG filters. Rasters are rendered from them; edit the
  SVG and re-render, never retouch a PNG.

Rasters are committed next to where they are consumed (`../images/`, `../expo.icon/Assets/`,
`public/icons/`, `src/app/`). `src/components/LogoMark.tsx` is a separate hand-kept glyph of the
same design; update it with the masters.

The wordmark is Switzer 600 outlined to paths, kerned, tracking -8/1000 em. Switzer is distributed
under the Fontshare licence; confirm it covers use in a logo before this goes on anything printed.

**Digital-first.** The full-colour mark uses gradients and blur, so there is no flat one-colour
master yet. Print, embroidery and single-colour stamps need one (`mono.svg` is an alpha glyph for
Android tinting, not a print master).

Not cleared: trademark. Get a professional search before launch.

## iOS appearances (Default / Dark / Clear / Tinted)

`../expo.icon` is two layers, **front-most group first** in `icon.json` (the mark, then the
background). Get the order backwards and the opaque background hides the mark: it still compiles.
iOS derives Dark, Clear and Tinted from those layers, so the mark has to carry its meaning in
luminance alone: the globe lines and the route are ivory, and the jade dot is the only thing that
loses its colour (it goes neutral in Clear and Tinted; the halo ring keeps it readable).

Render every appearance with Apple's own renderer before shipping a change to either layer:

```bash
ictool mobile/assets/expo.icon --export-image --output-file out.png --platform iOS \
  --rendition TintedDark --width 512 --height 512 --scale 1
# renditions: Default Dark ClearLight ClearDark TintedLight TintedDark
# ictool: /Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/
```

The mark layer must be **shadow-free and `"glass": false`** (`mark-ios.svg`, not `mark.svg`). iOS 26
traces a glass edge highlight round every opaque region of a layer: with the baked drop shadow it drew
a stray second ring under the lens rim, and with the glass effect on it cracked the semi-transparent
rim. The shadow stays in `mark.svg` for the flat rasters, where nothing else supplies one.

Per-appearance layer overrides (`image-name-specializations`, `hidden-specializations`) are not
used: `ictool` ignored the first and the second hid the default mark without revealing a
replacement.
