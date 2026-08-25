import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_TIMEOUT_MS,
  itineraryTimeoutMs,
  parseJsonResponse,
  runClaude,
  type SessionOption,
} from "@/lib/claude";
import { getTrip, insertRun, setTripChatSession } from "@/lib/db";
import { buildEditContext } from "@/lib/editContext";
import {
  buildChatEditPrompt,
  buildElementEditPrompt,
  buildResumedChatPrompt,
  itineraryFingerprint,
} from "@/lib/editPrompt";
import { applyPatch, PatchOp } from "@/lib/itineraryPatch";
import { loadSkill } from "@/lib/skill";
import { Itinerary, TripSummary, UserAnswers } from "@/lib/types";

interface EditResponse {
  reply?: string;
  options?: string[];
  changes?: string[];
  /** Guardrail alerts (skill §12) — travel time, hours clashes, an over-long day, a budget
   *  overshoot. Model-authored, one line each, rendered with a warning affordance by the UI. */
  warnings?: string[];
  why?: string;
  knockOn?: string | null;
  ops?: PatchOp[];
}

/**
 * Which days the traveler's plan actually changed on, as 1-based day numbers.
 *
 * Derived from the ops the applier accepted rather than asked of the model: "confirm which days
 * you touched" is a fact about what happened, and a model that miscounts its own dayIndexes would
 * confirm the wrong day with total confidence. Rejected ops are excluded — reference equality is
 * sound here because `applyPatch` pushes the very op objects it was handed.
 */
function daysModified(ops: PatchOp[], rejected: { op: PatchOp }[]): number[] {
  const applied = ops.filter((op) => !rejected.some((r) => r.op === op));
  return [...new Set(applied.map((op) => op.dayIndex + 1))].sort((a, b) => a - b);
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
  const { mode, trip, itinerary, tripId, userAnswers, sessionId, syncedHash } = body as {
    mode: "chat" | "element";
    trip: TripSummary;
    itinerary: Itinerary;
    tripId?: string | null;
    userAnswers?: UserAnswers | null;
    /** The CLI session carrying this trip's chat, echoed back from the previous turn. */
    sessionId?: string | null;
    /** The fingerprint that session was last told about — see itineraryFingerprint(). */
    syncedHash?: string | null;
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
    // Chat continues the session the itinerary was generated in; element edits deliberately do
    // not. An element edit is scope-locked and one-shot, and threading it through the chat
    // session would bury the traveler's conversation under machine turns it never asked for —
    // and leave the session believing it made an edit whose ops the applier may have rejected.
    let session: SessionOption | undefined;
    // Set only on the resume path, so a dead session can be retried as a full rebuild below.
    let resumedFrom: string | null = null;

    if (mode === "chat") {
      const { messages, dayIndex } = body as {
        messages: { role: "user" | "assistant"; content: string }[];
        dayIndex?: number;
      };
      if (!Array.isArray(messages) || messages.length === 0) {
        return NextResponse.json({ error: "Missing messages" }, { status: 400 });
      }
      // Prefer what the caller is holding (an unsaved trip has a session but no row yet), then
      // the saved trip. Null on a trip generated before sessions existed — that is the normal
      // no-session case, not an error, and it simply takes the rebuild path.
      const resumeId = sessionId ?? stored?.chat_session_id ?? null;

      if (resumeId) {
        resumedFrom = resumeId;
        session = { resume: resumeId };
        prompt = buildResumedChatPrompt({
          message: messages[messages.length - 1].content,
          itinerary,
          dayIndex,
          // The session's picture is only trustworthy while it matches the plan we were just
          // handed. Any mismatch — an element edit, a board reorder, a rejected op — and it gets
          // the current state back before it is allowed to address indices.
          resync: syncedHash !== itineraryFingerprint(itinerary),
        });
      } else {
        session = { persist: true };
        prompt = buildChatEditPrompt({ skill, editContext, itinerary, dayIndex, messages });
      }
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
    const callType = mode === "chat" ? "chat" : "element-edit";

    let raw: string;
    let servedBy: string | undefined;
    try {
      const r = await runClaude(prompt, callType, timeoutMs, { runId, effort: "low", session });
      raw = r.result;
      servedBy = r.sessionId;
    } catch (err) {
      // A session is a JSONL file on one machine, so it can simply not be there: the trip was
      // generated on another device, the home dir was cleaned, or persistence was off when it
      // ran. That must read as "start a fresh conversation", never as a failed edit — losing the
      // traveler's message because a file expired would be the worst outcome here.
      if (!resumedFrom) throw err;
      console.warn(`[trip-edit] session ${resumedFrom} unusable, rebuilding`, err);
      const { messages, dayIndex } = body as {
        messages: { role: "user" | "assistant"; content: string }[];
        dayIndex?: number;
      };
      const rebuilt = buildChatEditPrompt({ skill, editContext, itinerary, dayIndex, messages });
      const r = await runClaude(rebuilt, callType, timeoutMs, {
        runId,
        effort: "low",
        session: { persist: true },
      });
      raw = r.result;
      servedBy = r.sessionId;
    }
    const parsed = parseJsonResponse<EditResponse>(raw);

    const ops = parsed.ops ?? [];
    const { itinerary: updated, rejected } = applyPatch(itinerary, ops, scope);

    // Whichever session actually served the turn — which is NOT necessarily the one we asked for,
    // since the fallback above opens a new one. Persisting the wrong id would strand the trip on
    // a dead session for every future turn.
    if (mode === "chat" && tripId && servedBy && servedBy !== stored?.chat_session_id) {
      setTripChatSession(tripId, servedBy);
    }

    return NextResponse.json({
      ok: true,
      runId,
      sessionId: servedBy ?? null,
      // What the session may now assume about the plan. Null when the applier rejected an op:
      // the model believes it landed, so its picture is wrong in a way only a resync can fix,
      // and a hash that fails to match next turn is exactly how we force one.
      syncedHash: rejected.length === 0 ? itineraryFingerprint(updated) : null,
      // Persist this.
      itinerary: updated,
      // Show this.
      reply: parsed.reply ?? null,
      options: parsed.options ?? [],
      changes: parsed.changes ?? [],
      warnings: parsed.warnings ?? [],
      // Empty on a turn that only answered a question.
      daysModified: daysModified(ops, rejected),
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
