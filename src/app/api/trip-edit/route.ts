import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_TIMEOUT_MS, itineraryTimeoutMs, parseJsonResponse, runClaude } from "@/lib/claude";
import { getTrip, insertRun } from "@/lib/db";
import { buildEditContext } from "@/lib/editContext";
import { buildChatEditPrompt, buildElementEditPrompt } from "@/lib/editPrompt";
import { applyPatch, PatchOp } from "@/lib/itineraryPatch";
import { loadSkill } from "@/lib/skill";
import { Itinerary, TripSummary, UserAnswers } from "@/lib/types";

interface EditResponse {
  reply?: string;
  options?: string[];
  changes?: string[];
  why?: string;
  knockOn?: string | null;
  ops?: PatchOp[];
}

/**
 * Step 7 — the edit loop. Two modes, one route, because they differ only in which prompt template
 * frames the request; everything else (frozen context, skill in scope, patch application) is
 * shared.
 *
 * Nothing here re-runs Steps 2a/3/4/5: the edit context is assembled from data already on the
 * trip and stays fixed for the session. An edit is a patch against frozen facts.
 *
 * The response deliberately separates the two audiences — `itinerary` is the full updated plan to
 * persist (single source of truth), while `changes`/`why`/`knockOn` are the only things meant for
 * the UI. Raw model output never leaves this route.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { mode, trip, itinerary, tripId, userAnswers } = body as {
    mode: "chat" | "element";
    trip: TripSummary;
    itinerary: Itinerary;
    tripId?: string | null;
    userAnswers?: UserAnswers | null;
  };

  if (!mode || !trip || !itinerary) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const skill = await loadSkill("itinerary-planner");

    // Prefer what the caller sent (the pre-save page has answers in memory but no trip row yet),
    // falling back to what was stored when the trip was saved.
    const stored = tripId ? getTrip(tripId) : undefined;
    const answers =
      userAnswers ??
      (stored?.user_answers_json ? (JSON.parse(stored.user_answers_json) as UserAnswers) : null);

    const editContext = buildEditContext(trip, itinerary, answers);

    // Append to the trip's original run when there is one, so an edit reads as another step on
    // that pipeline rather than an orphan — the same grouping place-detail already does.
    let runId = stored?.run_id ?? undefined;
    if (!runId) {
      runId = randomUUID();
      insertRun({ id: runId, kind: "refine", destination: trip.destination, tripId: tripId ?? null });
    }

    let prompt: string;
    let scope: { dayIndex: number; stopIndex: number } | undefined;

    if (mode === "chat") {
      const { messages, dayIndex } = body as {
        messages: { role: "user" | "assistant"; content: string }[];
        dayIndex?: number;
      };
      if (!Array.isArray(messages) || messages.length === 0) {
        return NextResponse.json({ error: "Missing messages" }, { status: 400 });
      }
      prompt = buildChatEditPrompt({ skill, editContext, itinerary, dayIndex, messages });
    } else {
      const { dayIndex, stopIndex, instruction } = body as {
        dayIndex: number;
        stopIndex: number;
        instruction: string;
      };
      const day = itinerary.days[dayIndex];
      const target = day?.stops[stopIndex];
      if (!day || !target || !instruction?.trim()) {
        return NextResponse.json({ error: "Missing or invalid element" }, { status: 400 });
      }
      // Scope lock is enforced when applying, not merely requested in the prompt.
      scope = { dayIndex, stopIndex };
      prompt = buildElementEditPrompt({
        skill,
        editContext,
        dayIndex,
        stopIndex,
        day,
        target,
        instruction,
      });
    }

    // A whole-trip chat turn reasons over every day and the transcript, so it needs the same
    // day-scaled budget generation gets. An element edit sees one slot and its two neighbours —
    // the flat default is plenty, and a tight bound there keeps a stuck call from hanging the UI.
    const timeoutMs =
      mode === "chat" ? itineraryTimeoutMs(itinerary.days.length) : DEFAULT_TIMEOUT_MS;
    const { result: raw } = await runClaude(
      prompt,
      mode === "chat" ? "chat" : "element-edit",
      timeoutMs,
      { runId, effort: "low" }
    );
    const parsed = parseJsonResponse<EditResponse>(raw);

    const { itinerary: updated, rejected } = applyPatch(itinerary, parsed.ops ?? [], scope);

    return NextResponse.json({
      ok: true,
      runId,
      // Persist this.
      itinerary: updated,
      // Show this.
      reply: parsed.reply ?? null,
      options: parsed.options ?? [],
      changes: parsed.changes ?? [],
      why: parsed.why ?? null,
      knockOn: parsed.knockOn ?? null,
      // Non-empty only when the model tried to reach outside its scope — worth surfacing rather
      // than silently dropping, since it means the edit did less than it claimed.
      rejected: rejected.map((r) => r.reason),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Edit failed" },
      { status: 500 }
    );
  }
}
