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
    // unoptimized CSS background-images — the exact host /api/place-photo already
    // resolves photo URLs from.
    remotePatterns: [{ protocol: "https", hostname: "upload.wikimedia.org" }],
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
};

export default nextConfig;
