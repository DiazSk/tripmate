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

export interface TripRow {
  id: string;
  destination: string;
  start_date: string;
  end_date: string;
  budget: number;
  itinerary_json: string;
  created_at: string;
}

export function insertTrip(trip: Omit<TripRow, "created_at">): TripRow {
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO trips (id, destination, start_date, end_date, budget, itinerary_json, created_at)
     VALUES (@id, @destination, @start_date, @end_date, @budget, @itinerary_json, @created_at)`
  ).run({ ...trip, created_at });
  return { ...trip, created_at };
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

export interface TraceRow {
  id: string;
  type: string;
  prompt: string;
  raw_response: string | null;
  model: string;
  duration_ms: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export function insertTrace(params: {
  type: string;
  prompt: string;
  model: string;
}): string {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO llm_traces (id, type, prompt, model, status, created_at)
     VALUES (@id, @type, @prompt, @model, 'pending', @created_at)`
  ).run({ id, ...params, created_at });
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
