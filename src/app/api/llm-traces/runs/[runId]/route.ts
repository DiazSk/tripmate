import { NextRequest, NextResponse } from "next/server";
import { getRun, getRunSteps } from "@/lib/db";
import { toRunDetail } from "@/lib/runs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(toRunDetail(run, getRunSteps(runId)));
}
