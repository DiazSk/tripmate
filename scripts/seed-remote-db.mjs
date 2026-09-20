/**
 * Copy this machine's trips into a hosted (Turso) database.
 *
 * **Why this is not `sqlite3 .dump | turso db shell`.** sqlite3 3.49+ emits `unistr('…
…')`
 * for any text needing escapes — 8 of them in this repo's own data, all markdown in
 * `trip_artifacts` and `llm_sessions` — and libSQL has no `unistr` function, so the import dies
 * with `no such function: unistr`. Rows are copied through bound parameters here, so no value is
 * ever serialised into SQL text and there is nothing to escape.
 *
 * Schema comes from `db.ts` itself rather than from the source database: importing it runs the
 * same `CREATE TABLE IF NOT EXISTS` block, the indexes and the `addColumnIfMissing()` guards the
 * app relies on, against whatever `TURSO_DATABASE_URL` points at. So the target is exactly the
 * shape the app expects, not a snapshot of one machine's drift.
 *
 * Deliberately **not** copied: `fetch_cache`, `map_geometry` (regenerable — they refill on first
 * use, and Turso's free tier meters writes), `llm_traces`, `llm_runs`, `generations`,
 * `bench_results`, `bench_fixtures` (dev-only observability; leaving them behind also starts the
 * deploy's spend cap at $0 instead of inheriting local dev spend).
 *
 *   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… node --import ./scripts/ts-resolve.mjs \
 *     scripts/seed-remote-db.mjs [sourceDbPath]
 */
import path from "path";
import Database from "libsql";

const TABLES = [
  "trips",
  "traveler_profile",
  "trip_chat_turns",
  "trip_stories",
  "trip_artifacts",
  "llm_sessions",
];

const target = process.env.TURSO_DATABASE_URL?.trim();
if (!target) {
  console.error("TURSO_DATABASE_URL is not set — nothing to copy into.");
  process.exit(1);
}

const sourcePath = process.argv[2] ?? path.join(process.cwd(), "tripmate.db");

// Creates the full schema on the target as a side effect of import. Must come before any copy.
// `delete`, not `= undefined` — the latter coerces to the string "undefined" in Node, which would
// read as a real path if db.ts ever consulted DB_PATH ahead of the URL.
delete process.env.DB_PATH;
await import("../src/lib/db.ts");
console.log(`schema ready on ${target.replace(/\/\/.*@/, "//")}`);

const source = new Database(sourcePath, { timeout: 5000 });
const dest = new Database(target, { authToken: process.env.TURSO_AUTH_TOKEN });

let total = 0;
for (const table of TABLES) {
  const rows = source.prepare(`SELECT * FROM ${table}`).all();
  if (rows.length === 0) {
    console.log(`  ${table}: empty, skipped`);
    continue;
  }
  // `_metadata` is libsql's own addition to `.get()`; `.all()` does not add it, but the column
  // list is read off a row so this stays correct if that ever changes.
  const cols = Object.keys(rows[0]).filter((c) => c !== "_metadata");
  const stmt = dest.prepare(
    `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
  );
  for (const row of rows) stmt.run(...cols.map((c) => row[c]));
  console.log(`  ${table}: ${rows.length} rows`);
  total += rows.length;
}
console.log(`copied ${total} rows`);
