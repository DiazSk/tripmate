import Database from "better-sqlite3";
import path from "path";
import { randomUUID } from "crypto";

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

export function listTrips(): TripRow[] {
  return db
    .prepare(
      `SELECT id, destination, start_date, end_date, budget, itinerary_json, created_at
       FROM trips ORDER BY created_at DESC`
    )
    .all() as TripRow[];
}

export function getTrip(id: string): TripRow | undefined {
  return db.prepare(`SELECT * FROM trips WHERE id = ?`).get(id) as
    | TripRow
    | undefined;
}

export function updateTripItinerary(id: string, itineraryJson: string): void {
  db.prepare(`UPDATE trips SET itinerary_json = ? WHERE id = ?`).run(itineraryJson, id);
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
