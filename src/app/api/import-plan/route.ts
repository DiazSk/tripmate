import { NextRequest, NextResponse } from "next/server";
import { runClaude } from "@/lib/claude";
import { extractModel } from "@/lib/llmConfig";
import { gatherSources, readImportRequest } from "@/lib/importRequest";
import { buildPlanReadPrompt, parsePlanRead } from "@/lib/planImport";
import { geocodeAnchors } from "@/lib/anchorGeocode";
import { geocodeDestinationCached } from "@/lib/serverFetchCached";
import { MAX_TRIP_DAYS } from "@/lib/tiers";
import type { ImportedPlan } from "@/lib/importedPlan";
import type { Anchor } from "@/lib/types";

/**
 * Bring your own itinerary, step one: read the plan into days and stops, and find each stop on
 * the map so the confirm screen can say which were found. Writes nothing.
 */

const READ_TIMEOUT_MS = 90_000;

export async function POST(req: NextRequest) {
  const request = await readImportRequest(req, "import-plan");
  if (request instanceof NextResponse) return request;
  const { items, destination } = request;
  const { sources, images, imageIndices, unread, direct } = await gatherSources(items);
  // A Maps link names one place, and on its own says nothing about which day it belongs to, so it
  // reaches the read as text alongside everything else.
  for (const { index, anchor } of direct) sources.push({ index, kind: "text", text: anchor.name });
  sources.sort((a, b) => a.index - b.index);
  if (sources.length === 0 && images.length === 0) {
    // Everything dropped in was unreadable (an Instagram link, a dead page): the reason is the
    // useful sentence, not "add your plan first" — they did, and need to know why it didn't take.
    const reasons = [...new Set(unread.map((u) => u.reason))];
    const error = reasons.length ? `${reasons.join(". ")}.` : "Add your plan first: paste it or add screenshots.";
    return NextResponse.json({ error }, { status: 400 });
  }

  let plan: ImportedPlan | null = null;
  try {
    const { result } = await runClaude(
      buildPlanReadPrompt(sources, imageIndices, destination),
      "plan-read",
      READ_TIMEOUT_MS,
      { model: extractModel(), images }
    );
    plan = parsePlanRead(result);
  } catch (err) {
    console.error("[import-plan] read failed", err);
  }
  if (!plan) {
    return NextResponse.json({ error: "Couldn't read your plan. Try again, or paste it as text." }, { status: 502 });
  }
  if (plan.days.length > MAX_TRIP_DAYS) {
    return NextResponse.json(
      { error: "Trips over 30 days aren't supported. Please choose a shorter date range." },
      { status: 400 }
    );
  }
  plan.unread = unread.sort((a, b) => a.index - b.index);

  const city = destination ?? plan.destinationGuess;
  const geo = city ? await geocodeDestinationCached(city).catch(() => null) : null;
  if (plan.isPlan && geo) {
    const names = [...new Set(plan.days.flatMap((d) => d.stops.map((s) => s.name)))];
    const anchors: Anchor[] = names.map((name) => ({ name, lat: null, lng: null, priority: "want", source: "import" }));
    const placed = new Map((await geocodeAnchors(anchors, { lat: geo.lat, lon: geo.lon })).map((a) => [a.name, a]));
    for (const day of plan.days) {
      for (const stop of day.stops) {
        const hit = placed.get(stop.name);
        if (hit && hit.lat !== null && hit.lng !== null) {
          stop.lat = hit.lat;
          stop.lng = hit.lng;
        }
      }
    }
  }
  return NextResponse.json(plan);
}
