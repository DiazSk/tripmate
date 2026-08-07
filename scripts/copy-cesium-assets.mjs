import { cpSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "node_modules/cesium/Build/Cesium");
const dest = path.join(root, "public/cesium");

if (!existsSync(src)) {
  console.error("cesium package not found; run npm install first");
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const dir of ["Assets", "ThirdParty", "Widgets", "Workers"]) {
  cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
}

console.log(`Copied Cesium static assets to ${dest}`);
