import { NextRequest, NextResponse } from "next/server";
import { listTracesForPerf } from "@/lib/db";
import { aggregatePerfStats } from "@/lib/perfAggregate";

export async function GET(req: NextRequest) {
  const batchTag = new URL(req.url).searchParams.get("batchTag") || undefined;
  const traces = listTracesForPerf(batchTag);
  const features = aggregatePerfStats(
    traces.map((t) => ({ type: t.type, durationMs: t.duration_ms, rawResponse: t.raw_response }))
  );
  return NextResponse.json({ features });
}
