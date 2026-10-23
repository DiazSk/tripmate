import { NextRequest, NextResponse } from "next/server";
import { runClaude } from "@/lib/claude";
import { cheapModel } from "@/lib/llmConfig";
import { capFailureResponse, checkText, readJsonCapped } from "@/lib/inputLimits";
import { throttle } from "@/lib/ipThrottle";
import { capResponse, limitResponse, modelFailureResponse, offTopicResponse, prefilterRefusal } from "@/lib/limitResponse";
import { dailyCapResumesAt } from "@/lib/spendCap";
import { isRefusalShape } from "@/lib/promptScope";
import { IDEA_MAX_CHARS, buildIdeaReadPrompt, ideaFieldCount, parseIdeaRead, type IdeaRead } from "@/lib/ideaRead";
import { captureServer, failureOf, whoFromRequest } from "@/lib/analytics/server";

/**
 * Reads a traveller's one-sentence trip idea into planner fields, for the phone's Home box. One
 * cheap call, no data lookups, nothing written. There is no reply-length check, unlike chat: the
 * only thing returned is what `parseIdeaRead` validated field by field, never the model's text.
 */

const READ_TIMEOUT_MS = 30_000;
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
  return parsed ? NextResponse.json(parsed) : NextResponse.json({ error: UNREADABLE }, { status: 502 });
}
