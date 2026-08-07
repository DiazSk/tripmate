// Cesium ships its Workers/ThirdParty/Assets/Widgets as static files that
// must be served from a public path. Turbopack (this project's bundler, see
// AGENTS.md) has no webpack-plugin support, so the usual CopyWebpackPlugin
// approach doesn't apply — copy them into public/cesium instead, and point
// window.CESIUM_BASE_URL at "/cesium" at runtime.
import { cp, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const cesiumBuildDir = path.join(root, "..", "node_modules", "cesium", "Build", "Cesium");
const targetDir = path.join(root, "..", "public", "cesium");

const folders = ["Workers", "ThirdParty", "Assets", "Widgets"];

async function main() {
  try {
    await access(cesiumBuildDir);
  } catch {
    console.warn(`[copy-cesium-assets] ${cesiumBuildDir} not found, skipping`);
    return;
  }

  for (const folder of folders) {
    const src = path.join(cesiumBuildDir, folder);
    const dest = path.join(targetDir, folder);
    await cp(src, dest, { recursive: true });
  }

  console.log(`[copy-cesium-assets] copied ${folders.join(", ")} to public/cesium`);
}

main();
