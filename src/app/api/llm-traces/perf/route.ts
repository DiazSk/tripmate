import { NextRequest, NextResponse } from "next/server";
import { listTracesForPerf } from "@/lib/db";
import { aggregatePerfStats } from "@/lib/perfAggregate";

export async function GET(req: NextRequest) {
  // Second lock: src/proxy.ts also 404s this, but a route must not depend on its proxy.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const batchTag = new URL(req.url).searchParams.get("batchTag") || undefined;
  const traces = listTracesForPerf(batchTag);
  const features = aggregatePerfStats(
    traces.map((t) => ({
      type: t.type,
      durationMs: t.duration_ms,
      rawResponse: t.raw_response,
      costUsd: t.cost_usd,
    }))
  );
  return NextResponse.json({ features });
}
