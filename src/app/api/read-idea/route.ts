import { NextRequest, NextResponse } from "next/server";
import { runClaude } from "@/lib/claude";
import { cheapModel } from "@/lib/llmConfig";
import { capFailureResponse, checkText, readJsonCapped } from "@/lib/inputLimits";
import { throttle } from "@/lib/ipThrottle";
import { capResponse, limitResponse, modelFailureResponse, offTopicResponse, prefilterRefusal } from "@/lib/limitResponse";
import { dailyCapResumesAt } from "@/lib/spendCap";
import { isRefusalShape } from "@/lib/promptScope";
import { IDEA_MAX_CHARS, buildIdeaReadPrompt, ideaFieldCount, parseIdeaRead, type IdeaRead } from "@/lib/ideaRead";
import { buildAnswerPrompt, entryAnswer, nothingCheckedAnswer, parseMeriAnswer, pickReadyTrip, type MeriAnswer } from "@/lib/meriAnswer";
import { gatherEvidence } from "@/lib/meriEvidence";
import { fetchReadyTrips } from "@/lib/readyTrips";
import { geocodeDestination } from "@/lib/weather";
import { captureServer, failureOf, whoFromRequest, type Who } from "@/lib/analytics/server";

/**
 * Reads a traveller's one-sentence trip idea into planner fields, for the phone's Home box. One
 * cheap call, nothing written. There is no reply-length check, unlike chat: the only thing returned
 * is what `parseIdeaRead` validated field by field, never the model's text.
 *
 * When the sentence is a travel question about a place that geocodes, the reading also carries an
 * `answer`: facts are fetched for that place and a second cheap call answers from them, with
 * `parseMeriAnswer` deciding what reaches the traveller. That call is part of the same request, so
 * it takes no second allowance, and its failure never fails the read, which already succeeded.
 */

const READ_TIMEOUT_MS = 30_000;
const ANSWER_TIMEOUT_MS = 30_000;
/** Overall budget for the fetched facts; past it the answer is the honest line. */
const EVIDENCE_BUDGET_MS = 10_000;
const UNREADABLE = "Couldn’t read that idea. Try again, or plan it step by step.";

/**
 * One `idea_read` per request, reported from the response the handler chose. Only how much was
 * understood goes out (a count of fields), never the sentence or what was read from it. A request
 * that was not an idea at all (an empty box) is not an outcome.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const res = await handle(req);
  const failure = await failureOf(res);
  const outcome = failure
    ? ({ limited: "limited", cap: "refused", refused: "refused", timeout: "timeout", error: "unreadable" } as const)[failure]
    : res.ok ? "read" : null;
  if (outcome) {
    const fields = outcome === "read" ? ideaFieldCount((await res.clone().json()) as IdeaRead) : 0;
    captureServer(await whoFromRequest(req), "idea_read", { outcome, duration_ms: Date.now() - startedAt, fields });
  }
  return res;
}

async function handle(req: NextRequest): Promise<Response> {
  const capped = dailyCapResumesAt();
  if (capped) return capResponse(capped);
  const read = await readJsonCapped(req);
  if (!read.ok) return capFailureResponse(read);
  const idea = (read.value as { idea?: unknown } | null)?.idea;
  const cap = checkText(idea, IDEA_MAX_CHARS);
  if (!cap.ok) return capFailureResponse(cap);
  if (typeof idea !== "string" || !idea.trim()) {
    return NextResponse.json({ error: "Say where you’d like to go, or what kind of trip." }, { status: 400 });
  }
  // Free check before the throttle, so a refusal costs none of the allowance.
  const refused = prefilterRefusal(req, idea, "idea-read", "idea");
  if (refused) return refused;
  const limit = throttle(req, "idea");
  if (limit.limited) return limitResponse(limit, "idea");

  let result: string;
  try {
    ({ result } = await runClaude(buildIdeaReadPrompt(idea, new Date().toISOString().slice(0, 10)), "idea-read", READ_TIMEOUT_MS, {
      model: cheapModel(),
    }));
  } catch (err) {
    console.error("[read-idea] model call failed", err);
    return modelFailureResponse(err, UNREADABLE, "idea");
  }
  if (isRefusalShape(result)) return offTopicResponse("idea");
  const parsed = parseIdeaRead(result);
  if (!parsed) return NextResponse.json({ error: UNREADABLE }, { status: 502 });
  return NextResponse.json(await withAnswer(parsed, idea, await whoFromRequest(req)));
}

/** The reading, with an `answer` beside it when the sentence asked a question about a place. */
async function withAnswer(parsed: IdeaRead, idea: string, who: Who): Promise<IdeaRead & { answer?: MeriAnswer }> {
  const q = parsed.question;
  if (!q) return parsed;
  captureServer(who, "meri_question_asked", { surface: "home", kind: q.kind });
  if (!q.place) return parsed;
  const startedAt = Date.now();

  // The geocoder's own name goes into the prompt and the entry line, never the traveller's text.
  let geo: Awaited<ReturnType<typeof geocodeDestination>> = null;
  try {
    geo = await geocodeDestination(q.place);
  } catch {
    // An unreachable geocoder reads as a place that could not be found: the plain reading stands.
  }
  if (!geo) return parsed;
  const place = geo.country && geo.country !== geo.name ? `${geo.name}, ${geo.country}` : geo.name;

  let answer: MeriAnswer;
  if (q.kind === "entry") answer = entryAnswer(place);
  else if (q.kind === "other") answer = nothingCheckedAnswer();
  else {
    try {
      answer = await answerFromEvidence(idea, q.kind, q.diet, place, { lat: geo.lat, lng: geo.lon });
    } catch (err) {
      console.error("[read-idea] answer call failed", err);
      answer = nothingCheckedAnswer();
    }
  }
  const outcome = q.kind === "entry" ? "entry" : answer.nothingChecked ? "nothing_checked" : "answered";
  captureServer(who, "meri_question_answered", {
    surface: "home",
    kind: q.kind,
    outcome,
    sources: answer.sources.length,
    duration_ms: Date.now() - startedAt,
  });
  return { ...parsed, answer };
}

async function answerFromEvidence(
  idea: string,
  kind: Exclude<NonNullable<IdeaRead["question"]>["kind"], "entry" | "other">,
  diet: string | null,
  place: string,
  point: { lat: number; lng: number }
): Promise<MeriAnswer> {
  const gathered = (async () => {
    const readyTrip = kind === "best_time" ? pickReadyTrip((await fetchReadyTrips()) ?? [], place) : null;
    return gatherEvidence({ kind, point, place, diet, readyTrip });
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const evidence = await Promise.race([
    gathered,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), EVIDENCE_BUDGET_MS);
    }),
  ]);
  clearTimeout(timer);
  // Nothing fetched is nothing to ground an answer in, so the model is not asked.
  if (!evidence || evidence.sources.length === 0) return nothingCheckedAnswer();
  const { result } = await runClaude(buildAnswerPrompt(idea, kind, place, evidence), "meri-answer", ANSWER_TIMEOUT_MS, { model: cheapModel() });
  return parseMeriAnswer(result, evidence);
}
