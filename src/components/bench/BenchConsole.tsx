"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BenchModel } from "@/lib/bench/models";
import type { ModelAggregate } from "@/lib/bench/runBenchmark";
import { paretoFrontier } from "@/lib/bench/pareto";
import { RADAR_AXES, VIOLATION_TYPES } from "@/lib/bench/types";
import type { BenchCell, ModelAgreement, RefineCell } from "@/lib/bench/types";
import { GroupedBars, ParetoScatter, RadarChart, SimpleBars, StackedBars, seriesColor } from "./charts";
import BenchTripForm from "./BenchTripForm";
import ItineraryOutput from "./ItineraryOutput";
import type { CustomTripInput } from "@/lib/bench/customTrip";
import type { BenchItineraryJson } from "@/lib/bench/itineraryJson";

interface FixtureSummary {
  id: string;
  title: string;
  covers: string;
  builtIn: boolean;
  destination: string | null;
  startDate: string | null;
  tripDays: number;
  group: string;
  energy: string;
  crowds: string;
  explorerStyle: string;
  budget: number;
  pace: string;
  paceSpotsPerDay: number;
  anchors: number;
  starred: string[];
  notes: string[];
}

/** Cells arrive with both output forms attached — see the API's snapshot(). */
type BenchCellWithJson = BenchCell & { json: BenchItineraryJson };

/** Mirrors `RefineTask` (src/lib/bench/refineTasks.ts) as it comes back over JSON. */
interface RefineTaskSummary {
  id: string;
  message: string;
  dayIndex?: number;
  covers: string;
  expect: { opsExpected: boolean; allowedDays?: number[] };
}

interface Snapshot {
  fixtures: FixtureSummary[];
  models: BenchModel[];
  prices: Record<string, [number, number]>;
  judgeModel: string;
  semanticMethod: string;
  cells: BenchCellWithJson[];
  /** Persisted refine cells (server knows which rows are refine vs. generation — see
   *  listLatestRefineResults in src/lib/db.ts). Session-run refine cells arrive over each
   *  run-cell POST response too; both are merged in applySnapshot below. */
  refineCells: RefineCell[];
  aggregates: ModelAggregate[];
  /** Which trips the aggregate averages over, and which are excluded as incomplete. */
  panel: { included: string[]; excluded: string[] };
  agreement: ModelAgreement[];
  /** Keyed by fixture id — the refine tasks available for that trip. */
  refineTasks: Record<string, RefineTaskSummary[]>;
}

const fmtMs = (v: number) => `${(v / 1000).toFixed(1)}s`;
const fmtUsd = (v: number) => `$${v.toFixed(4)}`;
const fmtPct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);
const fmtNum = (v: number | null, digits = 2) => (v === null ? "—" : v.toFixed(digits));

/** Which scorer family a column comes from — surfaced in the UI, not just in the code. */
function Provenance({
  kind,
}: {
  kind: "computed" | "lexical" | "judged" | "operational" | "estimated";
}) {
  const style = {
    computed: "bg-stone-900 text-white",
    lexical: "bg-stone-200 text-stone-700",
    operational: "bg-stone-200 text-stone-700",
    judged: "bg-amber-200 text-amber-900",
    estimated: "bg-orange-200 text-orange-900",
  }[kind];
  const label = {
    computed: "DETERMINISTIC",
    lexical: "LEXICAL",
    operational: "MEASURED",
    judged: "MODEL-JUDGED",
    estimated: "ESTIMATE-BASED",
  }[kind];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${style}`}>{label}</span>;
}

/**
 * Orientation for a teammate who has never seen Refine mode.
 *
 * Rendered ABOVE the loading and error gates on purpose. It is the one thing on this page that is
 * useful before any data arrives — and most useful when the fetch has failed and there is nothing
 * else to look at. Collapsed by default so it costs nothing to anyone who already knows the tool.
 *
 * Worth having on the page at all because Refine mode is not self-explanatory: its headline
 * number is a DELTA whose sign convention is the OPPOSITE of the Perf Dashboard's, and reading
 * it backwards inverts the benchmark's conclusion. That belongs next to the numbers, not in a
 * doc nobody opens.
 */
function BenchExplainer() {
  return (
    <details className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
      <summary className="cursor-pointer font-semibold text-stone-900">
        What is this page? — read me first
      </summary>

      <div className="mt-3 space-y-4 leading-relaxed">
        <p>This page compares AI models on two different jobs.</p>

        <ul className="ml-5 list-disc space-y-1">
          <li>
            <span className="font-medium text-stone-900">Generate</span> — write a whole trip
            from scratch. This is the original benchmark.
          </li>
          <li>
            <span className="font-medium text-stone-900">Refine</span> — edit a trip that
            already exists, the way the &ldquo;Refine with AI&rdquo; chat does (&ldquo;day 2
            feels rushed, can we start later?&rdquo;). This is new.
          </li>
        </ul>

        <p>
          <span className="font-medium text-stone-900">Why Refine needed its own mode.</span>{" "}
          The generate scores grade a finished trip. A refine call does not return a trip — it
          returns a small patch, a list of edits. So we score the trip <em>before</em> the patch
          and <em>again after</em> applying it, and report the <strong>difference</strong>. That
          difference is what tells you whether the model&apos;s edit helped or hurt.
        </p>

        <div>
          <p className="font-medium text-stone-900">How to run it</p>
          <ol className="mt-1 ml-5 list-decimal space-y-1">
            <li>
              Pick a trip from the list. These are frozen sample trips — same inputs every time,
              so only the model varies.
            </li>
            <li>
              Choose <span className="font-medium">Generate</span> or{" "}
              <span className="font-medium">Refine</span> at the top.
            </li>
            <li>
              In Refine, pick which edit to test. Each trip has three:
              <ul className="mt-1 ml-5 list-disc space-y-0.5">
                <li>
                  <code>retime-day2</code> — &ldquo;make day 2 more relaxed, start later&rdquo;
                </li>
                <li>
                  <code>add-day2</code> — &ldquo;add a stop to day 2&rdquo;
                </li>
                <li>
                  <code>ask-day1-packed</code> — &ldquo;is day 1 too packed?&rdquo; — a question,{" "}
                  <em>not</em> a request to change anything
                </li>
              </ul>
            </li>
            <li>
              Click run. It does one cell at a time on purpose — a whole sweep in one request
              would time out.
            </li>
          </ol>
        </div>

        <div>
          <p className="font-medium text-stone-900">Reading the numbers</p>
          <ul className="mt-1 ml-5 list-disc space-y-1.5">
            <li>
              <span className="font-medium">&Delta; vs base</span> — the score change from the
              patch. <strong>Negative means the edit made the trip worse.</strong> Careful: this
              is the opposite convention from the Perf Dashboard, where lower is better because
              it measures latency.
            </li>
            <li>
              <span className="font-medium">ops emitted / rejected</span> — how many edits the
              model asked for, and how many were invalid (a made-up day or stop number). Rejected
              ops are the most common way a weaker model fails here.
            </li>
            <li>
              <span className="font-medium">restraint</span> — did the model correctly{" "}
              <em>not</em> edit the plan when it was only asked a question. This is the whole
              point of the <code>ask-day1-packed</code> task. Changing a plan someone only asked
              about is worse than being unhelpful.
            </li>
            <li>
              <span className="font-medium">guardrail delta</span> — change in the count of real
              problems (too much travel, overlapping stops, over budget).{" "}
              <strong>Negative is good here</strong> — fewer problems than before.
            </li>
            <li>
              <span className="font-medium">measuredGroups</span> — how many of the five score
              groups could be measured for this trip. A score built on 1 group is not comparable
              to one built on 5, so check this before comparing two cells.
            </li>
          </ul>
        </div>

        <p>
          <span className="font-medium text-stone-900">One known limit.</span> The composite
          score caps at 1.0, so a patch that <em>improves</em> a trip and one that changes
          nothing both read 1.0. It is built to catch a model that makes things worse, not to
          rank two good models against each other.
        </p>

        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="font-semibold text-amber-900">Still to do — Task 9, the full sweep</p>
          <p className="mt-1 text-amber-900">
            Nothing has been swept yet. Any numbers on this page are from one or two exploratory
            cells. The real run is{" "}
            <strong>7 trips &times; 3 edits &times; 3 models = 63 calls</strong>, roughly 37
            minutes and ~2.8M input tokens, which is why it is waiting on a fresh usage limit. It
            answers one question:{" "}
            <strong>
              does Haiku 4.5 degrade a refine edit compared with Sonnet 4.5, and by how much?
            </strong>{" "}
            If it does not, the refine path can move to the cheaper, faster model.
          </p>
          <p className="mt-2 text-amber-900">
            Before trusting a sweep, check nothing got throttled:
          </p>
          <pre className="mt-1 overflow-x-auto rounded bg-amber-100 p-2 text-xs text-amber-950">
{`SELECT model, status, count(*) FROM llm_traces
WHERE type='chat' GROUP BY model, status;`}
          </pre>
          <p className="mt-1 text-amber-900">
            Any <code>error</code> or <code>timeout</code> row means re-run it — a throttled cell
            reads as a <em>missing</em> score, not a failure, because the dashboard filters to{" "}
            <code>status=&apos;ok&apos;</code>.
          </p>
        </div>
      </div>
    </details>
  );
}

export default function BenchConsole() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFixture, setSelectedFixture] = useState<string | null>(null);
  // Defaults to "generate" so the page opens exactly as it always has.
  const [callType, setCallType] = useState<"generate" | "refine">("generate");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Seeded from the snapshot's persisted `refineCells` (see applySnapshot) and topped up with
  // whatever this session runs itself — a fresh run-cell POST response lands here immediately,
  // ahead of the next reload.
  const [refineCells, setRefineCells] = useState<RefineCell[]>([]);

  const fetchSnapshot = useCallback(async (): Promise<Snapshot | null> => {
    const res = await fetch("/api/bench");
    if (!res.ok) return null;
    return (await res.json()) as Snapshot;
  }, []);

  const applySnapshot = useCallback((data: Snapshot) => {
    setSnap(data);
    // Merge the server's persisted refine cells with whatever this session has already
    // accumulated locally (e.g. from a run-cell POST response that landed before this reload) —
    // keyed by (fixture, task, model) so a re-run supersedes rather than duplicates.
    setRefineCells((prev) => {
      const key = (c: RefineCell) => `${c.fixtureId}::${c.taskId}::${c.model}`;
      const merged = new Map(data.refineCells.map((c) => [key(c), c]));
      for (const c of prev) merged.set(key(c), c);
      return [...merged.values()];
    });
    // Prefer a trip that already has results — landing on an empty drill-down when other trips
    // have output makes the page look broken on load.
    setSelectedFixture((current) => {
      if (current) return current;
      const withResults = data.fixtures.find((f) => data.cells.some((c) => c.fixtureId === f.id));
      return withResults?.id ?? data.fixtures[0]?.id ?? null;
    });
  }, []);

  const load = useCallback(async () => {
    const data = await fetchSnapshot();
    if (data) applySnapshot(data);
    else setError("Benchmark API unavailable — is the dev server running in development mode?");
  }, [fetchSnapshot, applySnapshot]);

  // State lands in the promise callback, not in the effect body — this is the "subscribe to an
  // external system" shape, and `cancelled` keeps a slow first fetch from writing after unmount.
  useEffect(() => {
    let cancelled = false;
    void fetchSnapshot().then((data) => {
      if (cancelled) return;
      if (data) applySnapshot(data);
      else setError("Benchmark API unavailable — is the dev server running in development mode?");
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSnapshot, applySnapshot]);

  /** Cells run one request at a time — a real generation is ~90-400s, far past any batch timeout. */
  const runCells = useCallback(
    async (pairs: { fixtureId: string; model: string; taskId?: string }[], label: string) => {
      setBusy(label);
      setError(null);
      setProgress({ done: 0, total: pairs.length });
      for (const [i, pair] of pairs.entries()) {
        try {
          const res = await fetch("/api/bench", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // `taskId` omitted entirely when absent (JSON.stringify drops `undefined`), so the
            // generation path's request body is byte-identical to before this task.
            body: JSON.stringify({ action: "run-cell", ...pair }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(
              `${pair.model} on ${pair.fixtureId}${pair.taskId ? ` (${pair.taskId})` : ""}: ${body.error ?? res.statusText}`
            );
          } else if (pair.taskId && body.cell) {
            // Refine results have no GET snapshot of their own — the POST response is the only
            // place they exist client-side, so each one lands straight into local state here.
            const cell = body.cell as RefineCell;
            setRefineCells((prev) => [
              ...prev.filter(
                (c) => !(c.fixtureId === cell.fixtureId && c.taskId === cell.taskId && c.model === cell.model)
              ),
              cell,
            ]);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "request failed");
        }
        setProgress({ done: i + 1, total: pairs.length });
        await load();
      }
      setBusy(null);
      setProgress(null);
    },
    [load]
  );

  const runFullSweep = () => {
    if (!snap) return;
    if (callType === "refine") {
      void runCells(
        snap.fixtures.flatMap((f) =>
          (snap.refineTasks[f.id] ?? []).flatMap((t) =>
            snap.models.map((m) => ({ fixtureId: f.id, model: m.id, taskId: t.id }))
          )
        ),
        "full refine sweep"
      );
      return;
    }
    void runCells(
      snap.fixtures.flatMap((f) => snap.models.map((m) => ({ fixtureId: f.id, model: m.id }))),
      "full sweep"
    );
  };

  const runOneTrip = () => {
    if (!snap || !selectedFixture) return;
    if (callType === "refine") {
      const tasks = selectedTaskId
        ? (snap.refineTasks[selectedFixture] ?? []).filter((t) => t.id === selectedTaskId)
        : snap.refineTasks[selectedFixture] ?? [];
      void runCells(
        tasks.flatMap((t) =>
          snap.models.map((m) => ({ fixtureId: selectedFixture, model: m.id, taskId: t.id }))
        ),
        "one trip (refine)"
      );
      return;
    }
    void runCells(
      snap.models.map((m) => ({ fixtureId: selectedFixture, model: m.id })),
      "one trip"
    );
  };

  const runJudge = async () => {
    if (!selectedFixture) return;
    setBusy("judge");
    setError(null);
    const res = await fetch("/api/bench", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "judge", fixtureId: selectedFixture }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "judging failed");
    }
    await load();
    setBusy(null);
  };

  const createTrip = useCallback(
    async (input: CustomTripInput) => {
      setBusy("preparing trip");
      setError(null);
      try {
        const res = await fetch("/api/bench", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create-trip", input }),
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error ?? "Could not build that trip" };
        applySnapshot(data as Snapshot);
        // Jump straight to the trip that was just prepared — it's the one being worked on.
        setSelectedFixture(data.fixtureId as string);
        return { notes: data.notes as { field: string; detail: string }[] };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "request failed" };
      } finally {
        setBusy(null);
      }
    },
    [applySnapshot]
  );

  const deleteTrip = async (fixtureId: string) => {
    setBusy("deleting");
    await fetch("/api/bench", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete-trip", fixtureId }),
    });
    setSelectedFixture(null);
    await load();
    setBusy(null);
  };

  const clearAll = async () => {
    setBusy("clear");
    await fetch("/api/bench", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    });
    await load();
    setBusy(null);
  };

  const modelLabel = useCallback(
    (id: string) => snap?.models.find((m) => m.id === id)?.label ?? id,
    [snap]
  );

  /**
   * Colour follows the model, not its position in whatever array a chart happens to iterate.
   * The aggregate list arrives in DB order and the chart series in configured order — keying off
   * the index would hand Opus one colour in the radar and another in the bar chart.
   */
  const modelColor = useCallback(
    (id: string) => {
      const i = snap?.models.findIndex((m) => m.id === id) ?? -1;
      return seriesColor(i >= 0 ? i : (snap?.models.length ?? 0));
    },
    [snap]
  );

  /** Aggregates in configured model order, so every table and chart reads left-to-right the same. */
  const aggregates = useMemo(() => {
    if (!snap) return [];
    const order = new Map(snap.models.map((m, i) => [m.id, i]));
    return [...snap.aggregates].sort(
      (a, b) => (order.get(a.model) ?? 99) - (order.get(b.model) ?? 99)
    );
  }, [snap]);

  /** How many models have a stored result per trip — drives the badges in the trip list. */
  const runCountByFixture = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cell of snap?.cells ?? []) {
      counts.set(cell.fixtureId, (counts.get(cell.fixtureId) ?? 0) + 1);
    }
    return counts;
  }, [snap]);

  /** Cells for the selected trip, ordered to match the configured model order. */
  const fixtureCells = useMemo(() => {
    if (!snap || !selectedFixture) return [];
    const order = new Map(snap.models.map((m, i) => [m.id, i]));
    return snap.cells
      .filter((c) => c.fixtureId === selectedFixture)
      .sort((a, b) => (order.get(a.model) ?? 99) - (order.get(b.model) ?? 99));
  }, [snap, selectedFixture]);

  /** Models with no stored result for the selected trip — offered as a one-click top-up. */
  const missingModels = useMemo(() => {
    if (!snap || !selectedFixture) return [];
    const have = new Set(fixtureCells.map((c) => c.model));
    return snap.models.filter((m) => !have.has(m.id));
  }, [snap, selectedFixture, fixtureCells]);

  /** Refine tasks for the currently selected trip — the picker's source list. */
  const refineTasksForFixture = useMemo(() => {
    if (!snap || !selectedFixture) return [];
    return snap.refineTasks[selectedFixture] ?? [];
  }, [snap, selectedFixture]);

  /** Falls back to the fixture's first task rather than needing an effect to re-sync on switch. */
  const selectedTask = useMemo(
    () => refineTasksForFixture.find((t) => t.id === selectedTaskId) ?? refineTasksForFixture[0] ?? null,
    [refineTasksForFixture, selectedTaskId]
  );

  /** Locally accumulated refine cells for the selected (fixture, task), in configured model order. */
  const taskCells = useMemo(() => {
    if (!snap || !selectedFixture || !selectedTask) return [];
    const order = new Map(snap.models.map((m, i) => [m.id, i]));
    return refineCells
      .filter((c) => c.fixtureId === selectedFixture && c.taskId === selectedTask.id)
      .sort((a, b) => (order.get(a.model) ?? 99) - (order.get(b.model) ?? 99));
  }, [snap, refineCells, selectedFixture, selectedTask]);

  const totalRefineCells = useMemo(() => {
    if (!snap) return 0;
    return snap.fixtures.reduce(
      (sum, f) => sum + (snap.refineTasks[f.id]?.length ?? 0) * snap.models.length,
      0
    );
  }, [snap]);

  const scatterPoints = useMemo(() => {
    if (!snap) return [];
    const raw = aggregates.map((a) => ({
      model: a.model,
      quality: a.meanJudgeOverall !== null ? a.meanJudgeOverall / 10 : a.composite,
      cost: a.meanCostUsd,
    }));
    const frontier = paretoFrontier(raw);
    return raw
      .filter((p) => p.quality !== null && p.cost !== null)
      .map((p) => ({
        label: modelLabel(p.model),
        x: p.cost as number,
        y: p.quality as number,
        onFrontier: frontier.has(p.model),
        color: modelColor(p.model),
      }));
  }, [snap, aggregates, modelLabel, modelColor]);

  if (error && !snap)
    return (
      <div className="space-y-6">
        <BenchExplainer />
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  if (!snap)
    return (
      <div className="space-y-6">
        <BenchExplainer />
        <p className="text-sm text-stone-500">Loading benchmark…</p>
      </div>
    );

  const hasResults = snap.cells.length > 0;
  const usesJudge = aggregates.some((a) => a.meanJudgeOverall !== null);

  return (
    <div className="space-y-6">
      <BenchExplainer />

      {/* --- controls ------------------------------------------------------------------ */}
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-stone-300 p-0.5 text-sm">
            <button
              onClick={() => setCallType("generate")}
              className={`rounded px-2 py-1 ${
                callType === "generate" ? "bg-stone-900 text-white" : "text-stone-600"
              }`}
            >
              Generate
            </button>
            <button
              onClick={() => setCallType("refine")}
              className={`rounded px-2 py-1 ${
                callType === "refine" ? "bg-stone-900 text-white" : "text-stone-600"
              }`}
            >
              Refine
            </button>
          </div>
          <button
            onClick={runFullSweep}
            disabled={busy !== null || (callType === "refine" && totalRefineCells === 0)}
            className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {callType === "refine"
              ? `Run full refine sweep (${snap.fixtures.length} trips × tasks × ${snap.models.length} models = ${totalRefineCells} cells)`
              : `Run full sweep (${snap.fixtures.length} trips × ${snap.models.length} models)`}
          </button>
          <button
            onClick={runOneTrip}
            disabled={
              busy !== null ||
              !selectedFixture ||
              (callType === "refine" && refineTasksForFixture.length === 0)
            }
            className="rounded-md border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Run selected trip only
          </button>
          <button
            onClick={runJudge}
            disabled={busy !== null || fixtureCells.length === 0 || callType === "refine"}
            title={callType === "refine" ? "The judge grades generations only" : undefined}
            className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 disabled:opacity-40"
          >
            Run blinded judge on selected trip
          </button>
          <button
            onClick={clearAll}
            disabled={busy !== null}
            className="ml-auto rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-600 disabled:opacity-40"
          >
            Clear results
          </button>
        </div>

        {busy && (
          <p className="mt-2 text-sm text-stone-600">
            Running {busy}
            {progress && ` — ${progress.done}/${progress.total} cells`}. Each cell is one real
            generation (~1-6 min); finished cells are already saved.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-stone-500 sm:grid-cols-2">
          <div>
            <dt className="inline font-medium text-stone-700">Input held constant:</dt>{" "}
            <dd className="inline">
              same itinerary-planner skill, same frozen trip-context, same generation prompt. Only{" "}
              <code>model</code> varies.
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-stone-700">Models:</dt>{" "}
            <dd className="inline">{snap.models.map((m) => m.id).join(", ")} (set BENCH_MODELS to change)</dd>
          </div>
        </dl>
      </section>

      <BenchTripForm busy={busy !== null} onCreate={createTrip} />

      {/* --- honesty panel ------------------------------------------------------------- */}
      <section className="rounded-lg border border-stone-200 bg-stone-100 p-4 text-xs text-stone-600">
        <p className="mb-2 font-medium text-stone-800">What each number actually is</p>
        <ul className="space-y-1">
          <li>
            <Provenance kind="computed" /> geo coherence, <strong>backtracking</strong> (path vs the
            optimal ordering of the same stops, solved exactly), constraint violations, feasibility,{" "}
            <strong>downtime margin</strong>, <strong>meal proximity</strong>, coverage, grounding,
            format adherence — computed from the itinerary text plus the fixture&apos;s own facts.
            No LLM is involved in producing them.
          </li>
          <li>
            <Provenance kind="computed" /> <strong>weather alignment</strong> and{" "}
            <strong>vibe match</strong> are deterministic too, but rest on a classifier: whether a
            stop is outdoors, and which interest tags it serves, are inferred from the POI&apos;s
            category and its wording. Stops that can&apos;t be classified are left out of the
            denominator rather than guessed at — so a low denominator means &ldquo;little was
            measurable&rdquo;, not &ldquo;all clear&rdquo;.
          </li>
          <li>
            <Provenance kind="estimated" /> <strong>budget accuracy</strong>. The pipeline carries
            no prices at all — the staged path never asks the model for costs — so spend is priced
            from a configurable per-category table (BENCH_STOP_PRICES) and excludes lodging and
            flights. Treat it as an order-of-magnitude check, not an audit.
          </li>
          <li>
            <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-medium text-stone-700">
              &mdash; / n/a
            </span>{" "}
            means the metric had nothing to measure on this trip (no adverse-weather day, too few
            locatable stops to have an ordering). It is never silently scored as a pass, and it is
            dropped from the composite with the remaining weights renormalized.
          </li>
          <li>
            <Provenance kind="operational" /> latency and token counts come from the CLI envelope on
            each trace; cost is those tokens × a configurable price table (BENCH_PRICES).
          </li>
          <li>
            <Provenance kind="lexical" /> length, type-token ratio, n-gram repetition, Flesch-Kincaid.
            Also <em>relevance</em> and <em>model agreement</em>: {snap.semanticMethod}.
          </li>
          <li>
            <Provenance kind="judged" /> quality score, off by default. Blinded (identity stripped,
            seeded order shuffle, one fixed judge: <code>{snap.judgeModel}</code>).{" "}
            <strong className="text-amber-900">
              A Claude model grading Claude models — and if the judge is also a candidate it grades
              its own output. Judges reward length and familiar style and verify no facts. Treat it
              as a soft preference signal, never as ground truth.
            </strong>
          </li>
        </ul>
      </section>

      {!hasResults ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
          No results yet. Run a single trip first to sanity-check the metrics before scaling up.
        </p>
      ) : (
        <>
          {/* --- aggregate table (also the contrast relief for the chart palette) -------- */}
          <section className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-medium text-stone-900">Aggregate, per model</h2>
            <p className="text-xs text-stone-500">
              Composite is weighted: route efficiency 15%, constraint adherence 25%, weather &amp;
              feasibility 15%, meal &amp; vibe 15%, coverage &amp; grounding 30%.{" "}
              <strong className="text-stone-700">
                Format adherence and budget are shown but not weighted
              </strong>{" "}
              — they aren&apos;t in those five groups.
            </p>
            <p className="mb-2 text-xs text-stone-500">
              {snap.panel.included.length === 0 ? (
                <span className="text-amber-800">
                  No trip has been planned by all {snap.models.length} models yet, so there is
                  nothing to compare like-for-like. The rows below are empty by design — run the
                  missing models on a trip to populate them.
                </span>
              ) : (
                <>
                  Averaged over the {snap.panel.included.length} trip
                  {snap.panel.included.length === 1 ? "" : "s"} every model has planned.
                  {snap.panel.excluded.length > 0 && (
                    <span className="text-amber-800">
                      {" "}
                      {snap.panel.excluded.length} trip
                      {snap.panel.excluded.length === 1 ? " is" : "s are"} excluded until every model
                      has run {snap.panel.excluded.length === 1 ? "it" : "them"} — averaging over
                      different trip sets per model would not be a like-for-like comparison.
                    </span>
                  )}
                </>
              )}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-stone-500">
                  <tr className="border-b border-stone-200">
                    <th className="py-1.5 pr-3">Model</th>
                    <th className="py-1.5 pr-3">Cells</th>
                    <th className="py-1.5 pr-3">Fail</th>
                    <th className="py-1.5 pr-3">Composite</th>
                    <th className="py-1.5 pr-3">Geo (norm)</th>
                    <th className="py-1.5 pr-3" title="geo_backtrack_ratio — actual path vs optimal ordering of the same stops">Backtrack</th>
                    <th className="py-1.5 pr-3">Constraints</th>
                    <th className="py-1.5 pr-3" title="meal_proximity_score — share of meals within 20 min of the prior stop">Meal prox</th>
                    <th className="py-1.5 pr-3" title="downtime_margin_score — share of days with 60+ min unallocated">Downtime</th>
                    <th className="py-1.5 pr-3" title="weather_alignment_score — outdoor stops avoided on adverse days">Weather</th>
                    <th className="py-1.5 pr-3" title="budget_accuracy_score — ESTIMATED spend vs stated budget">Budget*</th>
                    <th className="py-1.5 pr-3" title="vibe_match_score — share of stops carrying a traveler tag">Vibe</th>
                    <th className="py-1.5 pr-3">Coverage</th>
                    <th className="py-1.5 pr-3">Grounding</th>
                    <th className="py-1.5 pr-3">Format pass</th>
                    <th className="py-1.5 pr-3">Latency</th>
                    <th className="py-1.5 pr-3">In tok</th>
                    <th className="py-1.5 pr-3">Out tok</th>
                    <th className="py-1.5 pr-3">$/itin</th>
                    <th className="py-1.5 pr-3">Words</th>
                    <th className="py-1.5 pr-3">TTR</th>
                    <th className="py-1.5 pr-3">FK grade</th>
                    <th className="py-1.5 pr-3">Relevance</th>
                    {usesJudge && <th className="py-1.5 pr-3 text-amber-800">Judge</th>}
                  </tr>
                </thead>
                <tbody>
                  {aggregates.map((a) => (
                    <tr key={a.model} className="border-b border-stone-100">
                      <td className="py-1.5 pr-3 font-medium text-stone-900">
                        <span
                          className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                          style={{ background: modelColor(a.model) }}
                        />
                        {modelLabel(a.model)}
                      </td>
                      <td className="py-1.5 pr-3">{a.cells}</td>
                      <td className="py-1.5 pr-3">{a.failures || "—"}</td>
                      <td className="py-1.5 pr-3 font-medium">{fmtNum(a.composite, 3)}</td>
                      <td className="py-1.5 pr-3">{fmtNum(a.meanGeoCoherence)}</td>
                      <td className="py-1.5 pr-3" title={a.meanExcessKm === null ? "" : `${fmtNum(a.meanExcessKm, 1)} km walked beyond optimal, per scored day`}>
                        {fmtNum(a.meanBacktrack)}
                      </td>
                      <td className="py-1.5 pr-3">{fmtNum(a.radar.constraintAdherence)}</td>
                      <td className="py-1.5 pr-3" title={`${a.mealDetours} meal(s) over the 20 min cap`}>
                        {fmtNum(a.meanMealProximity)}
                      </td>
                      <td className="py-1.5 pr-3" title={`${a.tightDays} day(s) under the 60 min slack floor`}>
                        {fmtNum(a.meanDowntime)}
                      </td>
                      <td className="py-1.5 pr-3" title={a.weatherApplicableCells === 0 ? "no adverse-weather days in the panel" : `${a.weatherApplicableCells} cell(s) had adverse days`}>
                        {fmtNum(a.meanWeatherAlignment)}
                      </td>
                      <td className="py-1.5 pr-3" title={a.meanEstimatedUsd === null ? "" : `~$${fmtNum(a.meanEstimatedUsd, 0)} estimated spend`}>
                        {fmtNum(a.meanBudget)}
                      </td>
                      <td className="py-1.5 pr-3" title={a.meanVibeJaccard === null ? "" : `Jaccard ${fmtNum(a.meanVibeJaccard)}`}>
                        {fmtNum(a.meanVibe)}
                      </td>
                      <td className="py-1.5 pr-3">{fmtNum(a.meanCoverage)}</td>
                      <td className="py-1.5 pr-3">{fmtNum(a.meanGrounding)}</td>
                      <td className="py-1.5 pr-3">{fmtPct(a.formatPassRate)}</td>
                      <td className="py-1.5 pr-3">{a.meanLatencyMs === null ? "—" : fmtMs(a.meanLatencyMs)}</td>
                      <td className="py-1.5 pr-3">{fmtNum(a.meanInputTokens, 0)}</td>
                      <td className="py-1.5 pr-3">{fmtNum(a.meanOutputTokens, 0)}</td>
                      <td className="py-1.5 pr-3">{a.meanCostUsd === null ? "—" : fmtUsd(a.meanCostUsd)}</td>
                      <td className="py-1.5 pr-3">{fmtNum(a.meanWords, 0)}</td>
                      <td className="py-1.5 pr-3">{fmtNum(a.meanTypeTokenRatio, 3)}</td>
                      <td className="py-1.5 pr-3">{fmtNum(a.meanFleschKincaid, 1)}</td>
                      <td className="py-1.5 pr-3">{fmtNum(a.meanRelevance, 3)}</td>
                      {usesJudge && (
                        <td className="py-1.5 pr-3 text-amber-800">{fmtNum(a.meanJudgeOverall, 1)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* --- charts ------------------------------------------------------------------ */}
          <div className="grid gap-4 lg:grid-cols-2">
            <RadarChart
              title="Quality profile per model"
              note="normalized 0-1, higher is better · DETERMINISTIC"
              axes={RADAR_AXES.map((a) => a.label)}
              series={aggregates.map((a) => ({
                label: modelLabel(a.model),
                values: RADAR_AXES.map(({ key }) => a.radar[key] ?? null),
                color: modelColor(a.model),
              }))}
            />

            <ParetoScatter
              title={usesJudge ? "Judge quality vs cost" : "Composite quality vs cost"}
              note={usesJudge ? "quality is MODEL-JUDGED" : "quality is the deterministic composite"}
              xLabel="mean cost per itinerary (USD)"
              yLabel="quality (0-1)"
              points={scatterPoints}
            />

            <GroupedBars
              title="Latency per trip"
              note="wall clock of the single generation call · MEASURED"
              seriesLabels={snap.models.map((m) => m.label)}
              seriesColors={snap.models.map((m) => modelColor(m.id))}
              format={(v) => fmtMs(v)}
              data={snap.fixtures.map((f) => ({
                group: f.id.split("-")[0],
                values: snap.models.map((m) => {
                  const cell = snap.cells.find((c) => c.fixtureId === f.id && c.model === m.id);
                  return cell && !cell.scores.operational.failed ? cell.scores.operational.latencyMs : null;
                }),
              }))}
            />

            <GroupedBars
              title="Cost per trip"
              note="tokens × the configurable price table · MEASURED"
              seriesLabels={snap.models.map((m) => m.label)}
              seriesColors={snap.models.map((m) => modelColor(m.id))}
              format={(v) => fmtUsd(v)}
              data={snap.fixtures.map((f) => ({
                group: f.id.split("-")[0],
                values: snap.models.map((m) => {
                  const cell = snap.cells.find((c) => c.fixtureId === f.id && c.model === m.id);
                  return cell?.scores.operational.costUsd ?? null;
                }),
              }))}
            />

            <StackedBars
              title="Constraint violations by type"
              note="summed across all scored trips · DETERMINISTIC"
              segmentLabels={VIOLATION_TYPES.map((t) => t.replace(/_/g, " "))}
              data={aggregates.map((a) => ({
                group: modelLabel(a.model),
                segments: VIOLATION_TYPES.map((t) => a.violationsByType[t] ?? 0),
              }))}
            />

            <SimpleBars
              title="Context-contradiction rate (hallucination)"
              note="entries asserting a fact the context never gave · DETERMINISTIC"
              format={(v) => `${(v * 100).toFixed(1)}%`}
              data={aggregates.map((a) => ({
                label: modelLabel(a.model),
                value: a.meanContradictionRate,
                color: modelColor(a.model),
              }))}
            />
          </div>

          <p className="rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-600">
            <strong className="text-stone-800">Reading the grounding numbers.</strong> Stops outside
            the fetched candidate list are <em>not</em> counted as hallucinations here: skill §1b
            explicitly tells the model to choose stops from the traveler profile when anchors are
            sparse, so an unlisted stop is expected behaviour. Unlisted rate is reported as a
            descriptive statistic (
            {aggregates.map((a) => `${modelLabel(a.model)} ${fmtPct(a.meanUnlistedRate)}`).join(" · ")}
            ); the chart above counts only invented facts the context contradicts, which is what the
            skill&apos;s &ldquo;Missing Facts&rdquo; rule actually forbids.
          </p>

          {snap.agreement.length > 0 && (
            <section className="rounded-lg border border-stone-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-medium text-stone-900">
                Model agreement <Provenance kind="lexical" />
              </h2>
              <p className="mb-2 text-xs text-stone-500">
                Pairwise similarity between two models&apos; outputs on the same trip. {snap.semanticMethod}.
              </p>
              <div className="flex flex-wrap gap-2">
                {snap.agreement.map((a) => (
                  <span
                    key={`${a.fixtureId}-${a.modelA}-${a.modelB}`}
                    className="rounded border border-stone-200 px-2 py-1 text-xs text-stone-600"
                  >
                    {a.fixtureId.split("-")[0]}: {modelLabel(a.modelA)}↔{modelLabel(a.modelB)}{" "}
                    <strong className="text-stone-900">{a.cosine.toFixed(3)}</strong>
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* --- drill-down ----------------------------------------------------------------- */}
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-medium text-stone-900">Per-trip drill-down</h2>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {snap.fixtures.map((f) => {
            const runs = runCountByFixture.get(f.id) ?? 0;
            const active = selectedFixture === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setSelectedFixture(f.id)}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                  active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 text-stone-600"
                }`}
              >
                {!f.builtIn && (
                  <span className={active ? "text-stone-300" : "text-stone-400"}>custom</span>
                )}
                {f.title}
                <span
                  className={`rounded px-1 text-[10px] ${
                    runs === 0
                      ? active
                        ? "bg-stone-700 text-stone-300"
                        : "bg-stone-100 text-stone-400"
                      : runs >= snap.models.length
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {runs}/{snap.models.length}
                </span>
              </button>
            );
          })}
        </div>

        {callType === "refine" && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {refineTasksForFixture.length === 0 ? (
              <p className="text-xs text-stone-400">No refine tasks defined for this trip.</p>
            ) : (
              refineTasksForFixture.map((t) => {
                const active = selectedTask?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTaskId(t.id)}
                    title={t.covers}
                    className={`rounded border px-2 py-1 text-xs ${
                      active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 text-stone-600"
                    }`}
                  >
                    {t.id}
                  </button>
                );
              })
            )}
          </div>
        )}

        {(() => {
          const fixture = snap.fixtures.find((f) => f.id === selectedFixture);
          if (!fixture) return null;
          return (
            <div className="mb-3">
              <p className="text-xs text-stone-500">
                {fixture.destination ?? "unresolved destination"}
                {fixture.startDate ? ` · from ${fixture.startDate}` : ""} · {fixture.tripDays} days ·{" "}
                {fixture.group} · {fixture.explorerStyle} · {fixture.energy} energy · crowds{" "}
                {fixture.crowds} · ${fixture.budget} · {fixture.pace} pace (
                {fixture.paceSpotsPerDay}/day) · {fixture.anchors} anchors · starred:{" "}
                {fixture.starred.join(", ") || "none"}
              </p>
              <p className="text-xs text-stone-400">
                <em>{fixture.covers}</em>
                {!fixture.builtIn && (
                  <button
                    onClick={() => deleteTrip(fixture.id)}
                    disabled={busy !== null}
                    className="ml-2 underline disabled:opacity-40"
                  >
                    delete this trip
                  </button>
                )}
              </p>
              {fixture.notes.length > 0 && (
                <details className="mt-1 text-[11px] text-amber-800">
                  <summary className="cursor-pointer">
                    {fixture.notes.length} degraded/flagged source(s) in this trip&apos;s data
                  </summary>
                  <ul className="ml-4 list-disc">
                    {fixture.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })()}

        {callType === "generate" && missingModels.length > 0 && (
          <div className="mb-3 rounded border border-dashed border-stone-300 bg-stone-50 p-3">
            <p className="text-xs text-stone-600">
              {fixtureCells.length === 0
                ? "This trip hasn't been benched yet."
                : `${missingModels.length} of ${snap.models.length} models haven't planned this trip yet.`}{" "}
              Missing: {missingModels.map((m) => m.label).join(", ")}.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() =>
                  selectedFixture &&
                  void runCells(
                    missingModels.map((m) => ({ fixtureId: selectedFixture, model: m.id })),
                    `${missingModels.length} missing model(s)`
                  )
                }
                disabled={busy !== null}
                className="rounded-md bg-stone-900 px-3 py-1.5 text-xs text-white disabled:opacity-40"
              >
                Run {missingModels.length === snap.models.length ? "all" : "the missing"}{" "}
                {missingModels.length} model{missingModels.length === 1 ? "" : "s"} on this trip
              </button>
              {missingModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() =>
                    selectedFixture &&
                    void runCells([{ fixtureId: selectedFixture, model: m.id }], m.label)
                  }
                  disabled={busy !== null}
                  className="rounded-md border border-stone-300 px-2 py-1.5 text-xs disabled:opacity-40"
                >
                  Run {m.label} only
                </button>
              ))}
            </div>
          </div>
        )}

        {callType === "generate" && fixtureCells.length > 0 && (
          <>
            <div className="mb-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-stone-500">
                  <tr className="border-b border-stone-200">
                    <th className="py-1.5 pr-3">Model</th>
                    <th className="py-1.5 pr-3">Composite</th>
                    <th className="py-1.5 pr-3">Geo mean</th>
                    <th className="py-1.5 pr-3">Backtrack</th>
                    <th className="py-1.5 pr-3">Meal prox</th>
                    <th className="py-1.5 pr-3">Downtime</th>
                    <th className="py-1.5 pr-3">Weather</th>
                    <th className="py-1.5 pr-3">Budget*</th>
                    <th className="py-1.5 pr-3">Vibe</th>
                    <th className="py-1.5 pr-3">Violations</th>
                    <th className="py-1.5 pr-3">Overlaps</th>
                    <th className="py-1.5 pr-3">Over-budget days</th>
                    <th className="py-1.5 pr-3">Coverage</th>
                    <th className="py-1.5 pr-3">Contradictions</th>
                    <th className="py-1.5 pr-3">Format</th>
                    <th className="py-1.5 pr-3">Latency</th>
                    <th className="py-1.5 pr-3">Cost</th>
                    {usesJudge && <th className="py-1.5 pr-3 text-amber-800">Judge</th>}
                  </tr>
                </thead>
                <tbody>
                  {fixtureCells.map((c) => {
                    const s = c.scores;
                    return (
                      <tr key={c.model} className="border-b border-stone-100">
                        <td className="py-1.5 pr-3 font-medium text-stone-900">{modelLabel(c.model)}</td>
                        <td className="py-1.5 pr-3">{fmtNum(c.composite, 3)}</td>
                        <td className="py-1.5 pr-3">
                          {s.geoCoherence.tripMeanMinutes === null
                            ? "—"
                            : `${s.geoCoherence.tripMeanMinutes} min (${s.geoCoherence.matchedLegs}/${s.geoCoherence.totalLegs} legs)`}
                        </td>
                        <td className="py-1.5 pr-3">
                          {s.backtrack
                            ? `${fmtNum(s.backtrack.normalized)}${s.backtrack.scoredDays ? ` (${s.backtrack.scoredDays}d)` : ""}`
                            : "—"}
                        </td>
                        <td className="py-1.5 pr-3">
                          {s.mealProximity
                            ? `${fmtNum(s.mealProximity.normalized)} (${s.mealProximity.within}/${s.mealProximity.measured})`
                            : "—"}
                        </td>
                        <td className="py-1.5 pr-3">
                          {s.downtime ? `${s.downtime.passedDays}/${s.downtime.scoredDays}` : "—"}
                        </td>
                        <td className="py-1.5 pr-3">
                          {s.weather?.applicable ? fmtNum(s.weather.normalized) : "n/a"}
                        </td>
                        <td className="py-1.5 pr-3">
                          {s.budget ? `${fmtNum(s.budget.normalized)} (~$${s.budget.estimatedUsd})` : "—"}
                        </td>
                        <td className="py-1.5 pr-3">{s.vibe ? fmtNum(s.vibe.normalized) : "—"}</td>
                        <td className="py-1.5 pr-3">{s.constraints.total}</td>
                        <td className="py-1.5 pr-3">{s.feasibility.overlaps}</td>
                        <td className="py-1.5 pr-3">{s.feasibility.overBudgetDays}</td>
                        <td className="py-1.5 pr-3">
                          {s.coverage.starredCovered}/{s.coverage.starredTotal} starred,{" "}
                          {s.coverage.anchorsIncluded}/{s.coverage.anchorsTotal} anchors
                        </td>
                        <td className="py-1.5 pr-3">{s.grounding.contextContradictions}</td>
                        <td className="py-1.5 pr-3">
                          {s.format.pass ? "pass" : `${fmtPct(s.format.normalized)} — ${s.format.missingFields[0] ?? ""}`}
                        </td>
                        <td className="py-1.5 pr-3">{fmtMs(s.operational.latencyMs)}</td>
                        <td className="py-1.5 pr-3">
                          {s.operational.costUsd === null ? "—" : fmtUsd(s.operational.costUsd)}
                        </td>
                        {usesJudge && (
                          <td className="py-1.5 pr-3 text-amber-800">
                            {s.judge ? `${s.judge.overall.toFixed(1)} (${s.judge.blindLabel})` : "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {fixtureCells.some((c) => c.scores.constraints.details.length > 0) && (
              <details className="mb-4 text-xs">
                <summary className="cursor-pointer text-stone-600">
                  Every counted violation, with its reason
                </summary>
                <div className="mt-2 space-y-2">
                  {fixtureCells.map((c) => (
                    <div key={c.model}>
                      <p className="font-medium text-stone-800">{modelLabel(c.model)}</p>
                      <ul className="ml-4 list-disc text-stone-600">
                        {c.scores.constraints.details.map((d, i) => (
                          <li key={i}>
                            <code>{d.type}</code> · day {d.dayIndex + 1} — {d.detail}
                          </li>
                        ))}
                        {c.scores.grounding.examples.map((e, i) => (
                          <li key={`g${i}`}>
                            <code>grounding</code> — {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <Callouts cells={fixtureCells} label={modelLabel} />

            <OutputColumns cells={fixtureCells} label={modelLabel} color={modelColor} />
          </>
        )}

        {callType === "refine" && selectedFixture && selectedTask && (
          <RefineDrillDown
            models={snap.models}
            fixtureId={selectedFixture}
            task={selectedTask}
            cells={taskCells}
            busy={busy}
            label={modelLabel}
            onRunOne={(model) =>
              void runCells(
                [{ fixtureId: selectedFixture, model, taskId: selectedTask.id }],
                `${modelLabel(model)} · ${selectedTask.id}`
              )
            }
          />
        )}
      </section>
    </div>
  );
}

/**
 * Explicit, human-readable callouts for the failures worth acting on: a day that crisscrosses the
 * city, an outdoor stop left on a wet day, a plan that blows the budget, a meal that's a detour,
 * and a day with no slack. Everything here restates a stored number — nothing is recomputed in the
 * UI, so a callout can never disagree with the table above it.
 */
function Callouts({ cells, label }: { cells: BenchCellWithJson[]; label: (id: string) => string }) {
  const SEVERE_BACKTRACK = 0.7;

  const rows = cells.map((cell) => {
    const s = cell.scores;
    const items: { kind: string; text: string }[] = [];

    const worst = s.backtrack?.worstDay;
    if (worst && worst.ratio < SEVERE_BACKTRACK) {
      items.push({
        kind: "backtrack",
        text: `Day ${worst.dayIndex + 1} crisscrosses — ${worst.actualKm} km walked where ${worst.optimalKm} km would cover the same stops (ratio ${worst.ratio.toFixed(2)}).`,
      });
    }
    for (const v of s.weather?.violations ?? []) {
      items.push({
        kind: "weather",
        text: `Day ${v.dayIndex + 1}: outdoor stop "${v.name}" scheduled despite ${v.reason}${v.noted ? " (the day's Note does flag the weather)" : " — and the day's Note doesn't mention it"}.`,
      });
    }
    if (s.budget && !s.budget.withinBudget) {
      items.push({
        kind: "budget",
        text: `Estimated spend ~$${s.budget.estimatedUsd} against a $${s.budget.budgetUsd} budget — ${Math.round((s.budget.estimatedUsd / s.budget.budgetUsd - 1) * 100)}% over (estimate; excludes ${s.budget.excludes.join(" and ")}).`,
      });
    }
    for (const d of s.mealProximity?.detours ?? []) {
      items.push({
        kind: "meal",
        text: `Day ${d.dayIndex + 1}: "${d.name}" is ${d.minutes} min from the previous stop, past the ${s.mealProximity.capMinutes} min cap (${d.source}).`,
      });
    }
    for (const d of s.downtime?.tightDays ?? []) {
      items.push({
        kind: "downtime",
        text: `Day ${d.dayIndex + 1} has ${d.unallocatedMin} min unallocated across a ${Math.round(d.activeSpanMin / 60)}h day — under the ${s.downtime.minimumMinutes} min floor.`,
      });
    }
    for (const o of s.vibe?.offBrief.slice(0, 3) ?? []) {
      items.push({
        kind: "vibe",
        text: `Day ${o.dayIndex + 1}: "${o.name}" (${o.tags.join(", ")}) matches none of the traveler's tags.`,
      });
    }
    return { cell, items };
  });

  if (rows.every((r) => r.items.length === 0)) {
    return (
      <p className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
        No severe backtracking, weather mismatch, budget overrun, meal detour or zero-slack day in
        any model&apos;s plan for this trip.
      </p>
    );
  }

  const STYLE: Record<string, string> = {
    backtrack: "bg-orange-100 text-orange-900",
    weather: "bg-blue-100 text-blue-900",
    budget: "bg-red-100 text-red-900",
    meal: "bg-amber-100 text-amber-900",
    downtime: "bg-stone-200 text-stone-700",
    vibe: "bg-violet-100 text-violet-900",
  };

  return (
    <div className="mb-4 space-y-2">
      <h3 className="text-xs font-medium text-stone-900">Violation callouts</h3>
      {rows.map(({ cell, items }) => (
        <div key={cell.model} className="rounded border border-stone-200 p-2">
          <p className="text-xs font-medium text-stone-800">{label(cell.model)}</p>
          {items.length === 0 ? (
            <p className="text-[11px] text-emerald-700">Clean on all five added checks.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {items.map((item, i) => (
                <li key={i} className="text-[11px] text-stone-700">
                  <span className={`mr-1.5 rounded px-1 text-[10px] ${STYLE[item.kind]}`}>
                    {item.kind}
                  </span>
                  {item.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Side-by-side output, one column per model, each offering Readable / JSON / Diff.
 *
 * The leftmost model is the baseline (the app's production model, first in the configured order)
 * and every other column diffs against it — "what changes if I switch" is the actual question,
 * where an all-pairs diff would just be noise.
 */
function OutputColumns({
  cells,
  label,
  color,
}: {
  cells: BenchCellWithJson[];
  label: (id: string) => string;
  color: (id: string) => string;
}) {
  const baseline = cells[0];
  if (!baseline) return null;

  return (
    <div>
      <p className="mb-2 text-xs text-stone-500">
        Every model&apos;s plan for this trip. <strong className="text-stone-700">Readable</strong>{" "}
        renders the structured plan the way the app would; <strong className="text-stone-700">JSON</strong>{" "}
        is the machine-readable payload; <strong className="text-stone-700">Diff</strong> highlights
        what differs from {label(baseline.model)} (the baseline). Red text in the readable view marks
        a field the model omitted.
      </p>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
      >
        {cells.map((cell, i) => (
          <div key={cell.model} className="min-w-0">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-stone-900">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: color(cell.model) }}
              />
              {label(cell.model)}
              {i === 0 && <span className="font-normal text-stone-400">baseline</span>}
            </p>
            <ItineraryOutput
              json={cell.json}
              markdown={cell.itineraryMd}
              baselineMarkdown={baseline.itineraryMd}
              isBaseline={i === 0}
              failed={cell.scores.operational.failed}
              errorMessage={cell.scores.operational.errorMessage}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// --- refine mode --------------------------------------------------------------------------------

/**
 * Composite-group delta: `after - before` per weighted group, so NEGATIVE MEANS THE PATCH MADE THE
 * TRIP WORSE. This is the opposite of `PerfDashboard`'s convention elsewhere in this codebase
 * (lower latency is good, so it greens negatives) — carrying that habit here would invert what the
 * benchmark says, so colour and label are made explicit at every use.
 */
function fmtGroupDelta(v: number | null): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(3)}`;
}
function groupDeltaClass(v: number | null): string {
  if (v === null) return "text-stone-400";
  if (v < 0) return "text-red-700 font-semibold";
  if (v > 0) return "text-emerald-700 font-semibold";
  return "text-stone-600";
}

/**
 * Guardrail-violation delta: `after - before` violation count, so negative is the IMPROVEMENT here
 * — the opposite sign convention from the composite-group deltas rendered right beside it.
 */
function fmtGuardrailDelta(v: number): string {
  return `${v > 0 ? "+" : ""}${v}`;
}
function guardrailDeltaClass(v: number): string {
  if (v < 0) return "text-emerald-700 font-semibold";
  if (v > 0) return "text-red-700 font-semibold";
  return "text-stone-600";
}

/**
 * The refine sweep's per-task table: every model's patch against the fixture's frozen
 * `baseItinerary`, scored as a delta rather than an absolute (`RefineCellScores` in
 * src/lib/bench/types.ts). Cells only ever arrive through direct POST responses — there is no
 * persisted snapshot of refine results the way generation cells have one — so an empty `cells`
 * array means nothing has been run this session, not that nothing exists.
 */
function RefineDrillDown({
  models,
  fixtureId,
  task,
  cells,
  busy,
  label,
  onRunOne,
}: {
  models: BenchModel[];
  fixtureId: string;
  task: RefineTaskSummary;
  cells: RefineCell[];
  busy: string | null;
  label: (id: string) => string;
  onRunOne: (model: string) => void;
}) {
  return (
    <div>
      <div className="mb-3 rounded border border-stone-200 bg-stone-50 p-2 text-xs text-stone-600">
        <p>
          <span className="font-medium text-stone-800">Traveler says:</span> &ldquo;{task.message}
          &rdquo;{task.dayIndex !== undefined && ` (day ${task.dayIndex + 1} focused)`}
        </p>
        <p className="mt-1">
          {task.covers} · expects{" "}
          <strong>{task.expect.opsExpected ? "an edit" : "an answer, no edit"}</strong>
          {task.expect.allowedDays &&
            ` · allowed days: ${task.expect.allowedDays.map((d) => d + 1).join(", ")}`}
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {models.map((m) => (
          <button
            key={m.id}
            onClick={() => onRunOne(m.id)}
            disabled={busy !== null}
            className="rounded-md border border-stone-300 px-2 py-1.5 text-xs disabled:opacity-40"
          >
            Run {m.label} on this task
          </button>
        ))}
      </div>

      {cells.length === 0 ? (
        <p className="rounded border border-dashed border-stone-300 p-4 text-center text-xs text-stone-500">
          No refine results yet for {fixtureId} · {task.id}. Run a model above.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-stone-500">
            <strong className="text-stone-700">Δ vs base (negative = worse).</strong> Each delta
            below is <code>after − before</code> for that weighted group — the opposite sign
            convention from <code>PerfDashboard</code>&apos;s latency colouring elsewhere in this
            app, where lower is good. <strong className="text-stone-700">Measured</strong> counts
            how many of the five groups were non-null: <code>refineComposite</code> is deliberately
            ungated, so a composite built from one group looks identical to one built from five
            unless this column is read alongside it.
          </p>
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-stone-500">
                <tr className="border-b border-stone-200">
                  <th className="py-1.5 pr-3">Model</th>
                  <th className="py-1.5 pr-3">Composite</th>
                  <th
                    className="py-1.5 pr-3"
                    title="How many of the five delta groups were measurable — refineComposite has no minimum, so this is what makes cells comparable"
                  >
                    Measured
                  </th>
                  {RADAR_AXES.map((a) => (
                    <th key={a.key} className="py-1.5 pr-3" title="Δ vs base (negative = worse)">
                      Δ {a.label}
                    </th>
                  ))}
                  <th className="py-1.5 pr-3">Ops emit/rej</th>
                  <th className="py-1.5 pr-3" title="Did emitting-or-not match what the task asked for">
                    Restraint
                  </th>
                  <th
                    className="py-1.5 pr-3"
                    title="Guardrail violations after − before; negative is the improvement here (opposite sign from the Δ columns)"
                  >
                    Guardrail Δ
                  </th>
                  <th className="py-1.5 pr-3">Latency</th>
                  <th className="py-1.5 pr-3">Cost</th>
                </tr>
              </thead>
              <tbody>
                {cells.map((c) => (
                  <tr key={c.model} className="border-b border-stone-100">
                    <td className="py-1.5 pr-3 font-medium text-stone-900">{label(c.model)}</td>
                    <td className="py-1.5 pr-3 font-medium">{fmtNum(c.composite, 3)}</td>
                    <td className="py-1.5 pr-3">{c.scores.measuredGroups}/5</td>
                    {RADAR_AXES.map((a) => (
                      <td
                        key={a.key}
                        className={`py-1.5 pr-3 ${groupDeltaClass(c.scores.delta[a.key])}`}
                      >
                        {fmtGroupDelta(c.scores.delta[a.key])}
                      </td>
                    ))}
                    <td className="py-1.5 pr-3">
                      {c.scores.patch.opsEmitted}/{c.scores.patch.opsRejected}
                    </td>
                    <td
                      className={`py-1.5 pr-3 font-medium ${
                        c.scores.patch.restraint ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {c.scores.patch.restraint ? "yes" : "no"}
                    </td>
                    <td className={`py-1.5 pr-3 ${guardrailDeltaClass(c.scores.patch.guardrailDelta)}`}>
                      {fmtGuardrailDelta(c.scores.patch.guardrailDelta)}
                    </td>
                    <td className="py-1.5 pr-3">{fmtMs(c.scores.operational.latencyMs)}</td>
                    <td className="py-1.5 pr-3">
                      {c.scores.operational.costUsd === null ? "—" : fmtUsd(c.scores.operational.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-stone-600">Patch detail per model</summary>
            <div className="mt-2 space-y-3">
              {cells.map((c) => (
                <div key={c.model} className="rounded border border-stone-200 p-2">
                  <p className="font-medium text-stone-800">{label(c.model)}</p>
                  <p className="mt-1 text-stone-600">
                    opsEmitted {c.scores.patch.opsEmitted} · opsRejected {c.scores.patch.opsRejected}{" "}
                    · applied {fmtPct(c.scores.patch.applied)} · scope {fmtPct(c.scores.patch.scope)} ·
                    restraint {c.scores.patch.restraint ? "yes" : "no"} · guardrails{" "}
                    {c.scores.patch.guardrailsBefore} → {c.scores.patch.guardrailsAfter} (
                    <span className={guardrailDeltaClass(c.scores.patch.guardrailDelta)}>
                      {fmtGuardrailDelta(c.scores.patch.guardrailDelta)}
                    </span>
                    )
                  </p>
                  {c.scores.patch.rejectedReasons.length > 0 && (
                    <ul className="ml-4 mt-1 list-disc text-red-700">
                      {c.scores.patch.rejectedReasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {c.scores.operational.failed ? (
                    <p className="mt-1 text-red-700">{c.scores.operational.errorMessage}</p>
                  ) : (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-stone-500">Raw model response</summary>
                      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-stone-50 p-2 text-stone-700">
                        {c.rawResponse}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
