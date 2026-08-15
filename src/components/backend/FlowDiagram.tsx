"use client";

import { ComponentType } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CloudSun,
  FileText,
  ListChecks,
  MapPin,
  Merge,
  MessageSquare,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { FlowNodeSpec } from "@/lib/pipelineFlows";
import { devLabel } from "@/lib/devInspector";

/** Extracted from PipelineConsole so the staged-pipeline console renders the identical diagram
 *  instead of a second copy of it. Behaviour is unchanged from the original. */
export type NodeStatus = "idle" | "running" | "ok" | "degraded" | "error" | "skipped";

const NODE_ICON: Record<string, ComponentType<{ className?: string }>> = {
  // legacy flows
  geocode: CloudSun,
  context: Search,
  generate: Sparkles,
  refine: Sparkles,
  critique: ShieldCheck,
  rebalance: Scale,
  "place-detail": MapPin,
  // staged pipeline
  submit: CheckCircle2,
  fetch: CloudSun,
  qa: MessageSquare,
  reconcile: Merge,
  poi: ListChecks,
  "trip-context": FileText,
  generation: Sparkles,
};

// Status ring/background — deliberately distinct from the categorical hues used elsewhere: this
// is state, not identity. Blue "running" pulses since it's the only state without a fixed
// duration; the rest are static so the eye isn't drawn to a settled result.
const STATUS_STYLE: Record<NodeStatus, string> = {
  idle: "border-stone-200 bg-white",
  running: "border-blue-400 bg-blue-50 ring-2 ring-blue-200 animate-pulse",
  ok: "border-green-400 bg-green-50",
  degraded: "border-amber-400 bg-amber-50",
  error: "border-red-400 bg-red-50",
  skipped: "border-stone-300 bg-stone-50",
};

const STATUS_DOT: Record<NodeStatus, string> = {
  idle: "bg-stone-300",
  running: "bg-blue-500",
  ok: "bg-green-500",
  degraded: "bg-amber-500",
  error: "bg-red-500",
  skipped: "bg-stone-400",
};

export function NodeBox({
  node,
  status,
  selected,
  onSelect,
  durationMs,
}: {
  node: FlowNodeSpec;
  status: NodeStatus;
  selected: boolean;
  onSelect: () => void;
  /** Wall-clock time this node took on the last run, when the caller measured it. */
  durationMs?: number;
}) {
  const Icon = NODE_ICON[node.id] ?? Sparkles;
  return (
    <button
      onClick={onSelect}
      className={`flex w-64 shrink-0 flex-col gap-1.5 rounded-lg border-2 p-3 text-left transition-shadow ${STATUS_STYLE[status]} ${
        selected ? "shadow-md ring-2 ring-stone-400" : ""
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
        <Icon className="h-3.5 w-3.5 shrink-0 text-stone-600" />
        <span className="text-sm font-medium text-stone-900">{node.label}</span>
        {durationMs !== undefined && (
          <span className="ml-auto font-mono text-[10px] text-stone-500">
            {durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`}
          </span>
        )}
      </span>
      <span className="text-[11px] leading-relaxed text-stone-600">{node.description}</span>
      <span className="text-[11px] leading-snug text-stone-500">
        <span className="font-mono font-semibold text-stone-400">IN </span>
        {node.input}
      </span>
      <span className="text-[11px] leading-snug text-stone-500">
        <span className="font-mono font-semibold text-stone-400">OUT </span>
        {node.output}
      </span>
    </button>
  );
}

/** Groups consecutive nodes that share a `concurrentGroup` into one cluster (rendered stacked,
 *  under a shared bracket) rather than chained by an arrow — they don't wait on each other, so a
 *  sequential arrow between them would misstate the actual timing. Everything else stays a
 *  single-node step in the normal left-to-right chain. */
export function groupConcurrent(nodes: FlowNodeSpec[]): FlowNodeSpec[][] {
  const groups: FlowNodeSpec[][] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    if (node.concurrentGroup) {
      const group = nodes.filter((n) => n.concurrentGroup === node.concurrentGroup);
      group.forEach((n) => seen.add(n.id));
      groups.push(group);
    } else {
      seen.add(node.id);
      groups.push([node]);
    }
  }
  return groups;
}

export default function FlowDiagram({
  nodes,
  name,
  statusById,
  selectedId,
  onSelect,
  durationById,
}: {
  nodes: FlowNodeSpec[];
  name: string;
  statusById: Record<string, NodeStatus>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  durationById?: Record<string, number>;
}) {
  const groups = groupConcurrent(nodes);
  return (
    <div className="flex flex-wrap items-start gap-2 overflow-x-auto pb-1" {...devLabel(`FlowDiagram.${name}`)}>
      {groups.map((group, i) => (
        <span key={group[0].id} className="flex items-start gap-2">
          {group.length > 1 ? (
            <div className="flex flex-col gap-1 rounded-xl border border-dashed border-stone-300 p-2">
              <div className="text-center text-[10px] font-medium tracking-wide text-stone-400 uppercase">
                Fired concurrently
              </div>
              <div className="flex flex-wrap gap-2">
                {group.map((node) => (
                  <NodeBox
                    key={node.id}
                    node={node}
                    status={statusById[node.id] ?? "idle"}
                    selected={selectedId === node.id}
                    onSelect={() => onSelect(node.id)}
                    durationMs={durationById?.[node.id]}
                  />
                ))}
              </div>
            </div>
          ) : (
            <NodeBox
              node={group[0]}
              status={statusById[group[0].id] ?? "idle"}
              selected={selectedId === group[0].id}
              onSelect={() => onSelect(group[0].id)}
              durationMs={durationById?.[group[0].id]}
            />
          )}
          {i < groups.length - 1 && (
            <ArrowRight className="mt-6 h-4 w-4 shrink-0 text-stone-300" aria-hidden />
          )}
        </span>
      ))}
    </div>
  );
}
