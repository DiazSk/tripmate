import Database from "better-sqlite3";
import path from "path";
import { randomUUID } from "crypto";
import { LOCAL_OWNER, parseProfile, type TravelerProfile } from "./travelerProfile";
import { staleDraftCutoff } from "./drafts";
import { LEGACY_OWNER, readableOwners } from "./owner";
import type { TripStatus } from "./types";

const db = new Database(process.env.DB_PATH ?? path.join(process.cwd(), "tripmate.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    destination TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    budget REAL NOT NULL,
    itinerary_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS llm_traces (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    raw_response TEXT,
    model TEXT NOT NULL,
    duration_ms INTEGER,
    status TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL
  )
`);

// One row per persisted API-transport chat/edit session — the LLM_TRANSPORT=api counterpart to
// the CLI's local JSONL session file. `messages` is a JSON array of Anthropic message turns (both
// user and assistant), replayed in full on every resume. See claude.ts's runClaudeViaApi and
// docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md.
db.exec(`
  CREATE TABLE IF NOT EXISTS llm_sessions (
    id TEXT PRIMARY KEY,
    messages TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS destination_context (
    destination TEXT NOT NULL,
    month_bucket TEXT NOT NULL,
    context_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (destination, month_bucket)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS llm_runs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    destination TEXT NOT NULL,
    trip_id TEXT,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS trip_artifacts (
    run_id TEXT PRIMARY KEY,
    trip_context_md TEXT NOT NULL,
    itinerary_md TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// `owner_id` is deliberate insurance, not speculation. Swapping an LLM vendor
// later is one file's internals; retrofitting ownership onto rows that already
// exist is a data migration plus every query that reads them. It is written from
// the LOCAL_OWNER constant rather than a column DEFAULT, since a primary key that
// is always supplied explicitly would never fire the default — the column is the
// insurance, not the default. See FUTURE-INTEGRATION.md.
db.exec(`
  CREATE TABLE IF NOT EXISTS traveler_profile (
    owner_id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

// Dev-only: one row per (fixture x model) benchmark cell. Kept here with every other table so it
// follows the same create-at-import convention, but nothing in the production app reads it — see
// src/lib/bench and the /bench route, both gated to NODE_ENV === "development".
db.exec(`
  CREATE TABLE IF NOT EXISTS bench_results (
    id TEXT PRIMARY KEY,
    fixture_id TEXT NOT NULL,
    model TEXT NOT NULL,
    run_id TEXT,
    trace_id TEXT,
    itinerary_md TEXT NOT NULL,
    scores_json TEXT NOT NULL,
    composite REAL,
    created_at TEXT NOT NULL
  )
`);

// Dev-only: trips typed into the benchmark form. The whole bundle (reconciled + poiDetails) is
// stored as one frozen blob at creation — see src/lib/bench/customTrip.ts on why re-fetching per
// model would invalidate the comparison.
db.exec(`
  CREATE TABLE IF NOT EXISTS bench_fixtures (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    covers TEXT NOT NULL,
    fixture_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// `run_id`/`trips.run_id` were added after these tables already existed in
// deployed dbs — ALTER TABLE ADD COLUMN errors if the column is already
// there, so this only runs once per fresh column, guarded by PRAGMA lookup.
function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(table: string, column: string, ddlType: string): void {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType}`);
  }
}

/**
 * Reconciles an `llm_sessions` table written by the other API-transport branch before the two were
 * merged.
 *
 * Both branches built this table independently and gave it the same name with different columns —
 * `messages` here, `messages_json`/`model`/`updated_at` there. `CREATE TABLE IF NOT EXISTS` is a
 * no-op against a table that already exists, so it does not reconcile them and cannot: a database
 * written by that build keeps the old shape, and every session read fails with
 * `table llm_sessions has no column named messages`. The merge chose one schema; it could not
 * choose one for databases that already existed.
 *
 * Additive rather than a drop-and-recreate, because those rows are conversations — a trip's chat
 * resumes by replaying them, so dropping the table would silently reset every in-flight trip's
 * memory to nothing while looking like a clean migration. The legacy column is left in place: it
 * costs a few KB and it is the only copy of the data if this ever has to be undone.
 *
 * Guarded on the legacy column existing, so a fresh database runs one PRAGMA and stops.
 */
function migrateLegacyLlmSessions(): void {
  if (!hasColumn("llm_sessions", "messages_json")) return;
  // A rebuild, not an ALTER, and the reason is the constraint rather than the column. Adding
  // `messages` alongside is easy and useless: the legacy `messages_json` is NOT NULL with no
  // default, so the very next insert — which supplies only the columns this build knows about —
  // dies with `NOT NULL constraint failed`. The old shape has to actually go, and SQLite's only
  // route to that is create-copy-drop-rename. (`ALTER TABLE DROP COLUMN` exists in modern SQLite
  // but is refused on a PRIMARY KEY table with dependent indexes, which is what this is.)
  //
  // One transaction, so a crash midway leaves the original table intact rather than a half-copied
  // one — the rows are conversations, and the failure mode of a partial migration is a trip whose
  // chat has forgotten the middle of itself.
  // An earlier build of this migration added a `messages` column before switching to a rebuild, so
  // a database may carry either shape. Prefer the new column where it exists and has been filled,
  // fall back to the legacy one — naming a column that isn't there is itself a hard error, which is
  // why this is computed rather than written as a flat COALESCE.
  const source = hasColumn("llm_sessions", "messages")
    ? "COALESCE(messages, messages_json)"
    : "messages_json";
  db.exec(`
    BEGIN;
    CREATE TABLE llm_sessions_migrated (
      id TEXT PRIMARY KEY,
      messages TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO llm_sessions_migrated (id, messages, created_at)
      SELECT id, ${source}, created_at FROM llm_sessions;
    DROP TABLE llm_sessions;
    ALTER TABLE llm_sessions_migrated RENAME TO llm_sessions;
    COMMIT;
  `);
}
migrateLegacyLlmSessions();
addColumnIfMissing("llm_traces", "run_id", "TEXT");
addColumnIfMissing("trips", "run_id", "TEXT");
// The Step 2b answers (priorities, energy, crowds, group, purpose). Stored so the edit loop can
// read the traveler's profile back instead of asking them things they already told us.
addColumnIfMissing("trips", "user_answers_json", "TEXT");
// Set only by scripts/perf-bench.mjs, tagging every run created during one
// benchmark invocation so the Perf Dashboard can diff two labeled batches.
// Organic/manual usage keeps this null and shows up under "All time".
addColumnIfMissing("llm_runs", "batch_tag", "TEXT");
// Refine cells are keyed by (fixture, model, task); NULL is a generation cell. Nullable rather
// than defaulted so every row written before refine existed still reads as a generation row.
addColumnIfMissing("bench_results", "task_id", "TEXT");
// The `claude` CLI session that generated this trip, so the edit chat can resume the same
// conversation instead of opening a fresh one. Nullable and always optional: the session is a
// JSONL file on whichever machine ran the generation, so it can be absent (trip generated before
// this existed), stale, or gone (another device, a cleaned home dir) — every reader must be able
// to fall back to a fully-rebuilt prompt. See SessionOption in claude.ts.
addColumnIfMissing("trips", "chat_session_id", "TEXT");
// `draft` until the traveler keeps it, `saved` once they do. Nullable rather than defaulted for
// the usual reason — the rows that predate the column all exist *because* somebody pressed Save,
// so they are not drafts and must not read as one.
addColumnIfMissing("trips", "status", "TEXT");
// The one-time backfill for exactly those rows. `status IS NULL` can only ever match them:
// `insertTrip` has written the column since it existed, so after the first boot this is a no-op
// that costs one statement at import — cheaper than a nullable read every caller has to remember
// to coalesce. Deliberately not `WHERE status IS NULL OR status = ''`; nothing writes an empty
// string, and widening it would catch a value some future writer meant.
db.exec(`UPDATE trips SET status = 'saved' WHERE status IS NULL`);
// Which browser wrote this trip — see src/lib/owner.ts. Nullable rather than defaulted, then
// backfilled to the legacy bucket below, for the same reason `status` was: the rows that predate
// the column cannot be attributed to anyone, and guessing would be worse than saying so.
addColumnIfMissing("trips", "owner_id", "TEXT");
// One statement at import, a no-op after the first boot — `insertTrip` has written the column
// since it existed. Rows holding LEGACY_OWNER stay readable by every browser; see LEGACY_OWNER.
db.exec(`UPDATE trips SET owner_id = '${LEGACY_OWNER}' WHERE owner_id IS NULL`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_trips_owner_status ON trips (owner_id, status, created_at)`);
// Populated only by runClaudeViaApi() — the Messages API reports no cost itself, so this is
// computed from its usage block via modelPricing.ts at write time. NULL forever on
// LLM_TRANSPORT=cli traces, which keep deriving cost from the CLI envelope on read instead
// (see runs.ts/perfAggregate.ts) — both are permanent, not a migration in progress.
addColumnIfMissing("llm_traces", "cost_usd", "REAL");

export interface TripRow {
  id: string;
  destination: string;
  start_date: string;
  end_date: string;
  budget: number;
  itinerary_json: string;
  run_id: string | null;
  user_answers_json: string | null;
  chat_session_id: string | null;
  /** See `TripStatus`. Typed as non-null because the column is backfilled at import and written
   *  on every insert, so no row can be read without one. */
  status: TripStatus;
  /** The browser that wrote it, or `LEGACY_OWNER` for rows that predate ownership. Non-null for
   *  the same reason as `status` — backfilled at import, written on every insert. */
  owner_id: string;
  created_at: string;
}

export function insertTrip(
  trip: Omit<
    TripRow,
    "created_at" | "run_id" | "user_answers_json" | "chat_session_id" | "status" | "owner_id"
  > & {
    run_id?: string | null;
    user_answers_json?: string | null;
    chat_session_id?: string | null;
    /** Defaults to `"saved"`, so a caller that predates drafts keeps inserting kept trips. The
     *  auto-draft written after a generation is the one caller that passes `"draft"`. */
    status?: TripStatus;
    /** Defaults to the legacy bucket, so a caller with no cookie (curl, the perf scripts, the
     *  bench harness) writes a row every browser can still see — exactly what it saw before
     *  ownership existed. Browser traffic always supplies a real one via the proxy. */
    owner_id?: string;
  }
): TripRow {
  const created_at = new Date().toISOString();
  const run_id = trip.run_id ?? null;
  const user_answers_json = trip.user_answers_json ?? null;
  const chat_session_id = trip.chat_session_id ?? null;
  const status: TripStatus = trip.status ?? "saved";
  const owner_id = trip.owner_id ?? LEGACY_OWNER;
  db.prepare(
    `INSERT INTO trips (id, destination, start_date, end_date, budget, itinerary_json, run_id, user_answers_json, chat_session_id, status, owner_id, created_at)
     VALUES (@id, @destination, @start_date, @end_date, @budget, @itinerary_json, @run_id, @user_answers_json, @chat_session_id, @status, @owner_id, @created_at)`
  ).run({ ...trip, run_id, user_answers_json, chat_session_id, status, owner_id, created_at });
  return { ...trip, run_id, user_answers_json, chat_session_id, status, owner_id, created_at };
}

/**
 * Remembers which CLI session is carrying this trip's edit conversation.
 *
 * Written on every chat turn rather than once, because the id can legitimately change mid-trip:
 * a resume whose session file has vanished falls back to a fresh session, and that new id is the
 * one the next turn has to continue from.
 */
/**
 * The edit conversation itself, one row per turn.
 *
 * Separate from `trips.chat_session_id`, which is only the *handle* the CLI resumes by. That
 * handle brings the model's memory back; it brings nothing back for the traveler, who reopens
 * the panel to an empty box with no record of what they asked for or what changed. The session
 * can also be replaced mid-trip (a vanished session file falls back to a fresh id), and the
 * transcript should survive that — so it is stored here rather than trusted to the CLI.
 *
 * Only for trips opened at `/trip/[id]`, which is now every plan the traveler comes back to,
 * draft or saved. The pre-save result view on `/` does have a row to hang a conversation on since
 * drafts exist, but it still doesn't use one: it passes no `tripId` to the edit components, so its
 * chat stays in memory for that session and is gone on reload. Wiring `draftTripId` through would
 * persist it — deliberately left undone rather than overlooked, since `/api/trip-edit` writes the
 * itinerary to the row it is given and that page owns its own copy of the plan.
 */
export interface ChatTurnRow {
  id: number;
  trip_id: string;
  role: "user" | "assistant";
  content: string;
  /** The assistant's structured extras (changes, warnings, daysModified, …) as JSON. Null on a
   *  user turn. Stored whole rather than as columns because it is display material the panel
   *  already knows how to render, and splitting it would freeze its shape into the schema. */
  meta_json: string | null;
  created_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS trip_chat_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    meta_json TEXT,
    created_at TEXT NOT NULL
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_turns_trip ON trip_chat_turns (trip_id, id)`);

/** Append one turn. `id` is the ordering — `created_at` is an ISO string and two turns in the
 *  same millisecond would tie, which for a transcript reorders the conversation. */
export function appendChatTurn(turn: {
  tripId: string;
  role: "user" | "assistant";
  content: string;
  meta?: unknown;
}): void {
  db.prepare(
    `INSERT INTO trip_chat_turns (trip_id, role, content, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    turn.tripId,
    turn.role,
    turn.content,
    turn.meta === undefined ? null : JSON.stringify(turn.meta),
    new Date().toISOString()
  );
}

/** The whole conversation, oldest first. */
export function listChatTurns(tripId: string): ChatTurnRow[] {
  return db
    .prepare(`SELECT * FROM trip_chat_turns WHERE trip_id = ? ORDER BY id ASC`)
    .all(tripId) as ChatTurnRow[];
}

/**
 * One cached narration script per (trip, day) — Story mode's spoken version of a day.
 *
 * Keyed by trip and day with the day's content **fingerprint alongside** rather than inside the
 * key, so a re-narration after an edit replaces the stale script instead of accumulating a row per
 * revision. Nobody ever wants yesterday's narration of a day that has since changed, and a table
 * that grows one row per keystroke-era edit is a table that needs a sweeper.
 *
 * A miss is the ordinary case, not an error: an unsaved plan has no trip row to key on (the result
 * view passes no id), so those scripts are generated per press and cached in the browser only.
 */
export interface StoryScriptRow {
  trip_id: string;
  day_index: number;
  /** Hash of `compactDay()` — the same view the prompt showed. Changes exactly when something the
   *  narration could see changed; see the note on `compactDay` for what is deliberately excluded. */
  fingerprint: string;
  script_json: string;
  created_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS trip_stories (
    trip_id TEXT NOT NULL,
    day_index INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    script_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (trip_id, day_index)
  )
`);

export interface MapGeometryRow {
  box: string;
  context_json: string;
  created_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS map_geometry (
    box TEXT PRIMARY KEY,
    context_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

/**
 * Road and water geometry for one map frame, keyed by its rounded bounding box so two trips in the
 * same city share one row.
 *
 * Deliberately **without a TTL**, unlike `trip_stories` above. The public Overpass instances
 * rate-limit by IP across every user of this deployment, and they do it abruptly — a session of
 * testing was enough to have all three refuse outright, which shipped exports whose map was an
 * empty grey box. Major road geometry does not meaningfully change, so re-asking is pure cost.
 * Clear the table if a city ever needs re-fetching.
 */
export function getMapGeometry(box: string): MapGeometryRow | undefined {
  return db.prepare(`SELECT * FROM map_geometry WHERE box = ?`).get(box) as
    | MapGeometryRow
    | undefined;
}

export function saveMapGeometry(box: string, contextJson: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO map_geometry (box, context_json, created_at)
     VALUES (?, ?, ?)`
  ).run(box, contextJson, new Date().toISOString());
}

/** The cached script for this day, or undefined if there is none *for this version of the day*. */
export function getStoryScript(
  tripId: string,
  dayIndex: number,
  fingerprint: string
): StoryScriptRow | undefined {
  return db
    .prepare(
      `SELECT * FROM trip_stories WHERE trip_id = ? AND day_index = ? AND fingerprint = ?`
    )
    .get(tripId, dayIndex, fingerprint) as StoryScriptRow | undefined;
}

export function saveStoryScript(params: {
  tripId: string;
  dayIndex: number;
  fingerprint: string;
  script: unknown;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO trip_stories (trip_id, day_index, fingerprint, script_json, created_at)
     VALUES (@tripId, @dayIndex, @fingerprint, @scriptJson, @createdAt)`
  ).run({
    tripId: params.tripId,
    dayIndex: params.dayIndex,
    fingerprint: params.fingerprint,
    scriptJson: JSON.stringify(params.script),
    createdAt: new Date().toISOString(),
  });
}

export function setTripChatSession(id: string, sessionId: string | null): void {
  db.prepare(`UPDATE trips SET chat_session_id = ? WHERE id = ?`).run(sessionId, id);
}

/** Exactly the columns `listTrips` selects — deliberately narrower than `TripRow`, which
 *  describes the whole table. The old signature claimed `TripRow` while the query returned
 *  neither `run_id` nor `user_answers_json`, so the type was quietly lying about three fields. */
export type TripListRow = Pick<
  TripRow,
  "id" | "destination" | "start_date" | "end_date" | "budget" | "status" | "created_at"
>;

/**
 * Trips of one status, newest first.
 *
 * **Defaults to `"saved"`, and every existing caller depends on that.** `/trips`' memories wall,
 * `/profile`'s recent-trips strip and `/trip/latest` all mean "trips the traveler kept" — an
 * unfiltered list would put a plan somebody abandoned mid-wizard into the hero collage and into
 * the dev entry point. Drafts are read deliberately, by passing `"draft"`.
 */
/**
 * The caller's trips of one status, newest first.
 *
 * Scoped to `ownerId` plus the legacy bucket — see `readableOwners`. `ownerId` defaults to the
 * legacy bucket so every existing caller that never passed one keeps returning exactly what it
 * returned before, which is what makes this column additive rather than a behaviour change.
 *
 * The `IN` list is expanded into placeholders rather than interpolated: it is one or two values
 * decided entirely server-side, but a query built by concatenation is a habit that outlives the
 * one safe call site it was written for.
 */
export function listTrips(
  status: TripStatus = "saved",
  ownerId: string = LEGACY_OWNER
): TripListRow[] {
  const owners = readableOwners(ownerId);
  return db
    .prepare(
      // No `itinerary_json`: it was being selected and then dropped by every caller, which meant
      // reading every stored itinerary off disk to render a list of destinations and dates.
      `SELECT id, destination, start_date, end_date, budget, status, created_at
       FROM trips WHERE status = ? AND owner_id IN (${owners.map(() => "?").join(",")})
       ORDER BY created_at DESC`
    )
    .all(status, ...owners) as TripListRow[];
}

/**
 * Keeps a draft: the same row, re-labelled.
 *
 * Promotion rather than a second insert is the whole point. The draft row is what the traveler has
 * been editing since the moment it was generated — its id is in `generations.trip_id`, its chat
 * turns are in `trip_chat_turns`, and its `chat_session_id` carries the planner's own reasoning.
 * Inserting a copy on Save would leave all of that pointing at a row nobody opens again.
 *
 * Idempotent and safe on an already-saved trip, so a double-clicked Save button is not a bug.
 */
export function promoteTripToSaved(id: string): void {
  db.prepare(`UPDATE trips SET status = 'saved' WHERE id = ?`).run(id);
}

/**
 * Deletes drafts older than the TTL, and returns how many went.
 *
 * Called on read from the pages that list trips rather than from a scheduler: this app has no
 * background worker, and a sweep that only runs when somebody is actually looking at their trips
 * is enough for rows whose only cost is disk. `saved` rows are untouchable here — the `status`
 * predicate is the load-bearing half of this statement, not the date.
 *
 * See `staleDraftCutoff` for why the cutoff is built in JS instead of by SQLite's `datetime()`.
 */
export function purgeStaleDrafts(now: Date = new Date()): number {
  const result = db
    .prepare(`DELETE FROM trips WHERE status = 'draft' AND created_at < ?`)
    .run(staleDraftCutoff(now));
  return result.changes;
}

export function getTrip(id: string): TripRow | undefined {
  return db.prepare(`SELECT * FROM trips WHERE id = ?`).get(id) as
    | TripRow
    | undefined;
}

/**
 * Writes the itinerary, and the trip's end date with it when the edit changed the trip's length.
 *
 * The two have to move together: `trips.end_date` is what the trip list and every date range in the
 * UI read, so an itinerary that grew a day while the row still claimed the old end date would show
 * a 4-day plan filed under a 3-day trip. One statement, so they can't diverge halfway.
 */
export function updateTripItinerary(
  id: string,
  itineraryJson: string,
  endDate?: string
): void {
  if (endDate) {
    db.prepare(`UPDATE trips SET itinerary_json = ?, end_date = ? WHERE id = ?`).run(
      itineraryJson,
      endDate,
      id
    );
    return;
  }
  db.prepare(`UPDATE trips SET itinerary_json = ? WHERE id = ?`).run(itineraryJson, id);
}

/**
 * Deletes the trip row only. `llm_runs.trip_id` and the `trip_artifacts` keyed by
 * `trips.run_id` are deliberately left behind: `trip_id` is written but never read or
 * joined anywhere, and those rows are an audit log that a generation *happened* — not
 * trip content. Deleting a saved trip shouldn't erase the record of the LLM calls that
 * produced it, and the trace viewer keeps working either way since it reads `destination`
 * and `kind` off the run rather than resolving the trip.
 */
/**
 * Delete one trip, if it belongs to the caller.
 *
 * Scoped where `getTrip` deliberately is not. Reading a trip by its id is how a shared link works
 * and the id is unguessable; *destroying* one is the operation where being wrong is unrecoverable,
 * so it is the one that checks. Returns whether a row actually went, so a caller can tell "deleted"
 * from "not yours" instead of reporting success either way.
 */
export function deleteTrip(id: string, ownerId: string = LEGACY_OWNER): boolean {
  const owners = readableOwners(ownerId);
  const result = db
    .prepare(
      `DELETE FROM trips WHERE id = ? AND owner_id IN (${owners.map(() => "?").join(",")})`
    )
    .run(id, ...owners);
  return result.changes > 0;
}

/** The two frozen Step 5/6 artifacts, keyed by the run that produced them. Kept out of `trips`
 *  because they exist before a trip is ever saved — and Step 7's edit loop needs the context to
 *  stay byte-identical across edits, so it's stored once and never regenerated. */
export interface TripArtifactRow {
  run_id: string;
  trip_context_md: string;
  itinerary_md: string;
  created_at: string;
}

export function insertTripArtifacts(
  artifacts: Omit<TripArtifactRow, "created_at">
): TripArtifactRow {
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO trip_artifacts (run_id, trip_context_md, itinerary_md, created_at)
     VALUES (@run_id, @trip_context_md, @itinerary_md, @created_at)`
  ).run({ ...artifacts, created_at });
  return { ...artifacts, created_at };
}

export function getTripArtifacts(runId: string): TripArtifactRow | undefined {
  return db.prepare(`SELECT * FROM trip_artifacts WHERE run_id = ?`).get(runId) as
    | TripArtifactRow
    | undefined;
}

/**
 * Conversational memory for the API transport lives in `llm_sessions` — see `createLlmSession` /
 * `getLlmSession` / `appendLlmSessionTurns` further down. The table and those accessors arrived
 * with the deploy branch; a second `llm_sessions` declared here (different columns, same name)
 * would have been created only if it won the import race and silently ignored otherwise, which is
 * the worst shape a schema conflict can take. One table.
 */

/**
 * One row per itinerary generation, written the moment the model answers.
 *
 * Deliberately NOT the `trips` table. A trip row is something the traveller chose to keep — it has
 * a URL, it shows in the trips list, and it is created by `save()` in HomeView. A generation is
 * something that merely happened, and most of them are discarded: writing drafts into `trips`
 * would fill the traveller's own list with plans they rejected.
 *
 * What it stores is the full input→output record: `context_json` is the exact argument object
 * handed to `buildGeneratePrompt`/`buildRefinePrompt` (the "context/account payload"), `prompt` is
 * what that produced, and `response` is the raw model text before any parsing. Together those three
 * make a generation reproducible without re-running the fetch stages — and give the chat and detail
 * flows a base context to read instead of regenerate.
 */
export interface GenerationRow {
  run_id: string;
  trip_id: string | null;
  session_id: string | null;
  kind: string;
  destination: string;
  context_json: string;
  prompt: string;
  response: string;
  model: string;
  mode: string;
  created_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS generations (
    run_id TEXT PRIMARY KEY,
    trip_id TEXT,
    session_id TEXT,
    kind TEXT NOT NULL,
    destination TEXT NOT NULL,
    context_json TEXT NOT NULL,
    prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    model TEXT NOT NULL,
    mode TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_trip ON generations (trip_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_session ON generations (session_id)`);

/** `INSERT OR REPLACE` keyed by run: a run generates once, and a retry under the same run id is a
 *  correction of that record rather than a second one. */
export function insertGeneration(row: Omit<GenerationRow, "created_at">): GenerationRow {
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO generations
       (run_id, trip_id, session_id, kind, destination, context_json, prompt, response, model, mode, created_at)
     VALUES (@run_id, @trip_id, @session_id, @kind, @destination, @context_json, @prompt, @response, @model, @mode, @created_at)`
  ).run({ ...row, created_at });
  return { ...row, created_at };
}

export function getGeneration(runId: string): GenerationRow | undefined {
  return db.prepare(`SELECT * FROM generations WHERE run_id = ?`).get(runId) as
    | GenerationRow
    | undefined;
}

/**
 * The most recent generation for a trip — the plan the cheap flows should read, after any number
 * of refines.
 *
 * `created_at` sorts lexically (every writer here uses `toISOString()`), but on its own it is not a
 * total order: two rows written in the same millisecond tie, and the tie is broken arbitrarily. That
 * is the same trap `trip_chat_turns` documents and dodges with its AUTOINCREMENT `id` — this table
 * is keyed by `run_id` and has no such column, so `rowid` (SQLite's implicit, monotonically
 * increasing insert counter) is the tiebreak. `INSERT OR REPLACE` assigns a fresh rowid, which is
 * the behaviour wanted here: a corrected generation is the newest one.
 *
 * A real trip cannot generate twice in a millisecond — a generation takes minutes — so this is
 * defensive rather than load-bearing in production. It is load-bearing in tests, and a tie that only
 * shows up under a seeded fixture is exactly the kind that reaches production eventually.
 */
export function getLatestGenerationForTrip(tripId: string): GenerationRow | undefined {
  return db
    .prepare(
      `SELECT * FROM generations WHERE trip_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(tripId) as GenerationRow | undefined;
}

/** Attach a generation to the trip row that was eventually saved from it. Called by `POST
 *  /api/trips`, since the run exists before the trip does. */
export function linkGenerationToTrip(runId: string, tripId: string): void {
  db.prepare(`UPDATE generations SET trip_id = ? WHERE run_id = ?`).run(tripId, runId);
}

export interface TraceRow {
  id: string;
  type: string;
  prompt: string;
  raw_response: string | null;
  model: string;
  duration_ms: number | null;
  status: string;
  error_message: string | null;
  run_id: string | null;
  cost_usd: number | null;
  created_at: string;
}

export function insertTrace(params: {
  type: string;
  prompt: string;
  model: string;
  runId?: string;
}): string {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO llm_traces (id, type, prompt, model, run_id, status, created_at)
     VALUES (@id, @type, @prompt, @model, @runId, 'pending', @created_at)`
  ).run({
    id,
    type: params.type,
    prompt: params.prompt,
    model: params.model,
    runId: params.runId ?? null,
    created_at,
  });
  return id;
}

export function updateTrace(
  id: string,
  fields: {
    status: string;
    rawResponse?: string;
    durationMs?: number;
    errorMessage?: string;
    costUsd?: number;
  }
): void {
  db.prepare(
    `UPDATE llm_traces
     SET status = @status,
         raw_response = COALESCE(@rawResponse, raw_response),
         duration_ms = @durationMs,
         error_message = @errorMessage,
         cost_usd = COALESCE(@costUsd, cost_usd)
     WHERE id = @id`
  ).run({
    id,
    status: fields.status,
    rawResponse: fields.rawResponse ?? null,
    durationMs: fields.durationMs ?? null,
    errorMessage: fields.errorMessage ?? null,
    costUsd: fields.costUsd ?? null,
  });
}

export function listTraces(): TraceRow[] {
  return db
    .prepare(
      `SELECT id, type, status, model, duration_ms, created_at
       FROM llm_traces ORDER BY created_at DESC LIMIT 100`
    )
    .all() as TraceRow[];
}

export interface PendingTrace {
  id: string;
  type: string;
  model: string;
  destination: string | null;
  createdAt: string;
}

/**
 * Calls in flight RIGHT NOW, wherever they came from — a browser click, a curl one-liner, a
 * script like scripts/mint-base-itineraries.mjs. `insertTrace` writes this row with status
 * 'pending' before the CLI even spawns (`claude.ts`), so it is a live, database-backed signal
 * rather than component state in one browser tab.
 *
 * That distinction is the reason this exists: `busy`/`progress` in BenchConsole only ever reflect
 * the tab that clicked the button, are wiped by a reload, and stay empty for the entire duration
 * of a sweep driven from outside the browser — exactly what happened when the Task 9 sweep ran
 * from a script and nobody watching /bench in a browser had any way to see it was happening.
 *
 * LEFT JOIN, not inner: a call not yet part of a run (there is no run_id until the caller creates
 * one) must still show up as pending, or the one case this exists to catch — "is anything running
 * at all" — silently drops rows the same way `listTracesForPerf`'s inner join does.
 */
export function listPendingTraces(): PendingTrace[] {
  return db
    .prepare(
      `SELECT t.id, t.type, t.model, r.destination as destination, t.created_at as createdAt
       FROM llm_traces t LEFT JOIN llm_runs r ON t.run_id = r.id
       WHERE t.status = 'pending'
       ORDER BY t.created_at DESC
       LIMIT 10`
    )
    .all() as PendingTrace[];
}

export function getTrace(id: string): TraceRow | undefined {
  return db.prepare(`SELECT * FROM llm_traces WHERE id = ?`).get(id) as
    | TraceRow
    | undefined;
}

export interface RunRow {
  id: string;
  kind: string;
  destination: string;
  trip_id: string | null;
  created_at: string;
}

export function insertRun(params: {
  id: string;
  kind: string;
  destination: string;
  tripId?: string | null;
}): void {
  db.prepare(
    `INSERT INTO llm_runs (id, kind, destination, trip_id, created_at)
     VALUES (@id, @kind, @destination, @tripId, @createdAt)`
  ).run({
    id: params.id,
    kind: params.kind,
    destination: params.destination,
    tripId: params.tripId ?? null,
    createdAt: new Date().toISOString(),
  });
}

export function listRuns(): RunRow[] {
  return db.prepare(`SELECT * FROM llm_runs ORDER BY rowid DESC`).all() as RunRow[];
}

export function getRun(id: string): RunRow | undefined {
  return db.prepare(`SELECT * FROM llm_runs WHERE id = ?`).get(id) as RunRow | undefined;
}

/** All steps across all runs, ordered oldest-first within each run — grouped
 *  by `run_id` by the caller. `rowid` (not `created_at`) is the ordering key
 *  since better-sqlite3 is synchronous/single-connection, so insertion order
 *  is exact even when two steps land in the same millisecond. */
export function listGroupedTraces(): TraceRow[] {
  return db
    .prepare(`SELECT * FROM llm_traces WHERE run_id IS NOT NULL ORDER BY rowid ASC`)
    .all() as TraceRow[];
}

export function getRunSteps(runId: string): TraceRow[] {
  return db
    .prepare(`SELECT * FROM llm_traces WHERE run_id = ? ORDER BY rowid ASC`)
    .all(runId) as TraceRow[];
}

export function listUngroupedTraces(): TraceRow[] {
  return db
    .prepare(`SELECT * FROM llm_traces WHERE run_id IS NULL ORDER BY rowid DESC LIMIT 100`)
    .all() as TraceRow[];
}

/** Dev-only benchmark storage. A real generation costs ~90s, so results are persisted and the
 *  page reads them back rather than re-running everything on a refresh. Latest row per
 *  (fixture, model) wins — re-running a cell supersedes the old one without deleting the history. */
export interface BenchResultRow {
  id: string;
  fixture_id: string;
  model: string;
  run_id: string | null;
  trace_id: string | null;
  itinerary_md: string;
  scores_json: string;
  composite: number | null;
  task_id: string | null;
  created_at: string;
}

export function insertBenchResult(row: Omit<BenchResultRow, "id" | "created_at">): BenchResultRow {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO bench_results
       (id, fixture_id, model, run_id, trace_id, itinerary_md, scores_json, composite, task_id, created_at)
     VALUES (@id, @fixture_id, @model, @run_id, @trace_id, @itinerary_md, @scores_json, @composite, @task_id, @created_at)`
  ).run({ ...row, id, created_at });
  return { ...row, id, created_at };
}

/**
 * Most recent row per (fixture, model) among GENERATION cells only. Refine rows (`task_id` set)
 * are excluded outright rather than merely de-duplicated: they carry an incompatible
 * `scores_json` shape (`RefineCellScores`, not `BenchCellScores`) and their `itinerary_md` holds
 * the model's raw JSON patch, not markdown — mixing them into this list is what let a refine row
 * get rendered as a generation cell before this fix. See `listLatestRefineResults` for the
 * counterpart. The grouping no longer needs `COALESCE(task_id, '')` once `task_id IS NULL` is
 * filtered — every remaining row's `task_id` is NULL — so it's dropped here for that reason,
 * while it stays in `listLatestRefineResults` because that grouping still needs to partition by
 * the (non-null) task.
 */
export function listLatestBenchResults(): BenchResultRow[] {
  return db
    .prepare(
      `SELECT * FROM bench_results
       WHERE task_id IS NULL AND rowid IN (
         SELECT MAX(rowid) FROM bench_results
         WHERE task_id IS NULL
         GROUP BY fixture_id, model
       )
       ORDER BY fixture_id, model`
    )
    .all() as BenchResultRow[];
}

/** Most recent row per (fixture, model, task) among REFINE cells only — the `task_id IS NOT NULL`
 *  counterpart to `listLatestBenchResults`. `COALESCE(task_id, '')` is harmless here (task_id is
 *  never null in this filtered set) but kept so the grouping expression stays correct if that
 *  invariant ever loosens. */
export function listLatestRefineResults(): BenchResultRow[] {
  return db
    .prepare(
      `SELECT * FROM bench_results
       WHERE task_id IS NOT NULL AND rowid IN (
         SELECT MAX(rowid) FROM bench_results
         WHERE task_id IS NOT NULL
         GROUP BY fixture_id, model, COALESCE(task_id, '')
       )
       ORDER BY fixture_id, model, COALESCE(task_id, '')`
    )
    .all() as BenchResultRow[];
}

export function clearBenchResults(): void {
  db.exec(`DELETE FROM bench_results`);
}

export function updateBenchResultScores(id: string, scoresJson: string, composite: number | null): void {
  db.prepare(`UPDATE bench_results SET scores_json = ?, composite = ? WHERE id = ?`).run(
    scoresJson,
    composite,
    id
  );
}

/**
 * Feeds the blinded judge, which grades generations only. Without the task_id IS NULL
 * filter, MAX(rowid) per (fixture, model) would pick up a refine cell's row once those
 * exist — and a refine row's itinerary_md holds the model's raw JSON patch, not markdown,
 * which is non-empty and so would slip past the caller's `.trim()` guard and get graded
 * as an itinerary.
 */
export function getBenchResultsForFixture(fixtureId: string): BenchResultRow[] {
  return db
    .prepare(
      `SELECT * FROM bench_results
       WHERE fixture_id = ? AND task_id IS NULL AND rowid IN (
         SELECT MAX(rowid) FROM bench_results WHERE task_id IS NULL GROUP BY fixture_id, model
       )
       ORDER BY model`
    )
    .all(fixtureId) as BenchResultRow[];
}

/** Dev-only. A benchmark fixture the developer built from the form, frozen at creation. */
export interface BenchFixtureRow {
  id: string;
  title: string;
  covers: string;
  fixture_json: string;
  created_at: string;
}

export function insertBenchFixture(row: Omit<BenchFixtureRow, "created_at">): BenchFixtureRow {
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO bench_fixtures (id, title, covers, fixture_json, created_at)
     VALUES (@id, @title, @covers, @fixture_json, @created_at)`
  ).run({ ...row, created_at });
  return { ...row, created_at };
}

export function listBenchFixtures(): BenchFixtureRow[] {
  return db.prepare(`SELECT * FROM bench_fixtures ORDER BY created_at ASC`).all() as BenchFixtureRow[];
}

export function deleteBenchFixture(id: string): void {
  db.prepare(`DELETE FROM bench_fixtures WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM bench_results WHERE fixture_id = ?`).run(id);
}

export interface DestinationContextRow {
  destination: string;
  month_bucket: string;
  context_json: string;
  created_at: string;
}

export function getDestinationContextRow(
  destination: string,
  monthBucket: string
): DestinationContextRow | undefined {
  return db
    .prepare(
      `SELECT * FROM destination_context WHERE destination = ? AND month_bucket = ?`
    )
    .get(destination, monthBucket) as DestinationContextRow | undefined;
}

export function upsertDestinationContext(
  destination: string,
  monthBucket: string,
  contextJson: string
): void {
  db.prepare(
    `INSERT INTO destination_context (destination, month_bucket, context_json, created_at)
     VALUES (@destination, @monthBucket, @contextJson, @createdAt)
     ON CONFLICT(destination, month_bucket) DO UPDATE SET
       context_json = excluded.context_json,
       created_at = excluded.created_at`
  ).run({
    destination,
    monthBucket,
    contextJson,
    createdAt: new Date().toISOString(),
  });
}

export interface TravelerProfileRow {
  owner_id: string;
  profile_json: string;
  updated_at: string;
}

export function getTravelerProfile(ownerId: string): TravelerProfileRow | undefined {
  return db.prepare(`SELECT * FROM traveler_profile WHERE owner_id = ?`).get(ownerId) as
    | TravelerProfileRow
    | undefined;
}

export function upsertTravelerProfile(ownerId: string, profileJson: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO traveler_profile (owner_id, profile_json, updated_at)
     VALUES (@owner_id, @profile_json, @updated_at)`
  ).run({
    owner_id: ownerId,
    profile_json: profileJson,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Returns null for "no row" and for "row failed to parse" alike. The house rule
 * elsewhere is that null and empty must stay distinguishable, but here the
 * caller's response is identical either way — fall back to the wizard's built-in
 * defaults — so the distinction would carry no consequence. Deliberate departure
 * from the convention, not an oversight.
 */
export function readProfile(ownerId: string = LOCAL_OWNER): TravelerProfile | null {
  const row = getTravelerProfile(ownerId);
  if (!row) return null;
  try {
    return parseProfile(JSON.parse(row.profile_json));
  } catch {
    return null;
  }
}

export function writeProfile(profile: TravelerProfile, ownerId: string = LOCAL_OWNER): void {
  upsertTravelerProfile(ownerId, JSON.stringify(profile));
}

export interface TraceWithBatchTag extends TraceRow {
  batch_tag: string | null;
}

/** Every successful trace with its run's batch tag attached, for the Perf Dashboard's
 *  aggregation. Only `status = 'ok'` rows count — a timed-out or errored call's duration
 *  and (often absent) envelope fields would skew "how long does this normally take".
 *  Filtering by `batchTag` legitimately requires a run to hang the tag off of, so that
 *  path inner-joins. The unfiltered "all time" path left-joins instead — most traces
 *  (place-detail, context, generate, and all of rebalance/container-theme) are written
 *  without a `run_id`, and an inner join here was silently dropping them from both this
 *  dashboard and the /bench "which model" panel. `batch_tag` comes back null for those. */
export function listTracesForPerf(batchTag?: string): TraceWithBatchTag[] {
  if (batchTag) {
    return db
      .prepare(
        `SELECT t.*, r.batch_tag as batch_tag
         FROM llm_traces t JOIN llm_runs r ON t.run_id = r.id
         WHERE t.status = 'ok' AND r.batch_tag = ?`
      )
      .all(batchTag) as TraceWithBatchTag[];
  }
  return db
    .prepare(
      `SELECT t.*, r.batch_tag as batch_tag
       FROM llm_traces t LEFT JOIN llm_runs r ON t.run_id = r.id
       WHERE t.status = 'ok'`
    )
    .all() as TraceWithBatchTag[];
}

export function listBatchTags(): string[] {
  return (
    db
      .prepare(`SELECT DISTINCT batch_tag FROM llm_runs WHERE batch_tag IS NOT NULL ORDER BY batch_tag`)
      .all() as { batch_tag: string }[]
  ).map((r) => r.batch_tag);
}

/** Tags every untagged run created in [fromIso, toIso] with `label` — how
 *  scripts/perf-bench.mjs marks the batch of runs it just generated without
 *  having to thread a tag through the production API routes. Returns the
 *  number of runs tagged. */
export function tagRunsCreatedBetween(label: string, fromIso: string, toIso: string): number {
  const result = db
    .prepare(
      `UPDATE llm_runs SET batch_tag = @label
       WHERE created_at BETWEEN @fromIso AND @toIso AND batch_tag IS NULL`
    )
    .run({ label, fromIso, toIso });
  return result.changes;
}

export function createLlmSession(messages: unknown[]): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO llm_sessions (id, messages, created_at) VALUES (@id, @messages, @createdAt)`
  ).run({ id, messages: JSON.stringify(messages), createdAt: new Date().toISOString() });
  return id;
}

export function getLlmSession(id: string): unknown[] | undefined {
  const row = db.prepare(`SELECT messages FROM llm_sessions WHERE id = ?`).get(id) as
    | { messages: string }
    | undefined;
  if (!row) return undefined;
  return JSON.parse(row.messages) as unknown[];
}

export function appendLlmSessionTurns(id: string, newTurns: unknown[]): void {
  const existing = getLlmSession(id) ?? [];
  db.prepare(`UPDATE llm_sessions SET messages = ? WHERE id = ?`).run(
    JSON.stringify([...existing, ...newTurns]),
    id
  );
}

/** Sum of `cost_usd` for traces created at or after `isoCutoff`. Built from a caller-supplied ISO
 *  string, never SQLite's `datetime('now', ...)` — see the CLAUDE.md gotcha on comparing ISO
 *  ("...T...Z") timestamps against SQLite's space-separated `datetime()` output. */
export function getSpendSince(isoCutoff: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM llm_traces WHERE created_at >= ?`)
    .get(isoCutoff) as { total: number };
  return row.total;
}
