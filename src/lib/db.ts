import Database from "better-sqlite3";
import path from "path";
import { randomUUID } from "crypto";
import { LOCAL_OWNER, parseProfile, type TravelerProfile } from "./travelerProfile";

const db = new Database(path.join(process.cwd(), "tripmate.db"));

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
function addColumnIfMissing(table: string, column: string, ddlType: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType}`);
  }
}
addColumnIfMissing("llm_traces", "run_id", "TEXT");
addColumnIfMissing("trips", "run_id", "TEXT");
// The Step 2b answers (priorities, energy, crowds, group, purpose). Stored so the edit loop can
// read the traveler's profile back instead of asking them things they already told us.
addColumnIfMissing("trips", "user_answers_json", "TEXT");
// Set only by scripts/perf-bench.mjs, tagging every run created during one
// benchmark invocation so the Perf Dashboard can diff two labeled batches.
// Organic/manual usage keeps this null and shows up under "All time".
addColumnIfMissing("llm_runs", "batch_tag", "TEXT");

export interface TripRow {
  id: string;
  destination: string;
  start_date: string;
  end_date: string;
  budget: number;
  itinerary_json: string;
  run_id: string | null;
  user_answers_json: string | null;
  created_at: string;
}

export function insertTrip(
  trip: Omit<TripRow, "created_at" | "run_id" | "user_answers_json"> & {
    run_id?: string | null;
    user_answers_json?: string | null;
  }
): TripRow {
  const created_at = new Date().toISOString();
  const run_id = trip.run_id ?? null;
  const user_answers_json = trip.user_answers_json ?? null;
  db.prepare(
    `INSERT INTO trips (id, destination, start_date, end_date, budget, itinerary_json, run_id, user_answers_json, created_at)
     VALUES (@id, @destination, @start_date, @end_date, @budget, @itinerary_json, @run_id, @user_answers_json, @created_at)`
  ).run({ ...trip, run_id, user_answers_json, created_at });
  return { ...trip, run_id, user_answers_json, created_at };
}

/** Exactly the columns `listTrips` selects — deliberately narrower than `TripRow`, which
 *  describes the whole table. The old signature claimed `TripRow` while the query returned
 *  neither `run_id` nor `user_answers_json`, so the type was quietly lying about three fields. */
export type TripListRow = Pick<
  TripRow,
  "id" | "destination" | "start_date" | "end_date" | "budget" | "created_at"
>;

export function listTrips(): TripListRow[] {
  return db
    .prepare(
      // No `itinerary_json`: it was being selected and then dropped by every caller, which meant
      // reading every stored itinerary off disk to render a list of destinations and dates.
      `SELECT id, destination, start_date, end_date, budget, created_at
       FROM trips ORDER BY created_at DESC`
    )
    .all() as TripListRow[];
}

export function getTrip(id: string): TripRow | undefined {
  return db.prepare(`SELECT * FROM trips WHERE id = ?`).get(id) as
    | TripRow
    | undefined;
}

export function updateTripItinerary(id: string, itineraryJson: string): void {
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
export function deleteTrip(id: string): void {
  db.prepare(`DELETE FROM trips WHERE id = ?`).run(id);
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
  }
): void {
  db.prepare(
    `UPDATE llm_traces
     SET status = @status,
         raw_response = COALESCE(@rawResponse, raw_response),
         duration_ms = @durationMs,
         error_message = @errorMessage
     WHERE id = @id`
  ).run({
    id,
    status: fields.status,
    rawResponse: fields.rawResponse ?? null,
    durationMs: fields.durationMs ?? null,
    errorMessage: fields.errorMessage ?? null,
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
  created_at: string;
}

export function insertBenchResult(row: Omit<BenchResultRow, "id" | "created_at">): BenchResultRow {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO bench_results
       (id, fixture_id, model, run_id, trace_id, itinerary_md, scores_json, composite, created_at)
     VALUES (@id, @fixture_id, @model, @run_id, @trace_id, @itinerary_md, @scores_json, @composite, @created_at)`
  ).run({ ...row, id, created_at });
  return { ...row, id, created_at };
}

/** Most recent row per (fixture, model) pair. */
export function listLatestBenchResults(): BenchResultRow[] {
  return db
    .prepare(
      `SELECT * FROM bench_results
       WHERE rowid IN (
         SELECT MAX(rowid) FROM bench_results GROUP BY fixture_id, model
       )
       ORDER BY fixture_id, model`
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

export function getBenchResultsForFixture(fixtureId: string): BenchResultRow[] {
  return db
    .prepare(
      `SELECT * FROM bench_results
       WHERE fixture_id = ? AND rowid IN (
         SELECT MAX(rowid) FROM bench_results GROUP BY fixture_id, model
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
 *  and (often absent) envelope fields would skew "how long does this normally take". Only
 *  traces with a run (inner join) are included, same restriction `listGroupedTraces` already
 *  applies — a trace can't belong to a batch without a run to hang the tag off of. */
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
       FROM llm_traces t JOIN llm_runs r ON t.run_id = r.id
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
