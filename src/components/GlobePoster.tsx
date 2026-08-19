"use client";

import Image from "next/image";
import { usePlacePhoto } from "@/lib/usePlacePhoto";

/**
 * The still that stands in for the globe.
 *
 * Every route in this app is composed over a full-bleed backdrop, but almost none of them are
 * *using* the 3D scene: the landing sequence scrolls photo bands over it, `/trips` and
 * `/profile` are opaque panels, and a trip's city overview is a fixed camera pose that renders
 * the same frame forever. Cesium was paying for all of those — a WebGL context, Google's
 * photorealistic tile stream, and a 60fps render loop — to produce, visually, a picture.
 *
 * So this draws the picture, and Cesium is mounted only when the 3D actually moves (see
 * `activateGlobe` in mapCamera). Nothing here animates: it is one gradient or one <img>, which
 * costs the compositor a single layer and the GPU nothing once painted.
 */
export default function GlobePoster({
  place,
  visible,
  onActivate,
}: {
  /** Destination to show a photo of, or null for the plain globe still. */
  place: string | null;
  visible: boolean;
  /** When given, offers the explicit way into 3D. Omitted once the viewer is coming up. */
  onActivate?: () => void;
}) {
  // Same cache key as the itinerary header and the /trips collage, so a trip page that has
  // already resolved its destination photo paints this with no request at all.
  const photo = usePlacePhoto(place ?? "", "full");

  return (
    <div
      // aria-hidden while faded out: it is still in the DOM (so it can fade back in when the
      // viewer goes away) but it is decoration either way, and a screen reader should never
      // meet two backdrops.
      aria-hidden={!visible}
      className="pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {/*
        The globe still, framed to match GlobeBackground's hero pose: at 2,500km the horizon
        sits ~44° below local horizontal and the camera is pitched -45°, which puts the curve
        near the middle of the frame. `top: 46%` is that curve — the circle's own top edge is
        the horizon line, so the two backdrops cut the screen in the same place and swapping
        between them doesn't shift the composition. Sized in vmax so the limb stays flatter
        than the viewport at any aspect ratio rather than reading as a small ball.
      */}
      <div
        className="absolute left-1/2 top-[46%] h-[240vmax] w-[240vmax] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 6%, #35597f 0%, #1d3d5e 12%, #12293f 34%, #0b1a2b 62%, #0a1523 100%)",
          // The atmosphere. A blur on the limb rather than a drawn ring — an actual ring reads
          // as a hard outline at this scale.
          boxShadow: "0 0 160px 24px rgba(96, 156, 214, 0.18)",
        }}
      />
      {/* Deliberately over the limb rather than instead of it: the photo arrives a request
          later than the poster itself, so the globe is what fills the gap, and a destination
          with no Wikipedia image just keeps it. */}
      {photo && (
        <div className="absolute inset-0">
          <Image
            src={photo}
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
            // The same cool, de-vibranced register the photorealistic tileset is pushed into
            // (see the Cesium3DTileStyle MIX in GlobeBackground) — without it the swap from
            // poster to canvas is a visible jump in saturation and exposure.
            style={{ filter: "saturate(0.55) brightness(0.6)" }}
          />
          {/* Glass panels sit on top of this, and a photo is busier than a gradient. The scrim
              is heaviest at the edges where the docked panels and the navbar live. */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(11,15,25,0.25)_0%,rgba(11,15,25,0.62)_100%)]" />
        </div>
      )}
      {onActivate && (
        // Bottom centre, clear of MapControls' bottom-left stack. Without this the only routes
        // into 3D are a stop click and Play tour, which leaves the overview looking like a
        // static page rather than a map you can enter. `globe-poster-activate` puts it under
        // the same `.map-chrome-hidden` opt-out the control stack uses, so it appears only
        // where the globe is a map being read (the result view and `/trip/[id]`) and not over
        // a settings form or a gallery — see globals.css.
        <div className="globe-poster-activate absolute inset-x-0 bottom-10 flex justify-center">
          <button
            type="button"
            onClick={onActivate}
            className="glass-control pointer-events-auto rounded-full px-5 py-2.5 text-sm font-medium text-on-deep transition-transform duration-150 hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none active:scale-[0.98]"
          >
            Explore in 3D
          </button>
        </div>
      )}
    </div>
  );
}
