"use client";

import { ComponentType } from "react";
import { ArrowDown, CloudSun, MapPin, Scale, Search, ShieldCheck, Sparkles } from "lucide-react";
import TraceStatusBadge from "@/components/TraceStatusBadge";
import { RunStep } from "@/lib/types";
import { STEP_LABELS, formatMs } from "@/lib/runLabels";

const STEP_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  context: Search,
  generate: Sparkles,
  refine: Sparkles,
  critique: ShieldCheck,
  rebalance: Scale,
  "place-detail": MapPin,
};

function Connector() {
  return <ArrowDown className="mx-auto my-1 h-4 w-4 shrink-0 text-stone-300" aria-hidden />;
}

/** A real, trace-backed step — clickable, same data the flat list used to show. */
function StepNode({ step, onSelect }: { step: RunStep; onSelect: () => void }) {
  const Icon = STEP_ICONS[step.type] ?? Sparkles;
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white p-2.5 text-left text-xs shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
        <span className="truncate font-medium text-stone-800">
          {STEP_LABELS[step.type] ?? step.type}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-stone-400">
        <span>{formatMs(step.durationMs)}</span>
        <TraceStatusBadge status={step.status} />
      </span>
    </button>
  );
}

/** An illustrative node with no trace data behind it (geocode/weather aren't LLM
 *  calls, so they never get an llm_traces row) — dashed and inert so it reads as
 *  "part of the real architecture" without implying there's a step to click into. */
function StaticNode({
  icon: Icon,
  label,
  note,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-dashed border-stone-300 bg-stone-50/60 p-2.5 text-xs text-stone-400">
      <span className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">{label}</span>
      </span>
      <span className="text-[10px] leading-tight">{note}</span>
    </div>
  );
}

/**
 * Renders whatever steps a run actually has as a connected flow rather than a flat
 * numbered list — a "generate" run's context step is skipped entirely on a
 * destination_context cache hit (no trace row at all), so this reads live off
 * `steps`/`kind` rather than assuming a fixed template per run kind.
 */
export default function RunPipelineDiagram({
  kind,
  steps,
  onSelectStep,
}: {
  kind: string;
  steps: RunStep[];
  onSelectStep: (step: RunStep) => void;
}) {
  const byType = (type: string) => steps.find((s) => s.type === type);
  const contextStep = byType("context");
  const primaryStep =
    kind === "refine" ? byType("refine") : kind === "rebalance" ? byType("rebalance") : byType("generate");
  const critiqueStep = byType("critique");
  const placeDetailSteps = steps.filter((s) => s.type === "place-detail");

  // Only the initial generate call actually overlaps context-fetching with
  // geocode/weather in real wall time (see api/itinerary/route.ts) — refine
  // awaits context immediately, so it never gets the parallel-branch treatment.
  const showParallelBranch = Boolean(contextStep) && kind === "generate";

  return (
    <div className="space-y-1">
      {contextStep && showParallelBranch && (
        <>
          <div className="rounded-xl border border-dashed border-stone-300 p-2">
            <div className="mb-1.5 text-center text-[10px] font-medium tracking-wide text-stone-400 uppercase">
              Fetched concurrently
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StepNode step={contextStep} onSelect={() => onSelectStep(contextStep)} />
              <StaticNode icon={CloudSun} label="Geocode + Weather" note="External API, not an LLM call" />
            </div>
          </div>
          <Connector />
        </>
      )}

      {contextStep && !showParallelBranch && (
        <>
          <StepNode step={contextStep} onSelect={() => onSelectStep(contextStep)} />
          <Connector />
        </>
      )}

      {primaryStep && <StepNode step={primaryStep} onSelect={() => onSelectStep(primaryStep)} />}

      {critiqueStep && (
        <>
          <Connector />
          <StepNode step={critiqueStep} onSelect={() => onSelectStep(critiqueStep)} />
        </>
      )}

      {placeDetailSteps.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[10px] font-medium tracking-wide text-stone-400 uppercase">
            Place detail lookups
          </div>
          {placeDetailSteps.map((step) => (
            <StepNode key={step.id} step={step} onSelect={() => onSelectStep(step)} />
          ))}
        </div>
      )}
    </div>
  );
}
