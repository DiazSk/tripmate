"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { INTEREST_TAGS } from "@/components/InterestPicker";
import HumanOutput from "@/components/backend/HumanOutput";
import FlowDiagram, { NodeStatus } from "@/components/backend/FlowDiagram";
import { STAGED_NODES, StagedStepId } from "@/lib/stagedFlow";
import { CandidatePoi } from "@/lib/pois";
import { CrowdPreference, EnergyLevel, ExplorerStyle, GroupType, ReconcileNote, ResolvedFlags, RunDetail } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";

const fieldClass =
  "w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-800 focus:border-blue-300 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-xs font-medium text-stone-500";

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function Raw({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-stone-500 hover:text-stone-800">
        {label}
      </summary>
      <pre className="mt-1.5 max-h-96 overflow-auto rounded border border-stone-200 bg-stone-50 p-2.5 text-[11px] whitespace-pre-wrap text-stone-800">
        {text}
      </pre>
    </details>
  );
}

/**
 * Full-fidelity harness for the staged pipeline: runs every real route end to end, draws the live
 * pathway, times each step, and surfaces the raw payload for every stage plus the complete LLM
 * trace (prompt, raw response, tokens, cost) for the one generation call.
 *
 * No pipeline logic is duplicated and no observability hooks were added — the steps are already
 * separate routes, so awaiting them in order is what produces the live status. Steps 3+4 share one
 * route, as do 5+6, so each pair settles together; their payloads are still shown separately.
 */
export default function StagedPipelineConsole() {
  const [destination, setDestination] = useState("Kyoto, Japan");
  const [startDate, setStartDate] = useState(todayISO(30));
  const [endDate, setEndDate] = useState(todayISO(33));
  const [budget, setBudget] = useState("2000");

  const [purpose, setPurpose] = useState("");
  const [explorerStyle, setExplorerStyle] = useState<ExplorerStyle>("mixed");
  const [group, setGroup] = useState<GroupType>("couple");
  const [energy, setEnergy] = useState<EnergyLevel>("moderate");
  const [crowds, setCrowds] = useState<CrowdPreference>("mixed");
  const [priorities, setPriorities] = useState<string[]>([]);
  const [topPriorities, setTopPriorities] = useState<string[]>([]);
  const [selectedPois, setSelectedPois] = useState<CandidatePoi[]>([]);
  const [customPoi, setCustomPoi] = useState("");
  const [customPois, setCustomPois] = useState<string[]>([]);

  const [status, setStatus] = useState<Record<string, NodeStatus>>({});
  const [duration, setDuration] = useState<Record<string, number>>({});
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [phase, setPhase] = useState<"input" | "qa" | "running" | "done">("input");
  const [totalMs, setTotalMs] = useState<number | null>(null);

  const set = (id: StagedStepId, s: NodeStatus) => setStatus((p) => ({ ...p, [id]: s }));
  const time = (id: StagedStepId, ms: number) => setDuration((p) => ({ ...p, [id]: ms }));
  const fail = (id: StagedStepId, msg: string) => {
    set(id, "error");
    setErrors((p) => ({ ...p, [id]: msg }));
  };

  const rawFetch = payload.rawFetch as
    | { candidatePois: { available: boolean; pois: CandidatePoi[] } }
    | undefined;

  async function start() {
    setErrors({});
    setPayload({});
    setDuration({});
    setRunDetail(null);
    setTotalMs(null);
    setStatus({});
    set("submit", "running");

    const s = Date.now();
    try {
      const res = await fetch("/api/trip-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, startDate, endDate }),
      });
      const data = await res.json();
      time("submit", Date.now() - s);
      if (!res.ok) {
        fail("submit", `${data.error}${data.field ? ` (field: ${data.field})` : ""}`);
        return;
      }
      setPayload((p) => ({ ...p, submit: data }));
      set("submit", data.destinationResolved ? "ok" : "degraded");

      // 2a fired WITHOUT await so it overlaps 2b — the same shape the real page.tsx uses.
      set("fetch", "running");
      set("qa", "running");
      setPhase("qa");

      const fs = Date.now();
      fetch("/api/trip-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, startDate, endDate }),
      })
        .then((r) => r.json())
        .then((d) => {
          time("fetch", Date.now() - fs);
          if (!d.rawFetch) return fail("fetch", d.error ?? "no rawFetch returned");
          setPayload((p) => ({ ...p, rawFetch: d.rawFetch }));
          const rf = d.rawFetch;
          const degraded = [rf.weather, rf.holidays, rf.transportModes, rf.candidatePois].some(
            (f: { available: boolean }) => !f.available
          );
          set("fetch", degraded ? "degraded" : "ok");
        })
        .catch((e) => fail("fetch", e instanceof Error ? e.message : "fetch failed"));
    } catch (e) {
      time("submit", Date.now() - s);
      fail("submit", e instanceof Error ? e.message : "request failed");
      return;
    }
  }

  async function continueRun() {
    if (!rawFetch) return;
    setPhase("running");
    set("qa", "ok");
    const t0 = Date.now();

    const userAnswers = {
      purpose,
      explorerStyle,
      group,
      energy,
      crowds,
      budget: Number(budget),
      priorities,
      topPriorities,
      selectedPois,
      customPois,
    };
    setPayload((p) => ({ ...p, userAnswers }));

    set("reconcile", "running");
    set("poi", "running");
    let prepared: { reconciled?: unknown; poiDetails?: unknown; error?: string };
    let s = Date.now();
    try {
      const res = await fetch("/api/trip-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawFetch: payload.rawFetch, userAnswers }),
      });
      prepared = await res.json();
      const took = Date.now() - s;
      time("reconcile", took);
      time("poi", took);
      if (!res.ok) {
        fail("reconcile", prepared.error ?? "reconcile failed");
        set("poi", "skipped");
        setPhase("qa");
        return;
      }
    } catch (e) {
      time("reconcile", Date.now() - s);
      fail("reconcile", e instanceof Error ? e.message : "request failed");
      set("poi", "skipped");
      setPhase("qa");
      return;
    }

    const reconciled = prepared.reconciled as { notes: ReconcileNote[] };
    const poiDetails = prepared.poiDetails as { notes: ReconcileNote[] };
    setPayload((p) => ({ ...p, reconciled, poiDetails }));
    set("reconcile", reconciled.notes.length > 0 ? "degraded" : "ok");
    set("poi", poiDetails.notes.length > 0 ? "degraded" : "ok");

    set("trip-context", "running");
    set("generation", "running");
    s = Date.now();
    try {
      const res = await fetch("/api/trip-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reconciled, poiDetails }),
      });
      const data = await res.json();
      const took = Date.now() - s;
      if (!res.ok) {
        time("generation", took);
        fail("generation", data.error ?? "generation failed");
        set("trip-context", "skipped");
        setPhase("qa");
        return;
      }
      setPayload((p) => ({
        ...p,
        tripContextMd: data.tripContextMd,
        itineraryMd: data.itineraryMd,
        runId: data.runId,
      }));
      set("trip-context", "ok");
      set("generation", "ok");
      time("generation", took);

      // Second round-trip, same pattern PipelineConsole uses: the route returns only `runId`, so
      // fetching the run turns that into the real prompt/response/tokens/cost for this exact call.
      if (data.runId) {
        const rd = await fetch(`/api/llm-traces/runs/${data.runId}`);
        const run = await rd.json();
        if (rd.ok) {
          setRunDetail(run);
          const genStep = (run as RunDetail).steps.find((st) => st.type === "generate");
          // Server-measured LLM duration is more honest than the round-trip we timed above.
          if (genStep?.durationMs) {
            time("generation", genStep.durationMs);
            time("trip-context", Math.max(took - genStep.durationMs, 0));
          }
        }
      }
      setTotalMs(Date.now() - t0);
      setPhase("done");
    } catch (e) {
      time("generation", Date.now() - s);
      fail("generation", e instanceof Error ? e.message : "request failed");
      setPhase("qa");
    }
  }

  const node = STAGED_NODES.find((n) => n.id === selectedNode) ?? null;
  const genStep = runDetail?.steps.find((st) => st.type === "generate");
  const nodePayload: Record<string, { label: string; value: unknown }[]> = {
    submit: [{ label: "validated params", value: payload.submit }],
    fetch: [{ label: "raw_fetch", value: payload.rawFetch }],
    qa: [{ label: "user_answers", value: payload.userAnswers }],
    reconcile: [
      {
        label: "resolved_flags (derived in code)",
        value: (payload.reconciled as { resolvedFlags?: ResolvedFlags })?.resolvedFlags,
      },
      { label: "reconciled state", value: payload.reconciled },
    ],
    poi: [{ label: "poi_details", value: payload.poiDetails }],
    "trip-context": [{ label: "trip-context.md", value: payload.tripContextMd }],
    generation: [{ label: "itinerary.md", value: payload.itineraryMd }],
  };
  const nodeNotes =
    node?.id === "reconcile"
      ? ((payload.reconciled as { notes?: ReconcileNote[] })?.notes ?? [])
      : node?.id === "poi"
        ? ((payload.poiDetails as { notes?: ReconcileNote[] })?.notes ?? [])
        : [];

  const busy = phase === "running";

  return (
    <div className="space-y-4" {...devLabel("StagedPipelineConsole")}>
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <code className="text-[11px] text-stone-400">
            trip-submit → trip-fetch ∥ Q&amp;A → trip-prepare → trip-generate
          </code>
          <span className="text-[11px] text-stone-400">
            {totalMs !== null ? `Last run: ${fmt(totalMs)} total` : "Typically ~2–4 min (the LLM call dominates)"}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          The real staged pipeline, end to end. Click any node for its raw payload; the generation
          node also carries the exact prompt, raw CLI response, token counts and cost.
        </p>
        <div className="mt-3">
          <FlowDiagram
            nodes={STAGED_NODES}
            name="staged"
            statusById={status}
            durationById={duration}
            selectedId={selectedNode}
            onSelect={setSelectedNode}
          />
        </div>

        {node && (
          <div className="mt-4 border-t border-stone-100 pt-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-medium text-stone-900">{node.label}</span>
              <code className="text-[11px] text-stone-400">{node.route}</code>
              {duration[node.id] !== undefined && (
                <span className="font-mono text-[11px] text-stone-500">{fmt(duration[node.id])}</span>
              )}
            </div>
            {errors[node.id] && (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                {errors[node.id]}
              </div>
            )}
            {nodeNotes.length > 0 && (
              <ul className="mt-2 space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                {nodeNotes.map((n) => (
                  <li key={`${n.field}-${n.status}`} className="text-[11px] text-amber-900">
                    <span className="font-mono font-semibold">{n.field}</span> [{n.status}] — {n.detail}
                  </li>
                ))}
              </ul>
            )}

            {node.id === "generation" && genStep && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                  <span>{genStep.model}</span>
                  <span>·</span>
                  <span>{genStep.durationMs != null ? fmt(genStep.durationMs) : "—"}</span>
                  <span>·</span>
                  <span>In: {genStep.usage.inputTokens ?? "—"} tok</span>
                  <span>Out: {genStep.usage.outputTokens ?? "—"} tok</span>
                  <span>
                    Cost: {genStep.usage.costUsd != null ? `$${genStep.usage.costUsd.toFixed(4)}` : "—"}
                  </span>
                </div>
                <div className="rounded-lg border border-stone-200 bg-white p-3">
                  <HumanOutput rawResponse={genStep.rawResponse} />
                </div>
                <Raw label="Prompt sent (skill + trip-context + ask)" value={genStep.prompt} />
                <Raw label="Raw CLI response" value={genStep.rawResponse} />
              </div>
            )}

            {nodePayload[node.id]?.map((p) => <Raw key={p.label} label={p.label} value={p.value} />)}
            {!nodePayload[node.id]?.some((p) => p.value) && !errors[node.id] && (
              <p className="mt-2 text-xs text-stone-400">
                {status[node.id] === "running" ? "Running…" : "Run the pipeline to see this node's real output."}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-stone-900">Step 1 — trip input</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className={`${labelClass} sm:col-span-2`}>
            Destination
            <input className={fieldClass} value={destination} onChange={(e) => setDestination(e.target.value)} />
          </label>
          <label className={labelClass}>
            Start date
            <input type="date" className={fieldClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className={labelClass}>
            End date
            <input type="date" className={fieldClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        <button
          onClick={start}
          disabled={phase !== "input" && phase !== "done"}
          className="mt-3 flex items-center gap-2 rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          Start run
        </button>
      </section>

      {phase !== "input" && (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">
            Step 2b — Q&amp;A{" "}
            <span className="font-normal text-stone-400">(2a is fetching in parallel)</span>
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className={`${labelClass} sm:col-span-2`}>
              Purpose
              <input className={fieldClass} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </label>
            <label className={labelClass}>
              Budget (USD)
              <input type="number" className={fieldClass} value={budget} onChange={(e) => setBudget(e.target.value)} />
            </label>
            <label className={labelClass}>
              Explorer style
              <select className={fieldClass} value={explorerStyle} onChange={(e) => setExplorerStyle(e.target.value as ExplorerStyle)}>
                <option value="packed">packed</option>
                <option value="relaxed">relaxed</option>
                <option value="offbeat">offbeat</option>
                <option value="mixed">mixed</option>
              </select>
            </label>
            <label className={labelClass}>
              Group
              <select className={fieldClass} value={group} onChange={(e) => setGroup(e.target.value as GroupType)}>
                <option value="solo">solo</option>
                <option value="couple">couple</option>
                <option value="family_with_kids">family_with_kids</option>
                <option value="other">other</option>
              </select>
            </label>
            <label className={labelClass}>
              Energy
              <select className={fieldClass} value={energy} onChange={(e) => setEnergy(e.target.value as EnergyLevel)}>
                <option value="high">high</option>
                <option value="moderate">moderate</option>
                <option value="low">low</option>
              </select>
            </label>
            <label className={labelClass}>
              Crowds
              <select className={fieldClass} value={crowds} onChange={(e) => setCrowds(e.target.value as CrowdPreference)}>
                <option value="seek">seek</option>
                <option value="mixed">mixed</option>
                <option value="avoid">avoid</option>
              </select>
            </label>
            <div className="text-xs text-stone-500 sm:col-span-4">
              pace and the other resolved flags are derived server-side at reconcile — see the
              Step 3 node after running.
            </div>
          </div>

          <div className="mt-3">
            <div className="text-xs font-medium text-stone-500">Priorities <span className="font-normal text-stone-400">(click once to select, again to star — max 3)</span></div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {INTEREST_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    if (!priorities.includes(tag)) return setPriorities((p) => [...p, tag]);
                    if (!topPriorities.includes(tag) && topPriorities.length < 3)
                      return setTopPriorities((p) => [...p, tag]);
                    setPriorities((p) => p.filter((t) => t !== tag));
                    setTopPriorities((p) => p.filter((t) => t !== tag));
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    priorities.includes(tag)
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  {topPriorities.includes(tag) ? `★ ${tag}` : tag}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <div className="text-xs font-medium text-stone-500">
              Optional anchors — candidate POIs from 2a{" "}
              {status.fetch === "running" && <span className="text-blue-600">— waiting on 2a…</span>}
            </div>
            {rawFetch && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {rawFetch.candidatePois.pois.map((poi) => (
                  <button
                    key={poi.name}
                    onClick={() =>
                      setSelectedPois((prev) =>
                        prev.some((p) => p.name === poi.name)
                          ? prev.filter((p) => p.name !== poi.name)
                          : [...prev, poi]
                      )
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      selectedPois.some((p) => p.name === poi.name)
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                    }`}
                  >
                    {poi.name}
                  </button>
                ))}
                {rawFetch.candidatePois.pois.length === 0 && (
                  <span className="text-xs text-amber-700">none returned — add your own below</span>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-end gap-2">
            <label className={labelClass}>
              Custom POI
              <input className={fieldClass} value={customPoi} onChange={(e) => setCustomPoi(e.target.value)} />
            </label>
            <button
              onClick={() => {
                if (!customPoi.trim()) return;
                setCustomPois((p) => [...p, customPoi.trim()]);
                setCustomPoi("");
              }}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50"
            >
              Add
            </button>
            <span className="text-xs text-stone-500">{customPois.join(", ")}</span>
          </div>

          <button
            onClick={continueRun}
            disabled={!rawFetch || busy}
            className="mt-4 flex items-center gap-2 rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {busy ? "Running 3 → 6…" : "Continue (run 3 → 6)"}
          </button>
        </section>
      )}
    </div>
  );
}
