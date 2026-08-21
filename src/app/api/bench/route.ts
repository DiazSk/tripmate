import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  clearBenchResults,
  deleteBenchFixture,
  getBenchResultsForFixture,
  insertBenchFixture,
  insertRun,
  listLatestBenchResults,
  updateBenchResultScores,
} from "@/lib/db";
import { buildCustomFixture } from "@/lib/bench/customTrip";
import { toItineraryJson } from "@/lib/bench/itineraryJson";
import { benchModels, benchPrices } from "@/lib/bench/models";
import { allFixtures, findFixture, isBuiltIn } from "@/lib/bench/registry";
import {
  aggregateByModel,
  balancedPanel,
  compositeScore,
  computeModelAgreement,
  rowToCell,
  runBenchCell,
  runRefineCell,
} from "@/lib/bench/runBenchmark";
import { findRefineTask, refineTasksFor } from "@/lib/bench/refineTasks";
import { SEMANTIC_METHOD } from "@/lib/bench/scorers/text";
import { judgeFixture, judgeModel } from "@/lib/bench/scorers/judge";

/**
 * Dev-only benchmark API. Guarded the same way `/backend/pipeline` is — outside development every
 * verb 404s, so this can never be reached in a production build.
 *
 * Cells are run ONE AT A TIME by request rather than as a single batch call: a real generation
 * takes minutes, and a full sweep in one HTTP request would sit well past any sane timeout. The
 * client drives the sweep and gets progressive results; every finished cell is already persisted,
 * so a refresh mid-sweep loses nothing.
 */

function devOnly(): NextResponse | null {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

function snapshot() {
  const fixtures = allFixtures();
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const cells = listLatestBenchResults()
    .map(rowToCell)
    // A cell whose custom trip has since been deleted has nothing to score against.
    .filter((c) => byId.has(c.fixtureId))
    .map((cell) => ({
      ...cell,
      // Both halves of the output, for every cell: the markdown the model wrote, and the
      // structured reading of it. Derived on read from the same parser the scorers use, so the
      // JSON view can never disagree with the metrics beside it.
      json: toItineraryJson(cell.itineraryMd, byId.get(cell.fixtureId)!, cell.model),
    }));

  const models = benchModels();
  return {
    fixtures: fixtures.map((f) => ({
      id: f.id,
      title: f.title,
      covers: f.covers,
      builtIn: isBuiltIn(f.id),
      destination: f.reconciled.rawFetch.destination.region,
      startDate: f.reconciled.rawFetch.dateContext.days[0]?.date ?? null,
      tripDays: f.reconciled.rawFetch.dateContext.tripDays,
      group: f.reconciled.userAnswers.group,
      energy: f.reconciled.userAnswers.energy,
      crowds: f.reconciled.userAnswers.crowds,
      explorerStyle: f.reconciled.userAnswers.explorerStyle,
      budget: f.reconciled.userAnswers.budget,
      pace: f.reconciled.resolvedFlags.paceResolved,
      paceSpotsPerDay: f.reconciled.resolvedFlags.paceSpotsPerDay,
      anchors: f.poiDetails.pois.length,
      starred: f.reconciled.resolvedFlags.prioritiesRanked.primary,
      notes: f.reconciled.notes.map((n) => `${n.field}: ${n.detail}`),
    })),
    models,
    prices: benchPrices(),
    judgeModel: judgeModel(),
    semanticMethod: SEMANTIC_METHOD,
    cells,
    aggregates: aggregateByModel(cells, models.map((m) => m.id)),
    // What the aggregate is actually averaging over, so the UI can say so instead of implying
    // every trip is represented.
    panel: balancedPanel(cells, models.map((m) => m.id)),
    agreement: computeModelAgreement(cells),
    // Keyed by fixture id so the console can render the refine-task picker without a second request.
    refineTasks: Object.fromEntries(fixtures.map((f) => [f.id, refineTasksFor(f.id)])),
  };
}

export async function GET() {
  const blocked = devOnly();
  if (blocked) return blocked;
  return NextResponse.json(snapshot());
}

export async function POST(req: NextRequest) {
  const blocked = devOnly();
  if (blocked) return blocked;

  const body = await req.json();

  if (body.action === "clear") {
    clearBenchResults();
    return NextResponse.json(snapshot());
  }

  /** Build a trip from the form: real Step 2a fetch → reconcile → enrich, frozen once. */
  if (body.action === "create-trip") {
    try {
      const { fixture, notes, candidatePois } = await buildCustomFixture(body.input);
      insertBenchFixture({
        id: fixture.id,
        title: fixture.title,
        covers: fixture.covers,
        fixture_json: JSON.stringify(fixture),
      });
      return NextResponse.json({
        ok: true,
        fixtureId: fixture.id,
        notes,
        candidatePois,
        ...snapshot(),
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not build that trip" },
        { status: 400 }
      );
    }
  }

  if (body.action === "delete-trip") {
    if (isBuiltIn(body.fixtureId)) {
      return NextResponse.json({ error: "Built-in fixtures are the fixed test set" }, { status: 400 });
    }
    deleteBenchFixture(body.fixtureId);
    return NextResponse.json({ ok: true, ...snapshot() });
  }

  if (body.action === "run-cell") {
    const fixture = findFixture(body.fixtureId);
    if (!fixture) return NextResponse.json({ error: "Unknown fixture" }, { status: 400 });
    if (typeof body.model !== "string" || !body.model) {
      return NextResponse.json({ error: "Missing model" }, { status: 400 });
    }
    try {
      // Absent taskId keeps the generation path byte-identical for every existing caller.
      if (body.taskId) {
        const task = findRefineTask(body.fixtureId, body.taskId);
        if (!task) return NextResponse.json({ error: "Unknown task" }, { status: 400 });
        const cell = await runRefineCell(fixture, task, body.model);
        return NextResponse.json({ ok: true, cell });
      }

      const cell = await runBenchCell(fixture, body.model);
      return NextResponse.json({ ok: true, cell });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Benchmark cell failed" },
        { status: 500 }
      );
    }
  }

  if (body.action === "judge") {
    const fixture = findFixture(body.fixtureId);
    if (!fixture) return NextResponse.json({ error: "Unknown fixture" }, { status: 400 });

    const rows = getBenchResultsForFixture(fixture.id).filter((r) => r.itinerary_md.trim());
    if (rows.length === 0) {
      return NextResponse.json({ error: "No generated itineraries to judge yet" }, { status: 400 });
    }

    try {
      const runId = randomUUID();
      insertRun({ id: runId, kind: "judge", destination: fixture.title, tripId: null });

      const verdicts = await judgeFixture(
        fixture,
        rows.map((r) => ({ model: r.model, itineraryMd: r.itinerary_md })),
        runId
      );

      // Fold the verdicts into the stored scores rather than keeping a second table — the judge is
      // one more scorer on an existing cell, not a separate kind of result.
      for (const row of rows) {
        const verdict = verdicts[row.model];
        if (!verdict) continue;
        const scores = { ...JSON.parse(row.scores_json), judge: verdict };
        updateBenchResultScores(row.id, JSON.stringify(scores), compositeScore(scores));
      }

      return NextResponse.json({ ok: true, ...snapshot() });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Judging failed" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
