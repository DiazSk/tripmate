"use client";

import { useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { INTEREST_TAGS } from "@/components/InterestPicker";
import HumanOutput from "@/components/backend/HumanOutput";
import FlowDiagram, { NodeStatus } from "@/components/backend/FlowDiagram";
import { FLOWS, Kind } from "@/lib/pipelineFlows";
import { RunDetail, RunStep } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";

const KIND_TABS: { id: Kind; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "refine", label: "Refine" },
  { id: "rebalance", label: "Rebalance" },
  { id: "place-detail", label: "Place Detail" },
];

function StepPanel({ step }: { step: RunStep }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
        <span>{step.model}</span>
        <span>·</span>
        <span>{step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)}s` : "—"}</span>
        <span>·</span>
        <span>In: {step.usage.inputTokens ?? "—"} tok</span>
        <span>Out: {step.usage.outputTokens ?? "—"} tok</span>
        <span>Cost: {step.usage.costUsd != null ? `$${step.usage.costUsd.toFixed(4)}` : "—"}</span>
      </div>
      {step.errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {step.errorMessage}
        </div>
      )}

      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-stone-700">Output</h4>
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <HumanOutput rawResponse={step.rawResponse} />
        </div>
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-medium text-stone-500 hover:text-stone-800">
          Prompt sent + raw CLI response
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div>
            <h4 className="mb-1.5 text-xs font-semibold text-stone-700">Prompt sent</h4>
            <pre className="max-h-72 overflow-auto rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs whitespace-pre-wrap text-stone-800">
              {step.prompt}
            </pre>
          </div>
          <div>
            <h4 className="mb-1.5 text-xs font-semibold text-stone-700">Raw response</h4>
            <pre className="max-h-72 overflow-auto rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs whitespace-pre-wrap text-stone-800">
              {step.rawResponse ?? "(no response captured)"}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}

const fieldClass =
  "w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-800 placeholder:text-stone-400 focus:border-blue-300 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-xs font-medium text-stone-500";

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * The LLM agent architecture, drawn as a clean system-design flow diagram (boxes + arrows, one
 * per real step) rather than prose — and it's also the console that invokes it. Idle, every node
 * just states its input/output shape. Hit Run and every node for that flow lights up "running"
 * together (the four routes here are single synchronous requests server-side, so there's no
 * signal for genuine sub-step progress without adding SSE — see the comment on `run()` below);
 * once the response lands, each node settles to its own real status and — click it — its real
 * prompt and response for that exact invocation.
 */
export default function PipelineConsole() {
  const [kind, setKind] = useState<Kind>("generate");
  const [invoking, setInvoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [lastItineraryJson, setLastItineraryJson] = useState("");

  const [destination, setDestination] = useState("Kyoto, Japan");
  const [startDate, setStartDate] = useState(todayISO(30));
  const [endDate, setEndDate] = useState(todayISO(33));
  const [budget, setBudget] = useState("1500");
  const [tier, setTier] = useState<"budget" | "midrange" | "luxury">("midrange");
  const [interests, setInterests] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("Make day 2 cheaper and add more local food.");
  const [previousItineraryJson, setPreviousItineraryJson] = useState("");
  const [remainingBudget, setRemainingBudget] = useState("300");
  const [remainingDaysJson, setRemainingDaysJson] = useState("");
  const [placeName, setPlaceName] = useState("Fushimi Inari Taisha");
  const [placeLat, setPlaceLat] = useState("34.9671");
  const [placeLng, setPlaceLng] = useState("135.7727");

  const flow = FLOWS.find((f) => f.kind === kind)!;

  const statusById = useMemo(() => {
    const map: Record<string, NodeStatus> = {};
    for (const node of flow.nodes) {
      if (invoking) {
        map[node.id] = "running";
        continue;
      }
      if (!runDetail) {
        map[node.id] = "idle";
        continue;
      }
      if (!node.traceType) {
        // External (geocode/weather): no trace row either way, so "ran, not individually
        // verified" is the honest label rather than claiming ok/error we can't back up.
        map[node.id] = "skipped";
        continue;
      }
      const step = runDetail.steps.find((s) => s.type === node.traceType);
      // No matching step = this optional node didn't fire this time (e.g. a context cache hit
      // skips the call entirely — no trace row gets written), not a failure.
      map[node.id] = step ? (step.status === "ok" ? "ok" : "error") : "skipped";
    }
    return map;
  }, [flow, invoking, runDetail]);

  function toggleInterest(tag: string) {
    setInterests((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function switchKind(next: Kind) {
    setKind(next);
    setError(null);
    setRunDetail(null);
    setSelectedNodeId(null);
  }

  async function run() {
    setInvoking(true);
    setError(null);
    setRunDetail(null);
    setSelectedNodeId(null);
    try {
      let res: Response;
      if (kind === "generate" || kind === "refine") {
        const body: Record<string, unknown> = { destination, startDate, endDate, budget: Number(budget) };
        if (kind === "generate") {
          body.tier = tier;
          body.preferences = { tags: interests, vibe: null };
        } else {
          body.previousItinerary = JSON.parse(previousItineraryJson || "{}");
          body.feedback = feedback;
        }
        res = await fetch("/api/itinerary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else if (kind === "rebalance") {
        res = await fetch("/api/itinerary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rebalance: true,
            destination,
            tier,
            remainingDays: JSON.parse(remainingDaysJson || "[]"),
            remainingBudget: Number(remainingBudget),
          }),
        });
      } else {
        res = await fetch("/api/place-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: placeName, destination, lat: Number(placeLat), lng: Number(placeLng) }),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      if (data.itinerary) setLastItineraryJson(JSON.stringify(data.itinerary, null, 2));

      // A second round-trip, not part of the invocation itself: the itinerary/place-detail
      // routes only ever return `runId`, not the per-step trace rows they just wrote — fetching
      // the run is what turns that id into the real per-node status/prompt/response this diagram
      // shows. Real per-*sub-step* progress while the first request is still in flight would need
      // the route itself to stream (SSE) rather than respond once at the end; that's a bigger
      // change than this console makes, hence the "everything lights up together" running state.
      if (data.runId) {
        const runRes = await fetch(`/api/llm-traces/runs/${data.runId}`);
        const runData = await runRes.json();
        if (runRes.ok) setRunDetail(runData);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setInvoking(false);
    }
  }

  const selectedNode = flow.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedStep =
    selectedNode?.traceType && runDetail
      ? runDetail.steps.find((s) => s.type === selectedNode.traceType)
      : undefined;

  return (
    <section className="space-y-3" {...devLabel("PipelineConsole")}>
      <div>
        <h2 className="text-base font-semibold text-stone-900">LLM agent architecture</h2>
        <p className="mt-1 text-sm text-stone-500">
          Every LLM node runs the same way — a one-shot, tool-less prompt shelled out to the
          Claude CLI itself (Haiku 4.5) — logged to <code className="rounded bg-stone-900/5 px-1.5 py-0.5 text-xs">llm_traces</code>.
          Pick a flow, invoke it, and watch its real input/output land on the diagram.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {KIND_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => switchKind(t.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              kind === t.id ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <code className="text-[11px] text-stone-400">{flow.route}</code>
          <span className="text-[11px] text-stone-400">Typically {flow.typicalDuration}</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">{flow.summary}</p>
        <div className="mt-3">
          <FlowDiagram nodes={flow.nodes} name={flow.kind} statusById={statusById} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
        </div>

        {selectedNode && (
          <div className="mt-4 border-t border-stone-100 pt-4">
            <div className="mb-2 font-medium text-stone-900">{selectedNode.label}</div>
            {selectedStep ? (
              <StepPanel step={selectedStep} />
            ) : (
              <p className="text-xs text-stone-400">
                {invoking
                  ? "Running…"
                  : !runDetail
                    ? "Invoke this pipeline to see its real input/output here."
                    : !selectedNode.traceType
                      ? "Ran as part of this request, but it's a plain API call, not a Claude call — no prompt/response gets logged for it."
                      : "Didn't fire on this run (e.g. a cache hit skipped the call)."}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(kind === "generate" || kind === "refine" || kind === "rebalance") && (
            <label className={labelClass}>
              Destination
              <input className={fieldClass} value={destination} onChange={(e) => setDestination(e.target.value)} />
            </label>
          )}

          {(kind === "generate" || kind === "refine") && (
            <>
              <label className={labelClass}>
                Start date
                <input type="date" className={fieldClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className={labelClass}>
                End date
                <input type="date" className={fieldClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
              <label className={labelClass}>
                Budget (USD)
                <input type="number" min={1} className={fieldClass} value={budget} onChange={(e) => setBudget(e.target.value)} />
              </label>
            </>
          )}

          {(kind === "generate" || kind === "rebalance") && (
            <label className={labelClass}>
              Tier
              <select className={fieldClass} value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
                <option value="budget">Budget</option>
                <option value="midrange">Mid-range</option>
                <option value="luxury">Luxury</option>
              </select>
            </label>
          )}

          {kind === "generate" && (
            <div className="sm:col-span-2">
              <div className="text-xs font-medium text-stone-500">Interests (optional)</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {INTEREST_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleInterest(tag)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      interests.includes(tag)
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind === "refine" && (
            <>
              <label className="sm:col-span-2">
                <div className={labelClass}>
                  Feedback
                  <textarea className={fieldClass} rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                </div>
              </label>
              <label className="sm:col-span-2">
                <div className={labelClass}>
                  <span className="flex items-center justify-between">
                    Previous itinerary (JSON)
                    {lastItineraryJson && (
                      <button
                        type="button"
                        onClick={() => setPreviousItineraryJson(lastItineraryJson)}
                        className="text-blue-600 hover:underline"
                      >
                        Use last result
                      </button>
                    )}
                  </span>
                  <textarea
                    className={`${fieldClass} font-mono text-xs`}
                    rows={5}
                    value={previousItineraryJson}
                    onChange={(e) => setPreviousItineraryJson(e.target.value)}
                    placeholder='{"tier":"midrange","days":[...]}'
                  />
                </div>
              </label>
            </>
          )}

          {kind === "rebalance" && (
            <>
              <label className={labelClass}>
                Remaining budget (USD)
                <input
                  type="number"
                  min={0}
                  className={fieldClass}
                  value={remainingBudget}
                  onChange={(e) => setRemainingBudget(e.target.value)}
                />
              </label>
              <label className="sm:col-span-2">
                <div className={labelClass}>
                  <span className="flex items-center justify-between">
                    Remaining days (JSON array)
                    {lastItineraryJson && (
                      <button
                        type="button"
                        onClick={() =>
                          setRemainingDaysJson(JSON.stringify(JSON.parse(lastItineraryJson).days ?? [], null, 2))
                        }
                        className="text-blue-600 hover:underline"
                      >
                        Use last result&apos;s days
                      </button>
                    )}
                  </span>
                  <textarea
                    className={`${fieldClass} font-mono text-xs`}
                    rows={5}
                    value={remainingDaysJson}
                    onChange={(e) => setRemainingDaysJson(e.target.value)}
                    placeholder='[{"date":"2026-09-02","stops":[...]}]'
                  />
                </div>
              </label>
            </>
          )}

          {kind === "place-detail" && (
            <>
              <label className={labelClass}>
                Place name
                <input className={fieldClass} value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
              </label>
              <label className={labelClass}>
                Destination
                <input className={fieldClass} value={destination} onChange={(e) => setDestination(e.target.value)} />
              </label>
              <label className={labelClass}>
                Latitude
                <input type="number" step="any" className={fieldClass} value={placeLat} onChange={(e) => setPlaceLat(e.target.value)} />
              </label>
              <label className={labelClass}>
                Longitude
                <input type="number" step="any" className={fieldClass} value={placeLng} onChange={(e) => setPlaceLng(e.target.value)} />
              </label>
            </>
          )}
        </div>

        <button
          onClick={run}
          disabled={invoking}
          className="mt-4 flex items-center gap-2 rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50"
        >
          {invoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {invoking ? "Running…" : "Run"}
        </button>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
      </div>
    </section>
  );
}
