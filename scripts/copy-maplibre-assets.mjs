// MapLibre parses every vector tile in a Web Worker, and it builds that worker from
// `new URL("./maplibre-gl-worker.mjs", import.meta.url)`.
//
// Turbopack (this project's bundler, see AGENTS.md) does not rewrite that URL to something it
// serves, so the module worker's `import` 404s, the worker dies on startup and **not one tile is
// ever parsed**. The failure is silent and deeply misleading: the style loads, the sprite and the
// raster natural-earth layers load, `map.getStyle()` shows every layer present — and the canvas
// stays a flat fill because no vector source ever produces a tile. Measured while chasing it:
// `p.workers().length === 0`, zero `.pbf` requests, `queryRenderedFeatures()` empty for every
// layer including the app's own GeoJSON ones.
//
// So the worker gets copied out to a static path and `maplibregl.setWorkerUrl` points at it — the
// same shape as `copy-cesium-assets.mjs` and for the same reason (no CopyWebpackPlugin under
// Turbopack). `maplibre-gl-shared.mjs` comes along because the worker imports it as a sibling.
import { copyFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, "..", "node_modules", "maplibre-gl", "dist");
const targetDir = path.join(root, "..", "public", "maplibre");

/** The worker and the chunk it imports. Both, or the worker 404s on its own dependency. */
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

async function main() {
  try {
    await access(distDir);
  } catch {
    console.warn(`[copy-maplibre-assets] ${distDir} not found, skipping`);
    return;
  }
  await mkdir(targetDir, { recursive: true });
  for (const file of files) {
    await copyFile(path.join(distDir, file), path.join(targetDir, file));
  }
  console.log(`[copy-maplibre-assets] copied ${files.length} files to public/maplibre`);
}

main().catch((err) => {
  console.error("[copy-maplibre-assets] failed:", err);
  process.exitCode = 1;
});
