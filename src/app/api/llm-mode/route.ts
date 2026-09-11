import { NextRequest, NextResponse } from "next/server";
import {
  CHAT_FALLBACK_MODEL,
  apiModelFor,
  llmMode,
  llmModeSource,
  setLlmMode,
  type ClaudeCallType,
  type LlmMode,
} from "@/lib/llmConfig";

/**
 * The runtime transport switch, and the answer to "which model is serving what right now".
 *
 * `LLM_TRANSPORT` in `.env.local` is the durable setting; this is the toggle you reach for mid-session
 * to answer "is this a model problem or a transport problem?" without restarting the dev server and
 * losing the state that reproduced it. Process-local and not persisted — see the note on
 * `runtimeOverride` in llmConfig.ts for why a flag that survives a restart is the wrong default.
 *
 * Read-only otherwise: it reports configuration, it never makes a model call.
 */

/** Every call type, in the order they occur in a trip's life, so the report reads as a pipeline
 *  rather than as an alphabetised list. */
const CALL_TYPES: ClaudeCallType[] = [
  "context",
  "generate",
  "refine",
  "critique",
  "rebalance",
  "chat",
  "element-edit",
  "place-detail",
  "story",
  "judge",
];

/** Keys reported rather than values: `ANTHROPIC_API_KEY` must never leave the server, and knowing
 *  *whether* it is set is the whole diagnostic. */
function snapshot() {
  const mode = llmMode();
  return {
    mode,
    source: llmModeSource(),
    apiKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    // What each call type resolves to on the API path. The CLI path ignores all of this and runs
    // every type on MODEL (claude-sonnet-4-5), whose calibration is documented in claude.ts.
    apiModels: Object.fromEntries(CALL_TYPES.map((t) => [t, apiModelFor(t)])),
    env: {
      LLM_TRANSPORT: process.env.LLM_TRANSPORT?.trim() || null,
      LLM_MODEL_STRONG: process.env.LLM_MODEL_STRONG?.trim() || null,
      LLM_MODEL_CHEAP: process.env.LLM_MODEL_CHEAP?.trim() || null,
      LLM_MODEL_CHAT: process.env.LLM_MODEL_CHAT?.trim() || null,
      LLM_MODEL_STORY: process.env.LLM_MODEL_STORY?.trim() || null,
    },
    chatFallbackModel: CHAT_FALLBACK_MODEL,
  };
}

export async function GET() {
  return NextResponse.json(snapshot());
}

/**
 * `POST {"mode":"cli"}` forces the CLI, `{"mode":"api"}` forces the API, `{"mode":null}` clears the
 * override and hands the decision back to `LLM_TRANSPORT`.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON: {\"mode\":\"api\"|\"cli\"|null}" }, { status: 400 });
  }

  const mode = (body as { mode?: unknown }).mode;
  if (mode !== "api" && mode !== "cli" && mode !== null) {
    return NextResponse.json(
      { error: `mode must be "api", "cli", or null to clear the override — got ${JSON.stringify(mode)}` },
      { status: 400 }
    );
  }

  setLlmMode(mode as LlmMode | null);

  // Warned about, not refused. Flipping to api without a key is a legitimate thing to do while
  // setting one up, and the failure it produces later is already loud and specific (see
  // createClient in claudeApi.ts) — but saying so here saves a confusing generation attempt.
  const state = snapshot();
  return NextResponse.json({
    ...state,
    warning:
      state.mode === "api" && !state.apiKeyPresent
        ? "Mode is 'api' but ANTHROPIC_API_KEY is not set — every model call will fail until it is."
        : null,
  });
}
