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
| `small.svg` | Small cut for 16–48px (favicon, `favicon.ico`): thick strokes, no glass, no latitudes. |
| `mono.svg` | Alpha-only glyph for Android themed (monochrome) icons. |
| `lockup.svg` / `.png` | Mark plus `TRIPMATE` in Switzer 600, 7 units tracking. For splash art, App Store, print. |
| `glow.svg` | Warm glow behind the launch overlay. |

## Rules

- **No text in the app icon.** The name appears only in the lockup.
- Clear space: half the lens diameter on every side. Minimum sizes: full icon 29px, `small.svg` 16px.
- Colours are fixed: ground `#121110`, ivory `#f7f5f2`, jade `#28b981`, dawn `#ff9254`. The jade
  dot is the only jade in the mark; do not recolour it or use it for anything decorative beside it.
- Don't put the full-colour mark on a light ground; use `mono.svg` in `#121110`.
- The glass, glow and blur in the masters are SVG filters. Rasters are rendered from them; edit the
  SVG and re-render, never retouch a PNG.

Rasters are committed next to where they are consumed (`../images/`, `../expo.icon/Assets/`,
`public/icons/`, `src/app/`). `src/components/LogoMark.tsx` is a separate hand-kept glyph of the
same design; update it with the masters.

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
