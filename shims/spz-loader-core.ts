/**
 * Build shim replacing `@spz-loader/core`, aliased in next.config.ts.
 *
 * WHY THIS EXISTS
 *
 * `@spz-loader/core@0.3.1` ships its WASM decoder embedded in the JS bundle as a string of raw
 * bytes. The published source is valid — but SWC's minifier re-encodes that string as a
 * *template literal*, where a NUL byte followed by a digit (`\0` + `1`) is an illegal octal
 * escape. The emitted chunk then fails to parse, and because Cesium's `ResourceCache.js`
 * imports `GltfSpzLoader.js` eagerly, the whole Cesium chunk dies with it.
 *
 * The symptom is brutal and silent: `npm run dev` is fine (no minification), while every
 * production build ships an app with no globe at all — verified broken in Chromium, Firefox
 * and WebKit alike, under both `next build` and `next build --webpack` (both minify with SWC).
 *
 * WHY A STUB IS SAFE HERE
 *
 * `loadSpz` decodes Gaussian splats. It is reached only from `GltfSpzLoader.load()`, and only
 * for a glTF primitive carrying the SPZ extension. TripMate renders Google Photorealistic 3D
 * Tiles, which never produce one — so this code path has never executed in this app.
 *
 * It throws rather than returning null or an empty result: if a splat asset ever does reach
 * Cesium, that is a real feature request, and it should announce itself instead of failing as
 * a blank primitive nobody can trace back to a build shim.
 *
 * REMOVE THIS when spz-loader stops inlining the binary, or when SWC stops emitting octal
 * escapes in template literals. To check: delete the `resolveAlias` entry in next.config.ts,
 * run `npm run build`, then `node scripts/verify-build.mjs`. If it passes, the shim is dead
 * weight — delete it.
 */
export function loadSpz(): never {
  throw new Error(
    "[tripmate] @spz-loader/core is stubbed at build time (see shims/spz-loader-core.ts). " +
      "Gaussian-splat glTF assets are not supported. If you need them, remove the resolveAlias " +
      "in next.config.ts and confirm the production bundle still parses."
  );
}
