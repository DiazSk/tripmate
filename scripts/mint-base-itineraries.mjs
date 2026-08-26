/* One-time: mint the frozen starting plan each refine cell edits.
 *
 * Run (the dev server must already be listening on $MINT_BASE_URL, default localhost:3000):
 *   node --import ./scripts/ts-resolve.mjs scripts/mint-base-itineraries.mjs [fixtureId ...]
 *
 * Goes over HTTP against POST /api/itinerary — the legacy strict-JSON route — rather than
 * importing generateItinerary()/runGeneration() directly. A direct import throws at load:
 * generationRunner.ts pulls the type-only `CritiqueResult` into a value-import position, which
 * Node's type stripping cannot erase. The route's response is already the app's real `Itinerary`
 * shape with real lat/lng, which is exactly what a refine cell needs to start from — no markdown
 * to convert, and no coordinates to invent.
 *
 * Every model refines the SAME plan, so this runs once and the output is committed as
 * src/lib/bench/baseItineraries.ts. The plan's quality ceiling is one generation call's, which is
 * fine — fairness comes from the plan being identical across models, not from it being optimal.
 * Re-running invalidates every stored refine result, so don't, unless the fixtures themselves
 * changed.
 *
 * Pass one or more fixture ids as argv to (re)mint only those — the scratch file below is merged
 * with, not replaced, so a retry after a partial failure doesn't re-spend the calls that already
 * succeeded. With no args, mints every BENCH_FIXTURES entry. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { BENCH_FIXTURES } from "../src/lib/bench/fixtures.ts";

const BASE_URL = process.env.MINT_BASE_URL ?? "http://localhost:3000";
const SCRATCH_FILE = "scratch-base-itineraries.json";

/** Plain node:http, not fetch: undici's global fetch Agent defaults to a 300s headersTimeout,
 *  and this route's generate -> critique -> Overpass-placing pipeline can legitimately run past
 *  that (confirmed while minting — a fetch()-based attempt died with "Headers Timeout Error"
 *  while the generate call itself had already succeeded server-side). node:http has no such
 *  ceiling unless one is set, which is what a call this slow needs. A 10-minute safety timeout
 *  guards against a genuine hang rather than a slow-but-alive server. */
function postJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest(
      new URL(pathname, BASE_URL),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: 600_000,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let data;
          try {
            data = JSON.parse(raw);
          } catch {
            return reject(new Error(`${pathname} -> ${res.statusCode}: non-JSON response`));
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`${pathname} -> ${res.statusCode}: ${data.error ?? "unknown error"}`));
          }
          resolve(data);
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`${pathname} timed out after 600000ms client-side`)));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function requestBody(f) {
  const days = f.reconciled.rawFetch.dateContext.days;
  return {
    destination: f.reconciled.rawFetch.destination.region ?? f.title,
    startDate: days[0].date,
    endDate: days[days.length - 1].date,
    budget: f.reconciled.userAnswers.budget,
    tier: "midrange",
    userAnswers: f.reconciled.userAnswers,
    dietary: f.reconciled.userAnswers.dietary ?? null,
  };
}

/** Surfaces exactly what the task's own sanity checklist asks for, before anything is committed:
 *  day count, at least one stop per day, real numeric (non-0,0) coordinates, and a tier. This is
 *  a print for a human to read once at mint time, not a substitute for the assertions Task 4 adds
 *  to refineTasks.test.mjs — those are what keep re-running true on every future `npm test`. */
function sanityCheck(id, itinerary) {
  const days = itinerary?.days ?? [];
  const stopCounts = days.map((d) => d.stops?.length ?? 0);
  const allStops = days.flatMap((d) => d.stops ?? []);
  const badCoords = allStops.filter(
    (s) => !Number.isFinite(s.lat) || !Number.isFinite(s.lng) || (s.lat === 0 && s.lng === 0)
  );
  console.log(
    `    days=${days.length} stops/day=[${stopCounts.join(",")}] tier=${itinerary?.tier ?? "MISSING"} badCoords=${badCoords.length}`
  );
  if (badCoords.length > 0) {
    console.log(`    BAD COORDS in ${id}:`, badCoords.map((s) => `${s.name}(${s.lat},${s.lng})`));
  }
  if (stopCounts.some((n) => n === 0)) {
    console.log(`    WARNING: ${id} has a day with zero stops`);
  }
}

const targetIds = process.argv.slice(2);
const knownIds = new Set(BENCH_FIXTURES.map((f) => f.id));
const unknown = targetIds.filter((id) => !knownIds.has(id));
if (unknown.length > 0) {
  console.error("Unknown fixture id(s):", unknown.join(", "));
  process.exit(1);
}
const fixtures = targetIds.length > 0 ? BENCH_FIXTURES.filter((f) => targetIds.includes(f.id)) : BENCH_FIXTURES;

const out = existsSync(SCRATCH_FILE) ? JSON.parse(readFileSync(SCRATCH_FILE, "utf8")) : {};

for (const fixture of fixtures) {
  process.stdout.write(`${fixture.id} … `);
  try {
    const { itinerary } = await postJson("/api/itinerary", requestBody(fixture));
    out[fixture.id] = itinerary;
    console.log("ok");
    sanityCheck(fixture.id, itinerary);
  } catch (err) {
    // A socket-level error (as opposed to an HTTP error status, already formatted by
    // postJson) sometimes nests the real reason in `.cause` — print both, or a retry is
    // just guessing.
    const cause = err.cause ? ` (cause: ${err.cause.message ?? err.cause})` : "";
    console.log(`FAILED: ${err.message}${cause}`);
  }
}

writeFileSync(SCRATCH_FILE, JSON.stringify(out, null, 2));
const minted = BENCH_FIXTURES.filter((f) => out[f.id]).length;
console.log(`\n${minted}/${BENCH_FIXTURES.length} minted -> ${SCRATCH_FILE}`);
