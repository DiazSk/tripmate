import Database from "better-sqlite3";
import path from "path";

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
