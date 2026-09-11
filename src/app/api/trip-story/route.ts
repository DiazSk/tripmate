import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { parseJsonResponse, runClaude } from "@/lib/claude";
import { getStoryScript, getTrip, insertRun, saveStoryScript } from "@/lib/db";
import {
  buildStoryPrompt,
  compactDay,
  fallbackScript,
  normaliseScript,
  STORY_PROMPT_VERSION,
  type StoryScript,
} from "@/lib/storyScript";
import type { DayPlan } from "@/lib/types";

/**
 * 180s, and **it is the transport that needs the room, not the model.**
 *
 * On the API path a cheap-tier day answers in a few seconds and this cap is never approached. On
 * the CLI path the subprocess's own cold start dominates: a 60s cap was tried first and timed out
 * at 60019ms on a *two-stop* day, and after the prompt grew its "writing for the ear" section a
 * real three-stop day measured **84.5s** — six seconds inside the 90s `DEFAULT_TIMEOUT_MS` this
 * was set to next, which is not a margin. Three points, all launch-cost-dominated.
 *
 * A high cap costs nothing when it is not hit, and hitting it is the only thing it changes: past
 * the cap the fallback script plays, which is a worse story but is still a film. The camera has
 * already flown by then, and the script is cached, so a replay of the same day is instant.
 */
const STORY_TIMEOUT_MS = 180_000;

/**
 * `POST /api/trip-story` → the narration script for one day, for Story mode.
 *
 * **Always 200 with a playable script.** This route is reached by a Play button on a finished
 * plan, and the traveller is already watching the map fly. A 500 here would be a movie that never
 * starts, so every failure — no key, a timeout, unparseable JSON, a model that ignored the
 * contract — degrades to `fallbackScript()`, the day's own `why`/`note` lines read in order. The
 * `source` field on the response says which one arrived, and the stage says so on screen.
 *
 * Cached per (trip, day, content fingerprint) so replaying a day is instant and free, and so an
 * edit to the day invalidates its narration rather than describing stops that moved. Only for a
 * plan with a real trip row: the pre-save result view passes no `tripId` (its `trip` prop is the
 * `"preview"` placeholder), and those scripts live in the browser's session cache alone.
 */
export async function POST(req: NextRequest) {
  let body: {
    destination?: string;
    dayIndex?: number;
    dayCount?: number;
    day?: DayPlan;
    tripId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { destination, day, tripId } = body;
  const dayIndex = body.dayIndex ?? 0;
  const dayCount = body.dayCount ?? 1;
  // The one hard validation: with no day there is nothing to narrate and no fallback to build.
  if (!destination || !day || !Array.isArray(day.stops)) {
    return NextResponse.json({ error: "destination and day are required" }, { status: 400 });
  }

  const params = { destination, day, dayIndex, dayCount };
  // The prompt version is part of the key, not just the day — see `STORY_PROMPT_VERSION`.
  const fingerprint = createHash("sha256")
    .update(`v${STORY_PROMPT_VERSION}\n${compactDay(day, dayIndex)}`)
    .digest("hex")
    .slice(0, 16);

  // `"preview"` is the placeholder the pre-save result view passes as a trip id — it is not a row,
  // and a cache keyed on it would serve one trip's narration for the next one planned in the same
  // session.
  const cacheable = !!tripId && tripId !== "preview" && !!getTrip(tripId);
  if (cacheable) {
    const cached = getStoryScript(tripId!, dayIndex, fingerprint);
    if (cached) {
      return NextResponse.json({
        script: JSON.parse(cached.script_json) as StoryScript,
        cached: true,
      });
    }
  }

  const runId = randomUUID();
  insertRun({ id: runId, kind: "story", destination, tripId: tripId ?? null });

  try {
    const { result: raw } = await runClaude(
      buildStoryPrompt(params),
      "story",
      STORY_TIMEOUT_MS,
      { runId }
    );
    const script = normaliseScript(parseJsonResponse<unknown>(raw), params);
    if (cacheable) saveStoryScript({ tripId: tripId!, dayIndex, fingerprint, script });
    return NextResponse.json({ script, runId });
  } catch (err) {
    // Logged, not surfaced: `runClaude` has already written the trace row with the real cause, and
    // the traveller's answer to "the narrator failed" is a narrator that reads the plan instead.
    console.error("[trip-story] falling back to the day's own lines", err);
    return NextResponse.json({ script: fallbackScript(params), runId });
  }
}
