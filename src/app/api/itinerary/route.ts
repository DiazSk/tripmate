import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { itineraryTimeoutMs, parseJsonResponse, runClaude } from "@/lib/claude";
import { insertRun } from "@/lib/db";
import { buildRebalancePrompt } from "@/lib/itineraryPrompt";
import { normalizeDays } from "@/lib/itinerary";
import { MAX_TRIP_DAYS, tripDays } from "@/lib/tiers";
import { DayPlan } from "@/lib/types";
import { GenerationParams, runGeneration } from "@/lib/generationRunner";
import { StageEvent } from "@/lib/generationStages";
import type { StreamedStop } from "@/lib/streamingItinerary";
import { isThrottled } from "@/lib/ipThrottle";
import { isOverDailyCap } from "@/lib/spendCap";

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

export async function POST(req: NextRequest) {
  if (isThrottled(req)) {
    return NextResponse.json(
      { error: "Too many requests — slow down and try again shortly." },
      { status: 429 }
    );
  }
  if (isOverDailyCap()) {
    return NextResponse.json(
      { error: "Demo budget for today has been used up — try again tomorrow." },
      { status: 503 }
    );
  }
  const body = await req.json();
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
      return NextResponse.json({ error: GENERATION_ERROR }, { status: 500 });
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
      const result = await runGeneration(params, () => {});
      return NextResponse.json(result);
    } catch (err) {
      // `runGeneration` throws CLI timeouts and JSON parse failures. Those messages are
      // written for a developer reading a trace, not for someone waiting on a plan, so the
      // real one goes to the server log and the client gets a recovery step.
      console.error("[itinerary]", err);
      return NextResponse.json({ error: GENERATION_ERROR }, { status: 500 });
    }
  }

  // Do not add `export const runtime = "edge"` — the Edge runtime is deprecated in Next 16;
  // the Node default is the only non-deprecated choice and it supports streaming.
  let keepalive: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(PADDING_FRAME);
      let clientGone = false;
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
      const onStage = (event: StageEvent) => safeEnqueue("stage", event);
      const live = {
        onStop: (stop: StreamedStop) => safeEnqueue("stop", stop),
        onDayCoords: (dayIndex: number, coords: Record<string, { lat: number; lon: number }>) =>
          safeEnqueue("day-coords", { dayIndex, coords }),
        onPlan: (result: Awaited<ReturnType<typeof runGeneration>>) => safeEnqueue("plan", result),
        onRevised: (revision: { days: DayPlan[]; issues: string[] }) =>
          safeEnqueue("revised", revision),
      };
      try {
        const result = await runGeneration(params, onStage, live);
        safeEnqueue("done", result);
      } catch (err) {
        console.error("[itinerary]", err);
        safeEnqueue("error", { error: GENERATION_ERROR });
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
