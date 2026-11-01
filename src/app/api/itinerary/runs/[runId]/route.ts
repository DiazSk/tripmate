import { NextRequest, NextResponse } from "next/server";
import { runOutcome } from "@/lib/db";
import { readableOwners } from "@/lib/owner";
import { currentOwner } from "@/lib/ownerRequest";

/**
 * What became of a generation, for a client that lost its stream — the phone, which iOS suspends
 * when it is left, so a plan's stream drops while the server goes on writing it. The run's id came
 * in the stream's first frame; this answers `writing`, `ready` (with the trip, to its owner only),
 * `failed` or `unknown`, so the client can open the plan instead of failing and starting another.
 * Free: nothing here reaches a model, so it takes no allowance.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { id, signedIn } = await currentOwner();
  return NextResponse.json(runOutcome(runId, readableOwners(id, signedIn)), {
    headers: { "Cache-Control": "no-store" },
  });
}
