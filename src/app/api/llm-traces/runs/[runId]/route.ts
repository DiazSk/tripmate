import { NextRequest, NextResponse } from "next/server";
import { getRun, getRunSteps } from "@/lib/db";
import { toRunDetail } from "@/lib/runs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  // Second lock: src/proxy.ts also 404s this, but a route must not depend on its proxy.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(toRunDetail(run, getRunSteps(runId)));
}
