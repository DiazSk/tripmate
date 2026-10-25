import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_TIMEOUT_MS,
  itineraryTimeoutMs,
  ModelTimeoutError,
  parseJsonResponse,
  runClaude,
  type SessionOption,
} from "@/lib/claude";
import {
  appendChatTurn,
  getLlmSession,
  insertRun,
  listChatTurns,
  markTraceRefused,
  setTripChatSession,
  truncateLlmSession,
} from "@/lib/db";
import { readOwnTrip } from "@/lib/ownerRequest";
import { buildEditContext } from "@/lib/editContext";
import {
  buildChatEditPrompt,
  buildElementEditPrompt,
  buildResumedChatPrompt,
  itineraryFingerprint,
} from "@/lib/editPrompt";
import { applyPatch, PatchOp } from "@/lib/itineraryPatch";
import {
  CAPS,
  capFailureResponse,
  chatHistory,
  checkItinerary,
  checkText,
  readJsonCapped,
  UNREADABLE_REQUEST,
} from "@/lib/inputLimits";
import { throttle } from "@/lib/ipThrottle";
import {
  capResponse,
  limitResponse,
  modelFailureResponse,
  offTopicResponse,
  prefilterRefusal,
} from "@/lib/limitResponse";
import { cheapModel, llmMode } from "@/lib/llmConfig";
import { checkEditReply, MAX_REPLY_CHARS } from "@/lib/promptScope";
import { loadSkill } from "@/lib/skill";
import { dailyCapResumesAt } from "@/lib/spendCap";
import { Itinerary, TripSummary, UserAnswers } from "@/lib/types";
import { captureServer, failureOf, whoFromRequest } from "@/lib/analytics/server";
import { IDEA_DIETS } from "@/lib/ideaRead";
import {
  NOTHING_CHECKED,
  buildLookupAnswerPrompt,
  entryAnswer,
  groundAnswer,
  groundedOptions,
  lookupAnchor,
  pickReadyTrip,
  planEvidence,
  type EvidencePlace,
  type EvidenceSource,
  type QuestionKind,
} from "@/lib/meriAnswer";
import { gatherEvidence } from "@/lib/meriEvidence";
import { fetchReadyTrips } from "@/lib/readyTrips";
import { geocodeDestination } from "@/lib/weather";

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
  /** Instead of a reply: the traveller asked a question of a kind TripMate can fetch facts for. */
  lookup?: { kind: QuestionKind; place: string | null; diet: string | null };
}

/** The lookup answer's budget, as on Home: the facts get 10s, the answer call 30s. */
const EVIDENCE_BUDGET_MS = 10_000;
const ANSWER_TIMEOUT_MS = 30_000;

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
/**
 * One `chat_edit_answered` per request, reported from the response the handler chose, so none of
 * its early returns needs its own. Counts and categories only: nothing the traveller typed or the
 * model said goes into a property. A request that never became an edit (a 400 for a missing field,
 * a 404) is not an outcome.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const seen: { ops: number; mode: "chat" | "element" | null } = { ops: 0, mode: null };
  const res = await handle(req, seen);
  const failure = await failureOf(res);
  const outcome = failure
    ? ({ limited: "limited", cap: "refused", refused: "refused", timeout: "timeout", error: "error" } as const)[failure]
    : res.ok ? (seen.ops > 0 ? "applied" : "answered") : null;
  if (outcome) {
    captureServer(await whoFromRequest(req), "chat_edit_answered", { outcome, mode: seen.mode, duration_ms: Date.now() - startedAt, ops: seen.ops });
  }
  return res;
}

async function handle(req: NextRequest, seen: { ops: number; mode: "chat" | "element" | null }): Promise<Response> {
  const capped = dailyCapResumesAt();
  if (capped) return capResponse(capped);
  const read = await readJsonCapped(req);
  if (!read.ok) return capFailureResponse(read);
  const body = (read.value ?? {}) as Record<string, unknown>;
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

  seen.mode = mode === "chat" || mode === "element" ? mode : null;
  if (!mode || !trip || !itinerary) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Caps, then the free check, then the throttle: a request refused before the model costs the
  // traveller none of their 6 changes. The latest message is the only client text the model reads
  // on a resume, and chatHistory() cuts the rest on a rebuild.
  const clientMessages = (body as { messages?: { role?: unknown; content?: unknown }[] }).messages;
  const latest = Array.isArray(clientMessages) ? clientMessages[clientMessages.length - 1]?.content : undefined;
  const instruction = (body as { instruction?: unknown }).instruction;
  // A message that isn't text would reach the prompt builders as an object; the screen skips it.
  if (mode === "chat" && Array.isArray(clientMessages) && clientMessages.length > 0 && typeof latest !== "string") {
    return capFailureResponse(UNREADABLE_REQUEST);
  }
  for (const c of [
    checkText(latest, CAPS.message),
    checkText(instruction, CAPS.instruction),
    checkText(trip.destination, CAPS.destination),
    checkItinerary(itinerary),
  ]) {
    if (!c.ok) return capFailureResponse(c);
  }
  const refused =
    mode === "chat"
      ? prefilterRefusal(req, latest, "chat", "chat")
      : prefilterRefusal(req, instruction, "element-edit", "element");
  if (refused) return refused;

  const limit = throttle(req, "edit");
  if (limit.limited) return limitResponse(limit, "edit");

  try {
    const skill = await loadSkill("itinerary-planner");

    // Prefer what the caller sent (the pre-save page has answers in memory but no trip row yet),
    // falling back to what was stored when the trip was saved.
    // `readOwnTrip`, not `getTrip`: this only reaches the row for the traveller's stored answers
    // and its run id, but both belong to whoever owns it — borrowing another person's answers
    // into a prompt, and filing this edit under their run, are not things a trip id should buy.
    // Not yours reads as absent, which is a path this already has: the pre-save page has answers
    // in memory and no row at all.
    const stored = tripId ? await readOwnTrip(tripId) : undefined;
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
    let scope: { dayIndex: number; stopIndex?: number } | undefined;
    // Chat continues the session the itinerary was generated in; element edits deliberately do
    // not. An element edit is scope-locked and one-shot, and threading it through the chat
    // session would bury the traveler's conversation under machine turns it never asked for —
    // and leave the session believing it made an edit whose ops the applier may have rejected.
    let session: SessionOption | undefined;
    // Set only on the resume path, so a dead session can be retried as a full rebuild below.
    let resumedFrom: string | null = null;
    // What a rebuilt chat prompt replays: the saved transcript when there is one, never the
    // client's own copy of it. Filled in the chat branch below.
    let history: ReturnType<typeof chatHistory> = [];

    if (mode === "chat") {
      const { messages, dayIndex } = body as {
        messages: { role: "user" | "assistant"; content: string }[];
        dayIndex?: number;
      };
      if (!Array.isArray(messages) || messages.length === 0) {
        return NextResponse.json({ error: "Missing messages" }, { status: 400 });
      }
      history = chatHistory(stored ? listChatTurns(stored.id) : null, messages);
      /**
       * A day-scoped chat is now *enforced*, not merely requested.
       *
       * Both chat prompts have always stated a scope and marked the other days read-only, and
       * nothing contradicted a model that went outside it — so the narrower scope was a claim
       * the product could not keep. Handing it to the applier makes the out-of-scope op a
       * rejection the traveler reads, in the same place a locked stop's refusal appears.
       *
       * Absent `dayIndex` still means the whole trip, which is what every caller sent before
       * this and what the sheet sends when the traveler widens the scope themselves.
       */
      if (Number.isInteger(dayIndex) && dayIndex !== undefined) scope = { dayIndex };
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
        prompt = buildChatEditPrompt({ skill, editContext, itinerary, dayIndex, messages: history });
      }
    } else {
      const { dayIndex, stopIndex } = body as { dayIndex: number; stopIndex: number };
      const day = itinerary.days[dayIndex];
      const target = day?.stops[stopIndex];
      if (!day || !target || typeof instruction !== "string" || !instruction.trim()) {
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
    // The trace row of whichever call served the turn, so a refusal marks the right one.
    let traceId: string;
    // Set when a resumed API session served the turn: how long it was before, so a refused turn can
    // be cut back out of the model's memory. The CLI transport's JSONL file can't be edited after
    // the fact; it only serves local development, so that risk is accepted.
    let rollback: { id: string; keep: number } | null = null;
    const lengthBefore = resumedFrom && llmMode() === "api" ? getLlmSession(resumedFrom)?.length : undefined;
    try {
      const r = await runClaude(prompt, callType, timeoutMs, { runId, effort: "low", session });
      raw = r.result;
      servedBy = r.sessionId;
      traceId = r.traceId;
      if (resumedFrom && lengthBefore !== undefined) rollback = { id: resumedFrom, keep: lengthBefore };
    } catch (err) {
      // A session is a JSONL file on one machine, so it can simply not be there: the trip was
      // generated on another device, the home dir was cleaned, or persistence was off when it
      // ran. That must read as "start a fresh conversation", never as a failed edit — losing the
      // traveler's message because a file expired would be the worst outcome here.
      // A timeout is not a missing session: rebuilding would spend a second time limit before the
      // traveller heard anything.
      if (!resumedFrom || err instanceof ModelTimeoutError) throw err;
      console.warn(`[trip-edit] session ${resumedFrom} unusable, rebuilding`, err);
      const { dayIndex } = body as { dayIndex?: number };
      const rebuilt = buildChatEditPrompt({ skill, editContext, itinerary, dayIndex, messages: history });
      const r = await runClaude(rebuilt, callType, timeoutMs, {
        runId,
        effort: "low",
        session: { persist: true },
      });
      raw = r.result;
      servedBy = r.sessionId;
      traceId = r.traceId;
    }
    // A reply that breaks the JSON contract (prose, as a jailbreak's often is) never reaches the
    // reply check, so it is cut out of the resumed session here before the generic failure. The
    // trace keeps its `ok` status: `refused` means the traveller was told off_topic, and they aren't.
    let parsed: EditResponse & { refused?: unknown };
    try {
      parsed = parseJsonResponse<EditResponse & { refused?: unknown }>(raw);
    } catch (err) {
      if (rollback) truncateLlmSession(rollback.id, rollback.keep);
      throw err;
    }

    // The reply check. A refused turn changes nothing: no ops applied, no transcript written, no
    // new session stored (a rebuild's fresh session holds only this turn, so the client keeps the
    // one it sent), and the resumed session is cut back to where it was.
    const check = checkEditReply(parsed, MAX_REPLY_CHARS);
    if (check.refused) {
      markTraceRefused(traceId, check.reason);
      // ponytail: a sibling turn on the same session that lands while this one runs is cut away
      // with it; a single traveller's chat sends one turn at a time, so that is accepted.
      if (rollback) truncateLlmSession(rollback.id, rollback.keep);
      return offTopicResponse(mode === "chat" ? "chat" : "element");
    }

    // A lookup turn: fetch the facts, then resume the same session once to answer from them. It
    // rides this request's one allowance, and it changes nothing, so any ops either reply carried
    // are dropped. Whatever happens, the traveller gets a reply and the turn is stored.
    let found: { sources: EvidenceSource[]; places: EvidencePlace[] } = { sources: [], places: [] };
    if (mode === "chat" && parsed.lookup && typeof parsed.lookup === "object") {
      const startedAt = Date.now();
      const who = await whoFromRequest(req);
      const kind = (["best_time", "food", "see", "entry"] as const).find((k) => k === parsed.lookup?.kind) ?? "other";
      captureServer(who, "meri_question_asked", { surface: "trip", kind });
      const answered = await answerLookup({
        lookup: parsed.lookup,
        kind,
        itinerary,
        destination: stored?.destination ?? trip.destination,
        session: servedBy,
        runId,
      });
      const outcome = "refused" in answered ? "refused" : kind === "entry" ? "entry" : answered.reply === NOTHING_CHECKED ? "nothing_checked" : "answered";
      captureServer(who, "meri_question_answered", {
        surface: "trip",
        kind,
        outcome,
        sources: "refused" in answered ? 0 : answered.sources.length,
        duration_ms: Date.now() - startedAt,
      });
      if ("refused" in answered) {
        markTraceRefused(answered.refused.traceId, answered.refused.reason);
        if (rollback) truncateLlmSession(rollback.id, rollback.keep);
        return offTopicResponse("chat");
      }
      // A lookup the session holds no shown answer to would sit in its memory as a question left
      // hanging; a resumed API session is cut back to before it. A CLI file can't be, as above.
      if (!answered.inSession && rollback) truncateLlmSession(rollback.id, rollback.keep);
      if (answered.sessionId) servedBy = answered.sessionId;
      parsed = { reply: answered.reply, options: answered.options };
      found = { sources: answered.sources, places: answered.places };
    }

    const ops = parsed.ops ?? [];
    const { itinerary: updated, rejected } = applyPatch(itinerary, ops, scope);
    seen.ops = ops.length - rejected.length;

    // Whichever session actually served the turn — which is NOT necessarily the one we asked for,
    // since the fallback above opens a new one. Persisting the wrong id would strand the trip on
    // a dead session for every future turn.
    // `stored` is the owner-checked row, so a trip that is not the caller's is never written to.
    if (mode === "chat" && stored && servedBy && servedBy !== stored.chat_session_id) {
      setTripChatSession(stored.id, servedBy);
    }

    // Persist the turn pair, but only for a saved trip and only in chat mode. An element edit is
    // a one-shot instruction from a stop's own control, not part of the conversation, and
    // threading it into the transcript would put words in the traveler's mouth they never typed.
    // Best-effort: a transcript that fails to write must not fail the edit that already
    // succeeded, which is the same fail-soft bargain every other side-effect here makes.
    // `stored`, not `tripId`: the transcript belongs to the owner of the row, not to whoever names it.
    if (stored && mode === "chat") {
      try {
        const turns = (body as { messages?: { role: string; content: string }[] }).messages ?? [];
        const latest = turns[turns.length - 1];
        if (latest?.role === "user") {
          // **The scope goes on the turn, not just into the prompt.** A refusal reading "day 2 is
          // outside my current scope" is a fact about the request it answered, and the control
          // that set it is a live toggle — widen it afterwards and the transcript above reads as
          // the assistant having ignored a scope that was never in force. Recording it here is
          // what lets the sheet stamp each turn with the scope it actually went out under.
          appendChatTurn({
            tripId: stored.id,
            role: "user",
            content: latest.content,
            meta: { scope: scope?.dayIndex ?? null },
          });
        }
        appendChatTurn({
          tripId: stored.id,
          role: "assistant",
          content: parsed.reply ?? "",
          meta: {
            changes: parsed.changes ?? [],
            warnings: parsed.warnings ?? [],
            daysModified: daysModified(ops, rejected),
            knockOn: parsed.knockOn ?? null,
            rejected: rejected.map((r) => r.reason),
            sources: found.sources,
            places: found.places,
          },
        });
      } catch (err) {
        console.error("[trip-edit] transcript write failed", err);
      }
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
      // Where a lookup answer came from, rendered from the evidence records. Empty on other turns.
      sources: found.sources,
      places: found.places,
    });
  } catch (err) {
    // Logged, not returned — see the same guard in `/api/trip-generate`. A raw `err.message` from
    // here carries model, prompt and session internals to the browser.
    console.error("[trip-edit]", err);
    return modelFailureResponse(err, "Edit failed", "edit");
  }
}

type LookupAnswer =
  | { refused: { traceId: string; reason: string } }
  | {
      reply: string;
      options: string[];
      sources: EvidenceSource[];
      places: EvidencePlace[];
      /** Whether the session now holds the answer the traveller is shown. When it does not, a
       *  resumed API session is cut back to before the lookup. */
      inSession: boolean;
      sessionId?: string;
    };

/**
 * Answers a chat turn's `lookup` from fetched facts and the plan. Only the reply check's refusal is
 * passed back up; everything else that goes wrong (no facts, a failed or ungrounded answer) is the
 * honest line, so the turn is never empty.
 *
 * The place that reaches the prompt is always app-derived (see `lookupAnchor`): a stop's own name
 * or the geocoder's name for it. The traveller's (or the model's) wording only chooses which.
 */
async function answerLookup(input: {
  lookup: NonNullable<EditResponse["lookup"]>;
  kind: QuestionKind;
  itinerary: Itinerary;
  destination: string;
  session: string | undefined;
  runId: string;
}): Promise<LookupAnswer> {
  const { lookup, kind, itinerary, destination } = input;
  const nothing = { reply: NOTHING_CHECKED, options: [], sources: [], places: [] };
  // Entry rules never reach a model, as on Home.
  if (kind === "entry") return { ...nothing, reply: entryAnswer(destination).answer, inSession: false };
  if (!input.session) return { ...nothing, inSession: false };

  const plan = planEvidence(itinerary);
  // The destination only narrows the geocoder's search; it never reaches the prompt.
  const anchor = await lookupAnchor(plan.places, typeof lookup.place === "string" ? lookup.place : null, (name) =>
    geocodeDestination(`${name}, ${destination}`)
  );
  if (!anchor) return { ...nothing, inSession: false };
  const { place } = anchor;

  // The diet is interpolated into an Overpass query, so only a value from the closed list goes on.
  const diet = IDEA_DIETS.find((d) => d.toLowerCase() === String(lookup.diet ?? "").toLowerCase()) ?? null;
  const base = { place, diet, readyTrip: null, extraSources: plan.sources, extraPlaces: plan.places };
  const point = { lat: anchor.lat, lng: anchor.lng };
  const gathered = (async () => {
    const readyTrip = kind === "best_time" ? pickReadyTrip((await fetchReadyTrips()) ?? [], place) : null;
    return gatherEvidence({ ...base, kind, readyTrip, point });
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Past the budget the plan is still evidence: "other" fetches nothing.
  const evidence =
    (await Promise.race([gathered, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), EVIDENCE_BUDGET_MS)))])) ??
    (await gatherEvidence({ ...base, kind: "other", point }));
  clearTimeout(timer);

  let r: Awaited<ReturnType<typeof runClaude>>;
  try {
    r = await runClaude(buildLookupAnswerPrompt(kind, place, evidence), "meri-answer", ANSWER_TIMEOUT_MS, {
      runId: input.runId,
      model: cheapModel(),
      session: { resume: input.session, persist: true },
    });
  } catch (err) {
    console.error("[trip-edit] lookup answer failed", err);
    return { ...nothing, inSession: false };
  }
  let answer: EditResponse & { refused?: unknown; places?: unknown; months?: unknown; sources?: unknown; nothing?: unknown };
  try {
    answer = parseJsonResponse(r.result);
  } catch {
    // Prose where JSON was asked for is not an answer the session should keep.
    return { ...nothing, inSession: false, sessionId: r.sessionId };
  }
  const check = checkEditReply(answer, MAX_REPLY_CHARS);
  if (check.refused) return { refused: { traceId: r.traceId, reason: check.reason } };

  const grounded = groundAnswer({ ...answer, answer: answer.reply }, evidence);
  // The session keeps only an answer the traveller was shown: one that failed grounding is cut
  // back out with the rest, so a later turn never builds on a place nobody checked.
  if (grounded.nothingChecked) return { ...nothing, inSession: false, sessionId: r.sessionId };
  return {
    reply: grounded.answer,
    options: groundedOptions((Array.isArray(answer.options) ? answer.options : []).filter((o): o is string => typeof o === "string"), grounded.places).slice(0, 2),
    sources: grounded.sources,
    places: grounded.places,
    inSession: true,
    sessionId: r.sessionId,
  };
}
