import path from "node:path";
import type { NextConfig } from "next";

/** Both bundlers minify with SWC, so both need the same substitution — see the shim for why.
 *  Two spellings of one path, and not by accident: Turbopack's `resolveAlias` rejects a Windows
 *  absolute path outright ("windows imports are not implemented yet"), so it takes the relative
 *  specifier; webpack's `resolve.alias` needs an absolute one to be unambiguous. */
const SPZ_SHIM_RELATIVE = "./shims/spz-loader-core.ts";
const SPZ_SHIM_ABSOLUTE = path.resolve(SPZ_SHIM_RELATIVE);

const nextConfig: NextConfig = {
  images: {
    // Lets next/image optimize the real destination photos usePlacePhoto resolves
    // (Memory postcards, the /trips hero collage) instead of shipping them as raw,
    // unoptimized CSS background-images — the exact hosts /api/place-photo already
    // resolves photo URLs from.
    //
    // Both hosts are required, and missing the second one is a *runtime crash*, not a
    // degraded image: an unconfigured host makes next/image throw `Invalid src prop`,
    // which took down the whole of /trip/[id] rather than dropping one photograph.
    // /api/place-photo returns `data.thumbnail.source` verbatim from Wikipedia's REST
    // summary API, and Wikipedia serves thumbnails from `thumb.wikimedia.org` as well as
    // `upload.wikimedia.org` — which host you get is theirs to decide, so allowlisting
    // only the one we happened to see first fails on an arbitrary subset of destinations.
    remotePatterns: [
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "thumb.wikimedia.org" },
    ],
  },

  // Replaces Cesium's Gaussian-splat decoder with a throwing stub. Without this every
  // production build ships a parse-broken Cesium chunk and the globe never boots — invisible
  // in `next dev`, which does not minify. Full reasoning in shims/spz-loader-core.ts.
  turbopack: {
    resolveAlias: { "@spz-loader/core": SPZ_SHIM_RELATIVE },
  },

  // The same alias for `next build --webpack`. Turbopack is the default and the one CI should
  // use; this exists so the escape-hatch build isn't quietly broken in a different way than
  // the one it would be reached to diagnose.
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, "@spz-loader/core": SPZ_SHIM_ABSOLUTE };
    return config;
  },

  async headers() {
    return [
      {
        // The hero's frame sequence — 80 files the landing requests on every visit. Next serves
        // `public/` at `max-age=0` by default, which for this one directory means a reload costs
        // 80 conditional requests before a single frame can be drawn.
        //
        // **`immutable` is only safe because the path carries a content hash.** These URLs look
        // like `/scenes/petra/<hash>/land-001.webp`, where the hash covers the frame window, the
        // count, the tier config and the source archive — see `VERSION` in
        // `scripts/build-frame-sequence.mjs`. An earlier version of this header shipped against
        // unversioned filenames on the reasoning that the build script rewrites the whole
        // directory anyway. That is not what `immutable` means: it tells the browser never to
        // revalidate, so re-cutting the footage left returning visitors serving the previous
        // cut's bytes from an unchanged URL — caught in dev at 74,022 cached bytes against 77,002
        // on disk. Unversioned, the production failure is a visitor seeing a *mixture* of two
        // edits, and only visitors who had been before. **Never point `immutable` at a path whose
        // contents can change.**
        source: "/scenes/petra/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
