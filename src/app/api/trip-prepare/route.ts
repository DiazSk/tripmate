import { NextRequest, NextResponse } from "next/server";
import { reconcileTrip } from "@/lib/reconcile";
import { enrichSelectedPois } from "@/lib/poiEnrichment";

/**
 * Steps 3 + 4. The caller awaits both parallel tracks and posts them here together — that await
 * IS the barrier, so this route runs only once the slower track has landed. It reconciles the
 * two bundles (Step 3), then enriches the traveler's selected POIs (Step 4).
 *
 * An unusable reconcile (no POIs from either source) is the one real error; every other missing
 * field degrades to a flagged default carried in `notes`.
 */
export async function POST(req: NextRequest) {
  const { rawFetch, userAnswers } = await req.json();
  if (!rawFetch || !userAnswers) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const reconciled = reconcileTrip(rawFetch, userAnswers);
  if (!reconciled.usable) {
    return NextResponse.json({ error: reconciled.error, notes: reconciled.notes }, { status: 400 });
  }

  const poiDetails = await enrichSelectedPois(reconciled);

  return NextResponse.json({ ok: true, reconciled, poiDetails });
}
