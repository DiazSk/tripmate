// Parses every JS chunk in .next/static/chunks and fails if any of them is not valid JavaScript.
//
//   npm run build && node scripts/verify-build.mjs
//
// This exists because a production bundle can be *syntactically broken* and still build, deploy
// and serve a 200. `next build` reported success while shipping a 4.7MB Cesium chunk that no
// browser could parse — the app rendered its glass panels and its text, and simply had no globe.
// Nothing in `npm run dev` (which does not minify), `tsc`, `eslint` or `node --test` can see it.
//
// Parsing is not execution, so this cannot catch a runtime failure. It catches exactly one thing:
// a chunk the browser will refuse to run. That was worth a script.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const dir = path.resolve(".next/static/chunks");
let files;
try {
  files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".js"));
} catch {
  console.error(`No build found at ${dir} — run \`npm run build\` first.`);
  process.exit(2);
}
if (files.length === 0) {
  console.error(`No JS chunks in ${dir} — did the build finish?`);
  process.exit(2);
}

const broken = [];
for (const f of files) {
  const abs = path.join(dir, f);
  const src = readFileSync(abs, "utf8");
  try {
    new vm.Script(src, { filename: abs });
  } catch (e) {
    broken.push({ f, kb: Math.round(src.length / 1024), msg: e.message });
  }
}

if (broken.length === 0) {
  console.log(`verify-build: ${files.length} chunks, all parse cleanly.`);
  process.exit(0);
}

console.error(`verify-build: ${broken.length} of ${files.length} chunks FAIL to parse.\n`);
for (const b of broken) console.error(`  ${b.f}  (${b.kb} KB)\n    ${b.msg}`);
console.error(
  "\nA chunk that does not parse is dead in every browser. If this is the spz-loader octal-escape\n" +
    "issue again, see shims/spz-loader-core.ts."
);
process.exit(1);
