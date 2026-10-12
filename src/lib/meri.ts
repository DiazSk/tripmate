/**
 * Meri's decisions, as pure functions — what each state moves, and which state each surface is in.
 * Shared by both clients: the phone's `meridian.tsx` and the web's `Meridian.tsx` only draw what these
 * return. **This module imports nothing**, because the Expo bundle reaches it through Metro's
 * `watchFolders`; `meri.test.mjs` holds that line.
 *
 * **Meri only shows a state the app is actually in.** Nothing here invents "thinking"; every state
 * comes from a flag a host already holds. The body never changes colour by state, so no state is told
 * by colour alone — the host says it in words too.
 */

export type MeridianState =
  | "idle"
  | "thinking"
  | "streaming"
  | "speaking"
  | "paused"
  | "success"
  | "error"
  | "offline";

export interface MeridianMotion {
  /** One full breath, in ms, or null for no breathing. */
  breatheMs: number | null;
  blink: boolean;
  /** One full eye drift, in ms, or null. */
  driftMs: number | null;
  /** Speaking's squash-and-stretch loop. */
  squash: boolean;
  /** One lift on entering the state. */
  lift: boolean;
  /** Eye height as a fraction of open. */
  eyes: number;
}

const STILL: MeridianMotion = { breatheMs: null, blink: false, driftMs: null, squash: false, lift: false, eyes: 1 };

const MOTION: Record<MeridianState, MeridianMotion> = {
  idle: { ...STILL, breatheMs: 3200, blink: true },
  thinking: { ...STILL, breatheMs: 1400, blink: true },
  streaming: { ...STILL, breatheMs: 3200, blink: true, driftMs: 2400 },
  speaking: { ...STILL, blink: true, squash: true },
  paused: { ...STILL, eyes: 0.8 },
  success: { ...STILL, breatheMs: 3200, blink: true, lift: true },
  error: STILL,
  offline: STILL,
};

/** Reduce Motion stills every state completely; the eyes keep their shape. */
export function meridianMotion(state: MeridianState, reducedMotion: boolean): MeridianMotion {
  const motion = MOTION[state];
  return reducedMotion ? { ...STILL, eyes: motion.eyes } : motion;
}

/** A chat surface. A failed turn outranks a reply that just landed. */
export function meriForChat(chat: { replying: boolean; failure: string | null; justReplied: boolean }): MeridianState {
  if (chat.replying) return "thinking";
  if (chat.failure) return "error";
  return chat.justReplied ? "success" : "idle";
}

/**
 * The web's narration film. `voiceBroken` is checked before the silent case because a voice that
 * proved mute also reports `silentPlatform`; muted or speechless, Meri breathes rather than acting
 * out speech nobody hears.
 */
export function meriForStory(story: {
  phase: "loading" | "playing" | "paused" | "ended";
  voiceBroken: boolean;
  muted: boolean;
  silentPlatform: boolean;
}): MeridianState {
  if (story.phase === "ended") return "success";
  if (story.phase === "loading") return "thinking";
  if (story.voiceBroken) return "error";
  if (story.phase === "paused") return "paused";
  return story.muted || story.silentPlatform ? "idle" : "speaking";
}

/**
 * A plan being written. The web band unmounts on failure and never passes `failed`; the phone's wait
 * screen stays up to show the failure, so there a failure outranks everything the run had reached.
 */
export function meriForGeneration(run: { complete: boolean; streaming: boolean; failed?: boolean }): MeridianState {
  if (run.failed) return "error";
  if (run.complete) return "success";
  return run.streaming ? "streaming" : "thinking";
}

/**
 * One Meri's blink cycle, 2.8-5s, derived from a stable seed (React's `useId`) rather than
 * `Math.random()`, so the server and the client render the same value and two Meris on a page do not
 * blink in step.
 */
export function blinkCycleMs(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return 2800 + (hash % 2200);
}
