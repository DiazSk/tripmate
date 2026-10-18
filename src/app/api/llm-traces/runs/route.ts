import { NextResponse } from "next/server";
import { listUngroupedTraces } from "@/lib/db";
import { computeAllRunSummaries } from "@/lib/runs";

export async function GET() {
  // Second lock: src/proxy.ts also 404s this, but a route must not depend on its proxy.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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
