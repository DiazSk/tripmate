import path from "node:path";
import type { NextConfig } from "next";

/** Both bundlers minify with SWC, so both need the same substitution — see the shim for why.
 *  Two spellings of one path, and not by accident: Turbopack's `resolveAlias` rejects a Windows
 *  absolute path outright ("windows imports are not implemented yet"), so it takes the relative
 *  specifier; webpack's `resolve.alias` needs an absolute one to be unambiguous. */
const SPZ_SHIM_RELATIVE = "./shims/spz-loader-core.ts";
const SPZ_SHIM_ABSOLUTE = path.resolve(SPZ_SHIM_RELATIVE);

/** The Clerk frontend API origin, as a list so "no Clerk" can be an empty one. A publishable key
 *  is `pk_<env>_` + base64(`<host>$`), so the host is read off it at config time rather than
 *  hard-coded per deploy. No key (Clerk not configured) or a key that does not decode gives no
 *  origin at all; only an undecodable `pk_test_` key falls back to the dev-instance wildcard, so a
 *  production policy never trusts every `*.clerk.accounts.dev`. Never throws: a config that fails
 *  to load takes the whole build down. */
function clerkOrigins(key: string): string[] {
  const host = Buffer.from(key.split("_")[2] ?? "", "base64").toString("utf8").replace(/\$$/, "");
  if (/^[a-z0-9.-]+$/i.test(host)) return [`https://${host}`];
  return key.startsWith("pk_test_") ? ["https://*.clerk.accounts.dev"] : [];
}

/** PostHog's origins, from the public host the client is built with: the API it posts to, and for
 *  PostHog Cloud the sibling `<region>-assets` host that serves the recorder and survey scripts
 *  (script-src) the SDK lazy-loads. Empty without a key, like Clerk's, so an unconfigured build
 *  trusts none of it; a host that does not parse gives none either rather than failing the build. */
function posthogOrigins(key: string, host: string): string[] {
  if (!key) return [];
  try {
    const { origin, hostname } = new URL(host);
    const cloud = hostname.match(/^(\w+)\.i\.posthog\.com$/);
    return cloud ? [origin, `https://${cloud[1]}-assets.i.posthog.com`] : [origin];
  } catch {
    return [];
  }
}

const POSTHOG = posthogOrigins(process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "", process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com");
const CLERK_API = clerkOrigins(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "");
const list = (...o: string[]) => o.join(" ");

/** `'unsafe-eval'` is here for exactly one line: Cesium's bundled Knockout opens with
 *  `this || (0, eval)("this")`, and in a module `this` is undefined, so it reaches `eval`. Enforced
 *  without this, the EvalError aborts the Cesium chunk's init and the satellite globe never draws
 *  while the rest of the page renders normally (measured on a production build). It adds little
 *  beside the `'unsafe-inline'` already on script-src, and every other directive is unaffected.
 *  Only the satellite engine's chunk evaluates it, so drop it if that line is ever shimmed out. */
const EVAL = "'unsafe-eval'";

/** Each list is an audited set of origins, kept beside the feature that needs it.
 *  Added from the browser's own violation reports, one surface at a time. */
const PROTECT = "https://*.client.protect.clerk.com:*"; // Clerk's bot probe: its loader.js, then probes on seven ports
// Every Clerk origin appears together or not at all: with Clerk unconfigured none belongs in the policy.
const CLERK_SCRIPT = CLERK_API.length ? ["https://cdn.protect.clerk.com", PROTECT, ...CLERK_API] : [];
const CLERK_CONNECT = CLERK_API.length ? [PROTECT, ...CLERK_API] : [];
const CLERK_IMG = CLERK_API.length ? ["https://img.clerk.com"] : [];
const OPENFREEMAP = "https://tiles.openfreemap.org"; // MapLibre: style, sprites, glyphs, vector tiles
const TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/"; // MapLibre's terrarium DEM, this bucket only
const COMMONS = "https://commons.wikimedia.org"; // Special:FilePath hero photos, which redirect on to upload.wikimedia.org
const OSM_TILES = "https://tile.openstreetmap.org"; // Cesium's flat imagery when there is no Ion token or no 3D tile arrives
const CESIUM = ["https://api.cesium.com", "https://tile.googleapis.com"]; // Ion token handshake, Google 3D tiles
const KOKORO = [
  "https://esm.sh", // kokoro-js itself, imported inside a Blob worker
  "https://cdn.jsdelivr.net", // onnxruntime-web's WASM runtime, which transformers.js fetches
  "https://huggingface.co", "https://*.hf.co", "https://cdn-lfs.huggingface.co", // the model weights
];

/** Enforced, after a clean report-only run on every surface: `/`, `/trip/[id]` on both map engines
 *  with a story film playing, sign-in, the saved-places import, and a shared trip at `/s/[token]`
 *  (its fonts are inlined as `data:` woff2, hence `font-src data:`). A new origin a feature starts
 *  calling has to be added here or the browser refuses the request. `'unsafe-inline'` stays on
 *  script-src deliberately — App Router emits inline scripts and nonces would force every page
 *  dynamic. */
const CSP = [
  "default-src 'self'",
  `script-src ${list("'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", EVAL, "https://esm.sh", "https://cdn.jsdelivr.net", "https://challenges.cloudflare.com", ...CLERK_SCRIPT, ...POSTHOG)}`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `connect-src ${list("'self'", ...KOKORO, OPENFREEMAP, TERRAIN, ...CESIUM, OSM_TILES, "https://geocoding-api.open-meteo.com", ...CLERK_CONNECT, ...POSTHOG)}`,
  `img-src ${list("'self'", "data:", "blob:", OPENFREEMAP, OSM_TILES, "https://assets.ion.cesium.com", "https://upload.wikimedia.org", "https://thumb.wikimedia.org", COMMONS, ...CLERK_IMG)}`,
  `frame-src ${list("https://challenges.cloudflare.com", ...CLERK_API)}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
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
