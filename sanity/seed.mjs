// Upsert the seed trips into Sanity by slug, in one transaction.
//
//   node --env-file=.env.local sanity/seed.mjs            # dry run: says what it would do
//   node --env-file=.env.local sanity/seed.mjs --apply    # does it
//
// Needs SANITY_API_DEVELOPER_TOKEN (a token that can write; the app's own SANITY_API_READ_TOKEN is read-only).
// Documents keep the ids Sanity gave them: a seed trip whose slug already exists replaces that
// document under its own id, and a new slug is created with an id Sanity assigns. Nothing is
// deleted, so a trip an editor added in the Studio survives a reseed.
import fs from "node:fs";

const projectId = process.env.SANITY_PROJECT_ID || "zj8wtfx1";
const dataset = process.env.SANITY_DATASET || "production";
const token = process.env.SANITY_API_DEVELOPER_TOKEN;
const apply = process.argv.includes("--apply");
if (!token) throw new Error("Set SANITY_API_DEVELOPER_TOKEN (a token that can write) to seed.");

const api = `https://${projectId}.api.sanity.io/v2025-02-19/data`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const seed = fs
  .readFileSync(new URL("./ready-trips.ndjson", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const query = encodeURIComponent(`*[_type == "readyTrip"]{_id, "slug": slug.current}`);
const res = await fetch(`${api}/query/${dataset}?query=${query}&perspective=published`, { headers });
if (!res.ok) throw new Error(`Reading the catalogue failed: HTTP ${res.status}`);
const idBySlug = new Map((await res.json()).result.map((d) => [d.slug, d._id]));

const mutations = seed.map((doc) => {
  const _id = idBySlug.get(doc.slug.current);
  return _id ? { createOrReplace: { ...doc, _id } } : { create: doc };
});
const replaced = mutations.filter((m) => m.createOrReplace).length;
console.log(`${seed.length} seed trips: ${replaced} replace their document, ${seed.length - replaced} are new.`);
if (!apply) {
  console.log("Dry run. Pass --apply to write.");
  process.exit(0);
}
const write = await fetch(`${api}/mutate/${dataset}`, { method: "POST", headers, body: JSON.stringify({ mutations }) });
if (!write.ok) throw new Error(`Seeding failed: HTTP ${write.status} ${await write.text()}`);
console.log("Seeded.");
