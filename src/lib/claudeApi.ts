import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { appendSessionTurns, getSessionMessages, insertTrace, updateTrace } from "./db";
import {
  apiModelFor,
  computeCostUsd,
  maxTokensFor,
  supportsAdaptiveThinking,
  supportsEffort,
  refusalFallbackEnabled,
} from "./llmConfig";
import type { ClaudeCallType, ClaudeResult, SessionOption } from "./claude";

/**
 * The HTTP half of the transport switch — same job as the `spawn` path in claude.ts, same
 * signature, same return shape, same trace rows. A caller cannot tell which one answered, and
 * that is the whole design constraint: `runClaude()` branches, nothing downstream does.
 *
 * Type-only import from `./claude` above, which is what keeps this from being a require cycle —
 * `import type` is erased entirely, so at runtime claude.ts imports this and this imports nothing
 * back. Do not turn it into a value import (see CLAUDE.md on `import type` and the test loader).
 *
 * What this file deliberately does NOT do: build prompts, decide context, or interpret responses.
 * The prompt arrives fully assembled by the same builders the CLI path uses, and the reply leaves
 * as the same raw string `parseJsonResponse` already expects. Transport only.
 */

/**
 * Constructed per call rather than once at module scope.
 *
 * Two reasons, and the second is the one that bites: a module-scope client would read
 * `ANTHROPIC_API_KEY` at import time, so a key added to `.env.local` while the dev server is up
 * would be ignored until a restart with no hint as to why. And a missing key would throw during
 * module *import*, taking down every route that transitively touches claude.ts — including the CLI
 * path, which needs no key at all.
 */
function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    // Loud and specific, never a silent fallback to the CLI. A quiet downgrade would mean the
    // model, the cost and the memory mechanism all changed without anyone asking for it — and the
    // symptom (a plan that reads slightly differently) would look like a prompt regression.
    throw new Error(
      "LLM_MODE is 'api' but ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the " +
        "dev server, or set LLM_MODE=cli to use the claude CLI instead."
    );
  }
  return new Anthropic({ apiKey });
}

/**
 * The two message shapes this file has to read from, unified.
 *
 * The refusal-fallback path goes through `client.beta.messages`, whose `BetaMessage` is a
 * structurally wider type than `Message` (extra content-block variants for tools this app never
 * declares). Nothing here touches those variants — only text blocks, usage and the stop fields — so
 * the union is narrowed to exactly that surface rather than cast, which would have silently
 * survived a real shape change in either SDK type.
 */
type ModelReply = Anthropic.Message | Anthropic.Beta.BetaMessage;

/** The usage fields both shapes share. Written structurally so `Usage` and `BetaUsage` both
 *  satisfy it without a cast. */
type ReplyUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** The CLI's JSON envelope, reproduced field-for-field from an HTTP response.
 *
 *  Not cosmetic. `llm_traces.raw_response` stores the envelope verbatim, and `parseUsage()` in
 *  runs.ts reads token counts and cost straight back out of it to render the trace viewer and the
 *  perf tooling. An API path that stored a differently-shaped blob would leave every one of those
 *  reading null for the mode that is now the default.
 *
 *  `total_cost_usd` is computed from the price table rather than reported: an HTTP response carries
 *  token counts and no money. That is the one field here that is an estimate. */
function buildEnvelope(params: {
  text: string;
  model: string;
  sessionId?: string;
  usage: ReplyUsage;
  stopReason: string | null;
}): string {
  const inputTokens = params.usage.input_tokens ?? 0;
  const outputTokens = params.usage.output_tokens ?? 0;
  const cacheReadInputTokens = params.usage.cache_read_input_tokens ?? 0;
  const cacheCreationInputTokens = params.usage.cache_creation_input_tokens ?? 0;
  const costUSD = computeCostUsd(params.model, {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
  });
  return JSON.stringify({
    result: params.text,
    ...(params.sessionId ? { session_id: params.sessionId } : {}),
    stop_reason: params.stopReason,
    // Marks which transport wrote the row, so a trace can be attributed without inferring it from
    // the model name (which is configurable, and which the bench harness overrides anyway).
    transport: "api",
    modelUsage: {
      [params.model]: {
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        costUSD,
      },
    },
    total_cost_usd: costUSD,
  });
}

/** Every `text` block, concatenated — the same single string the CLI handed back as
 *  `envelope.result`, so `parseJsonResponse` downstream is unchanged. Thinking blocks are skipped:
 *  they never reached a caller on the CLI path either. */
function textOf(message: ModelReply): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock | Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * The conversation to send, and where the cache breakpoint goes.
 *
 * A resumed call replays the stored transcript and appends the new turn — which is exactly what
 * `--resume` did by replaying the JSONL, so the model sees the same history it always did. The
 * breakpoint sits on the **last replayed message**, never on the new one: everything up to there is
 * byte-identical between turns and therefore cacheable, while the new turn is the volatile part
 * that would invalidate the prefix if it were inside it.
 *
 * That placement is what makes seeding chat with the whole generate turn affordable. The generate
 * prompt is ~30KB of skill + context + facts; replayed at full price on every chat turn it would
 * dominate the cost of the cheap tier it is supposed to be feeding. Read from cache it bills at
 * ~0.1x. A one-shot call gets no breakpoint — there is no prefix to reuse.
 */
function buildMessages(prompt: string, history: { role: "user" | "assistant"; content: string }[]) {
  const messages: Anthropic.MessageParam[] = history.map((turn, i) => ({
    role: turn.role,
    content: [
      {
        type: "text" as const,
        text: turn.content,
        ...(i === history.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
      },
    ],
  }));
  messages.push({ role: "user", content: [{ type: "text", text: prompt }] });
  return messages;
}

/**
 * One model call over HTTPS, traced identically to the CLI path.
 *
 * `timeoutMs` keeps the meaning it has on the CLI side — a hard wall-clock ceiling on the whole
 * call — so the day-scaled budgets in `itineraryTimeoutMs()` carry over unchanged and a slow API
 * call is killed at the same point a slow child process was. It is enforced with an AbortController
 * rather than the SDK's own `timeout` option because the SDK retries a timeout up to `maxRetries`
 * times, which would let total wall clock reach 3x the number the caller asked for.
 */
export async function runClaudeApi(
  prompt: string,
  type: ClaudeCallType,
  timeoutMs: number,
  meta?: {
    runId?: string;
    effort?: "low" | "medium" | "high";
    model?: string;
    session?: SessionOption;
  }
): Promise<ClaudeResult> {
  const model = meta?.model ?? apiModelFor(type);
  const traceId = insertTrace({ type, prompt, model, runId: meta?.runId });
  const startedAt = Date.now();

  // Same three-way contract as the CLI's session flags: resume an existing conversation, start a
  // persisted one, or stay one-shot. `resume` implies persistence there and here.
  const resumeId = meta?.session?.resume;
  const history = resumeId ? getSessionMessages(resumeId) : [];
  const sessionId = resumeId ?? (meta?.session?.persist ? randomUUID() : undefined);

  /**
   * A resume whose conversation isn't here must **fail**, not proceed with an empty history.
   *
   * This is the parity case that a straight port gets wrong, and it fails silently. The prompt that
   * accompanies a resume (`buildResumedChatPrompt`) is deliberately tiny — it carries the
   * traveler's message and the response contract, and nothing else, because it assumes the planning
   * rules, the trip context and the plan itself are already in the conversation. Sending it against
   * an empty history would hand the model a bare question with no itinerary, no skill and no
   * traveler profile, and it would confidently answer anyway.
   *
   * The CLI reached the same state by different means — its session was a JSONL file on one
   * machine, so a trip opened on another device found nothing to resume and the CLI exited
   * non-zero. `/api/trip-edit` already catches exactly that and rebuilds the full prompt with
   * `buildChatEditPrompt`. Throwing here routes into that same recovery rather than duplicating it,
   * which is why this is an error and not a quiet rebuild inside this file.
   *
   * Not hypothetical: a trip generated in `cli` mode has its session in a JSONL and nothing in
   * `llm_sessions`, so every chat turn after a mode flip lands here.
   */
  if (resumeId && history.length === 0) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = `no stored conversation for session ${resumeId}`;
    updateTrace(traceId, { status: "error", durationMs, errorMessage });
    throw new Error(`claude API cannot resume: ${errorMessage}`);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const client = createClient();
    const request = {
      model,
      max_tokens: maxTokensFor(type),
      messages: buildMessages(prompt, history),
      // Only where the model accepts them — both are a 400, not a no-op, on the cheap tier's
      // default model. See the capability regexes in llmConfig.ts.
      ...(supportsAdaptiveThinking(model) ? { thinking: { type: "adaptive" as const } } : {}),
      ...(meta?.effort && supportsEffort(model)
        ? { output_config: { effort: meta.effort } }
        : {}),
    };

    // Streamed on every call, including the short ones. Generation runs for minutes and emits tens
    // of thousands of tokens, which a non-streaming request can lose to an HTTP idle timeout; the
    // cheap calls do not need it but pay nothing for it, and one code path is worth more than a
    // marginal simplification on the branch that is easy either way. `finalMessage()` gives back
    // the same assembled message a non-streaming call would have returned.
    const message: ModelReply = refusalFallbackEnabled(model)
      ? await client.beta.messages
          .stream(
            {
              ...request,
              // A policy decline on the generation path is a blank screen after a five-minute
              // wait. "default" lets the server route the retry by refusal category rather than
              // making us maintain a model list. Disable with LLM_REFUSAL_FALLBACK=0.
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
            },
            { signal: controller.signal }
          )
          .finalMessage()
      : await client.messages.stream(request, { signal: controller.signal }).finalMessage();

    clearTimeout(timer);

    // HTTP 200 with nothing usable in it. Checked before reading content, which is empty or
    // partial on a decline — treating it as a normal reply would hand `parseJsonResponse` an empty
    // string and surface as "the planner didn't finish" with no recorded cause.
    if (message.stop_reason === "refusal") {
      const detail = message.stop_details?.category
        ? ` (category: ${message.stop_details.category})`
        : "";
      const durationMs = Date.now() - startedAt;
      updateTrace(traceId, {
        status: "error",
        rawResponse: JSON.stringify(message),
        durationMs,
        errorMessage: `refusal${detail}`,
      });
      throw new Error(`Claude API declined this request${detail}.`);
    }

    const text = textOf(message);
    const durationMs = Date.now() - startedAt;
    updateTrace(traceId, {
      status: "ok",
      rawResponse: buildEnvelope({
        text,
        model,
        sessionId,
        usage: message.usage,
        stopReason: message.stop_reason,
      }),
      durationMs,
    });

    // Written only after a successful turn, so a failed call never leaves a half-turn in the
    // transcript for the next resume to replay. `max_tokens` truncation is stored as-is: it is what
    // the model actually said, and the CLI path recorded truncated output the same way.
    if (sessionId) {
      appendSessionTurns(sessionId, model, [
        { role: "user", content: prompt },
        { role: "assistant", content: text },
      ]);
    }

    return { result: text, traceId, model, durationMs, sessionId };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Date.now() - startedAt;

    // Distinguished from a network abort by our own flag, for the same reason the CLI path keeps a
    // `settled` flag: a timeout that records itself as a generic error is the one failure mode
    // worth spotting, and the trace viewer had never shown a single one until that was fixed.
    if (timedOut) {
      updateTrace(traceId, { status: "timeout", durationMs });
      throw new Error(`claude API timed out after ${timeoutMs}ms`);
    }

    // The refusal branch above already wrote its terminal row and is only passing through here.
    if (err instanceof Error && err.message.startsWith("Claude API declined")) throw err;

    // Typed SDK errors, most specific first — a 401 and a 529 want different reactions from
    // whoever reads the trace, and a single catch-all would flatten them into one message.
    let errorMessage: string;
    if (err instanceof Anthropic.AuthenticationError) {
      errorMessage = "ANTHROPIC_API_KEY was rejected (401). Check the key in .env.local.";
    } else if (err instanceof Anthropic.RateLimitError) {
      errorMessage = "Rate limited by the Claude API (429). Retry shortly.";
    } else if (err instanceof Anthropic.APIConnectionError) {
      errorMessage = `Could not reach the Claude API: ${err.message}`;
    } else if (err instanceof Anthropic.APIError) {
      errorMessage = `Claude API error ${err.status}: ${err.message}`;
    } else {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    updateTrace(traceId, { status: "error", durationMs, errorMessage });
    throw new Error(errorMessage);
  }
}
