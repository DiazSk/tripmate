import { NextResponse } from "next/server";
import { listUngroupedTraces } from "@/lib/db";
import { computeAllRunSummaries } from "@/lib/runs";

export async function GET() {
  const runSummaries = computeAllRunSummaries();

  const ungroupedTraces = listUngroupedTraces().map((t) => ({
    id: t.id,
    type: t.type,
    status: t.status,
    model: t.model,
    durationMs: t.duration_ms,
    createdAt: t.created_at,
  }));

  return NextResponse.json({ runs: runSummaries, ungroupedTraces });
}
