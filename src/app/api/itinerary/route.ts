import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { itineraryTimeoutMs, ModelTimeoutError, parseJsonResponse, runClaude } from "@/lib/claude";
import { applyRevisionIfUnedited, insertRun, markRunFailed, saveTripForRun } from "@/lib/db";
import { currentOwnerId } from "@/lib/ownerRequest";
import { geocodeDestinationCached } from "@/lib/serverFetchCached";
import { buildRebalancePrompt } from "@/lib/itineraryPrompt";
import { normalizeDays } from "@/lib/itinerary";
import { MAX_TRIP_DAYS, tripDays } from "@/lib/tiers";
import { storedBudget } from "@/lib/userAnswers";
import { DayPlan } from "@/lib/types";
import { GenerationParams, runGeneration } from "@/lib/generationRunner";
import { StageEvent, type StageId } from "@/lib/generationStages";
import { attemptIdFrom, captureServer, failureOf, whoFromRequest, type Who } from "@/lib/analytics/server";
import { llmMode } from "@/lib/llmConfig";
import type { StreamedStop } from "@/lib/streamingItinerary";
import type { SketchDay } from "@/lib/sketch";
import { CAPS, capFailureResponse, checkItinerary, checkText, readJsonCapped } from "@/lib/inputLimits";
import { throttle } from "@/lib/ipThrottle";
import {
  capResponse,
  limitResponse,
  modelFailureResponse,
  OFF_TOPIC_SENTENCES,
  offTopicResponse,
  prefilterRefusal,
  TIMEOUT_SENTENCES,
} from "@/lib/limitResponse";
import { OffTopicError } from "@/lib/promptScope";
import { dailyCapResumesAt } from "@/lib/spendCap";

const GENERATION_ERROR = "The planner didn't finish. Try generating again.";

/** WebKit buffers a streamed response until 1024 bytes have arrived, so a few small SSE
 *  frames alone would sit invisible and then flush all at once — exactly the failure this
 *  feature exists to remove. This comment frame (ignored by the client parser, which skips
 *  any line starting with ":") exists purely to push past that threshold before the first
 *  real stage event is sent. */
const PADDING_FRAME = new TextEncoder().encode(`:${" ".repeat(2048)}\n\n`);

function sseFrame(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** What the handler learns that the analytics at the edge of `POST` cannot read off a response. */
interface Seen {
  /** Whether this request is a plan being written (the "plan" allowance), once the body says so. */
  plan?: boolean;
  /** The furthest stage reached, for a `plan_failed` to say where it stopped. */
  stage: "fetch" | "generate" | "save";
  /** Set when a non-streamed plan was written. A streamed one reports from inside its stream. */
  days?: number;
}

const stageOf = (stage: StageId): Seen["stage"] => (stage === "generate" || stage === "critique" ? "generate" : "fetch");

/** `limited` covers the throttle and the daily spend cap, `cap` an input cap, `rejected` the scope guard. */
const FAILURE_REASON = { limited: "limited", cap: "cap", refused: "rejected", timeout: "timeout", error: "model_error" } as const;

/**
 * Analytics sit here, at the edge, so each of the handler's early returns is reported once, from
 * the response it chose, rather than at every `return`. Only a plan being written counts: a refine
 * or a rebalance is a change to a plan the traveller already has.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const seen: Seen = { stage: "generate" };
  // Started now, in the request's scope, because a stream's callbacks run outside it and cannot ask.
  const who = whoFromRequest(req);
  const attemptId = attemptIdFrom(req);
  const res = await handle(req, seen, { who, attemptId, startedAt });
  // The daily cap answers before the body is read, so the client's attempt id is what says it was a plan.
  if (seen.plan ?? attemptId !== null) {
    const failure = await failureOf(res);
    const base = { duration_ms: Date.now() - startedAt, attempt_id: attemptId };
    if (failure) captureServer(await who, "plan_failed", { stage: seen.stage, reason: FAILURE_REASON[failure], ...base });
    else if (seen.days !== undefined) {
      captureServer(await who, "plan_written", { origin: "generated", days: seen.days, transport: llmMode(), ...base });
    }
  }
  return res;
}

async function handle(
  req: NextRequest,
  seen: Seen,
  track: { who: Promise<Who>; attemptId: string | null; startedAt: number }
): Promise<Response> {
  const capped = dailyCapResumesAt();
  if (capped) return capResponse(capped);
  const read = await readJsonCapped(req);
  if (!read.ok) return capFailureResponse(read);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- an untyped request body, as before
  const body = read.value as any;
  // Before the throttle: a body that cannot be read is not a request for anything.
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  // Read first so the refusal can name the action: a refine or a rebalance is a change to a plan
  // the traveller already has, and is held to the edit allowance, not the planning one.
  const bucket = body.rebalance || (body.previousItinerary && body.feedback) ? "edit" : "plan";
  seen.plan = bucket === "plan";
  // Caps and the free check, before the throttle, so a refusal costs none of the allowance.
  for (const c of [
    checkText(body.destination, CAPS.destination),
    checkText(body.feedback, CAPS.feedback),
    body.previousItinerary ? checkItinerary(body.previousItinerary) : null,
    body.remainingDays ? checkItinerary(body.remainingDays) : null,
  ]) {
    if (c && !c.ok) return capFailureResponse(c);
  }
  if (!body.rebalance && body.previousItinerary && body.feedback) {
    const refused = prefilterRefusal(req, body.feedback, "refine", "refine");
    if (refused) return refused;
  }
  const limit = throttle(req, bucket);
  if (limit.limited) return limitResponse(limit, bucket);
  const {
    destination,
    startDate,
    endDate,
    budget,
    tier,
    previousItinerary,
    feedback,
    preferences,
    rebalance,
    remainingDays,
    remainingBudget,
    tripId,
    userAnswers,
    dietary,
  } = body;

  // These are contract failures, not things a traveller can act on, so they read as one
  // sentence rather than as a field name: the client validates before it ever gets here,
  // and anything that reaches this point is a bug or a raw POST.
  if (!destination) {
    return NextResponse.json({ error: "No destination was sent with the request." }, { status: 400 });
  }

  if (rebalance) {
    try {
      if (!Array.isArray(remainingDays) || typeof remainingBudget !== "number" || !tier) {
        return NextResponse.json(
          { error: "The request was missing the days or budget to rebalance." },
          { status: 400 }
        );
      }
      // Its own run, never merged into the trip's original generation run:
      // rebalance fires on a separate later user action (possibly days after
      // generation) and produces/persists new days, unlike place-detail's
      // read-only enrichment of an already-generated pipeline — folding it
      // into the original run would make that run's total duration and step
      // sequence meaningless.
      const runId = randomUUID();
      insertRun({ id: runId, kind: "rebalance", destination, tripId: tripId ?? null });
      const prompt = buildRebalancePrompt({ destination, remainingDays, remainingBudget, tier });
      const { result: raw } = await runClaude(
        prompt,
        "rebalance",
        itineraryTimeoutMs(remainingDays.length),
        { runId }
      );
      const days = normalizeDays(parseJsonResponse<DayPlan[]>(raw));
      return NextResponse.json({ days, runId });
    } catch (err) {
      console.error("[itinerary]", err);
      return modelFailureResponse(err, GENERATION_ERROR, "edit");
    }
  }

  if (!startDate || !endDate || typeof budget !== "number") {
    return NextResponse.json(
      { error: "The request was missing a destination, dates, or a budget." },
      { status: 400 }
    );
  }

  // The client enforces this too, but the cap exists because the prompt grows with the
  // day count — so it belongs on the side that builds the prompt.
  if (tripDays(startDate, endDate) > MAX_TRIP_DAYS) {
    return NextResponse.json(
      { error: `Trips longer than ${MAX_TRIP_DAYS} days aren't supported yet.` },
      { status: 400 }
    );
  }

  const isRefine = Boolean(previousItinerary && feedback);
  if (!isRefine && !tier) {
    return NextResponse.json({ error: "No spending style was selected." }, { status: 400 });
  }

  const params: GenerationParams = {
    destination,
    startDate,
    endDate,
    budget,
    tier,
    previousItinerary,
    feedback,
    preferences,
    tripId,
    userAnswers,
    dietary,
  };

  const isStreaming = req.nextUrl.searchParams.get("stream") === "1";

  if (!isStreaming) {
    try {
      const result = await runGeneration(params, (event) => (seen.stage = stageOf(event.stage)));
      seen.days = result.itinerary.days.length;
      return NextResponse.json(result);
    } catch (err) {
      // `runGeneration` throws CLI timeouts and JSON parse failures. Those messages are
      // written for a developer reading a trace, not for someone waiting on a plan, so the
      // real one goes to the server log and the client gets a recovery step.
      // A refusal is the guard working, not a server error, so it is not logged as one.
      if (err instanceof OffTopicError) return offTopicResponse("refine");
      console.error("[itinerary]", err);
      return modelFailureResponse(err, GENERATION_ERROR, bucket);
    }
  }

  // **A new plan is saved by the server, as a draft, the moment it exists.** The client used to be
  // the only thing that turned a plan into a trip, and iOS suspends an app that is left: the stream
  // dropped, the plan was still written (at full cost, and with the allowance already spent), and
  // nobody saved it. The client's own save of the same run now finds this row (`saveTripForRun`).
  // A refine changes a trip the client already has, so it saves nothing here.
  const ownerId = !isRefine && bucket === "plan" ? await currentOwnerId() : null;
  const timezone: Promise<string | null> = ownerId
    ? Promise.race([
        geocodeDestinationCached(destination).then((g) => g?.timezone ?? null, () => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])
    : Promise.resolve(null);
  /** Known from the first frame, so a failure can be recorded against the run the client holds. */
  let runId: string | null = null;

  // Do not add `export const runtime = "edge"` — the Edge runtime is deprecated in Next 16;
  // the Node default is the only non-deprecated choice and it supports streaming.
  let keepalive: ReturnType<typeof setInterval> | undefined;
  // Out here so `cancel` can set it: a client that leaves after the plan (the web goes to the trip
  // page) is the ordinary case, and the frames still queued after it went logged as errors.
  let clientGone = false;
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(PADDING_FRAME);
      const safeEnqueue = (event: string, data: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(sseFrame(event, data));
        } catch (err) {
          clientGone = true;
          console.error(`[itinerary] ${event} emit failed`, err);
        }
      };
      // The generate wait (60-150s) and critique wait (10-30s) are otherwise silent on the
      // wire, which a platform proxy's idle-connection timeout (nginx ~60s, an ALB ~60s,
      // Cloudflare ~100s — see docs/backend.md) would kill mid-wait. A `:`-prefixed line is a
      // comment frame the client (eventStream.ts) already skips unconditionally, so this needs
      // no client change.
      keepalive = setInterval(() => {
        if (clientGone) return;
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch (err) {
          clientGone = true;
          console.error("[itinerary] keepalive emit failed", err);
        }
      }, 20_000);
      const onStage = (event: StageEvent) => {
        seen.stage = stageOf(event.stage);
        safeEnqueue("stage", event);
      };
      /** Set once the plan has been handed over and reported, so a later failure (the critique) is not a failed plan. */
      let reported = false;
      /** The plan as it went over the wire, for the revision below to recognise it on the draft. */
      let planned: { runId: string; days: DayPlan[] } | null = null;
      const live = {
        onStop: (stop: StreamedStop) => safeEnqueue("stop", stop),
        onDayCoords: (dayIndex: number, coords: Record<string, { lat: number; lon: number }>) =>
          safeEnqueue("day-coords", { dayIndex, coords }),
        onRun: (id: string) => {
          runId = id;
          // First, so a client that loses the stream can ask what became of this run.
          safeEnqueue("run", { runId: id });
        },
        onPlan: (result: Awaited<ReturnType<typeof runGeneration>>) => {
          planned = { runId: result.runId, days: structuredClone(result.itinerary.days) };
          if (ownerId) {
            const owner = ownerId;
            void timezone.then((tz) => {
              let tripId: string | null = null;
              try {
                tripId = saveTripForRun({
                  ownerId: owner,
                  destination,
                  startDate,
                  endDate,
                  // The request carries the figure as typed; the row keeps the party total, as /api/trips does.
                  budget: storedBudget(budget, userAnswers),
                  itinerary: result.itinerary,
                  runId: result.runId,
                  chatSessionId: result.sessionId ?? null,
                  userAnswers: userAnswers ?? null,
                  status: "draft",
                  timezone: tz,
                });
              } catch (err) {
                // The client still saves it, as before; a failed server save is not a failed plan.
                console.error("[itinerary] draft save failed", err);
              }
              safeEnqueue("plan", { ...result, tripId });
            });
          } else {
            safeEnqueue("plan", result);
          }
          // The plan exists the moment it is handed to the client; the critique that follows is a
          // revision of it, not part of writing it, so nothing more is sent when that finishes.
          if (!isRefine && !reported) {
            reported = true;
            void track.who.then((who) =>
              captureServer(who, "plan_written", {
                origin: "generated",
                days: result.itinerary.days.length,
                duration_ms: Date.now() - track.startedAt,
                transport: llmMode(),
                attempt_id: track.attemptId,
              })
            );
          }
        },
        // The critique lands minutes after the plan, usually after the client has moved to the
        // draft's trip page or left altogether, and this keeps running either way. So the
        // revision is written to that draft here, unless the traveller has edited it since, and
        // `tripId` tells a still-listening client it was. Without a row (the draft insert failed)
        // the client applies it to the result view as before. A failed write is not a failed run.
        onRevised: (revision: { days: DayPlan[]; issues: string[] }) => {
          let tripId: string | null = null;
          try {
            if (planned) tripId = applyRevisionIfUnedited(planned.runId, planned.days, revision.days);
          } catch (err) {
            console.error("[itinerary] revision write failed", err);
          }
          safeEnqueue("revised", { ...revision, tripId });
        },
        onSketch: (days: SketchDay[]) => safeEnqueue("sketch", { days }),
      };
      try {
        const result = await runGeneration(params, onStage, live);
        safeEnqueue("done", result);
      } catch (err) {
        if (!(err instanceof OffTopicError)) console.error("[itinerary]", err);
        // So a client that lost the stream reads "failed" rather than waiting on a run that ended.
        if (runId) {
          try {
            markRunFailed(runId);
          } catch (markErr) {
            console.error("[itinerary] run failure mark failed", markErr);
          }
        }
        if (!isRefine && !reported) {
          captureServer(await track.who, "plan_failed", {
            stage: seen.stage,
            reason: err instanceof OffTopicError ? "rejected" : err instanceof ModelTimeoutError ? "timeout" : "model_error",
            duration_ms: Date.now() - track.startedAt,
            attempt_id: track.attemptId,
          });
        }
        // The stream's status is already 200, so the timeout code rides in the event instead.
        safeEnqueue(
          "error",
          err instanceof OffTopicError
            ? { error: OFF_TOPIC_SENTENCES.refine, code: "off_topic" }
            : err instanceof ModelTimeoutError
              ? { error: TIMEOUT_SENTENCES[bucket], code: "timeout" }
              : { error: GENERATION_ERROR }
        );
      } finally {
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // Already closed or the controller is unusable post-disconnect — either way
          // there is nothing left to do.
        }
      }
    },
    cancel() {
      // The client navigated away or aborted the fetch; Next/undici already tears this
      // stream down for us. runGeneration has no cancellation token, so an in-flight Claude
      // call simply finishes and its result is discarded — nothing further to clean up here.
      clientGone = true;
      clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
    },
  });
}
