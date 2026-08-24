import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { homedir } from "os";

/** Same reasoning as `CLI_SEARCH_PATH` in claude.ts: a non-login process launcher never sources
 *  the shell profile, so a CLI installed under ~/.local/bin is invisible without this. */
const CLI_SEARCH_PATH = [`${homedir()}/.local/bin`];

/** Measured: a hotel search ~5.8s, a 3×3 route matrix ~2.9s, a place lookup ~4s. The cap exists
 *  so a wedged child can't hold a whole generation open — an overrun resolves `null`, the same
 *  shape as any other failure here, so it lands on the fail-soft path callers already have. */
const CLI_TIMEOUT_MS = 15_000;

/**
 * Run one `composio execute <slug>` and hand back its `data` payload.
 *
 * Extracted from `lodging.ts` once a second and third caller appeared. Three details here are
 * load-bearing and easy to lose in a re-implementation:
 *
 * - `spawn`, never `execFile` — see the note in claude.ts; `execFile` hangs on this class of
 *   binary and `spawn` does not.
 * - Large responses are **offloaded to a temp file** rather than returned inline
 *   (`storedInFile` + `outputFilePath`); a hotel search measured 81,407 tokens. A copy that
 *   forgets to follow that pointer silently sees no data at all.
 * - stderr is drained, because an unread pipe can fill and stall the child.
 *
 * Resolves `null` on every failure — missing binary, no session, timeout, non-JSON output, or
 * `successful: false` — so callers get one shape to degrade on.
 */
export function runComposioTool(slug: string, args: Record<string, unknown>): Promise<unknown | null> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    env.PATH = [env.PATH, ...CLI_SEARCH_PATH].filter(Boolean).join(":");

    const child = spawn("composio", ["execute", slug, "-d", JSON.stringify(args)], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let settled = false;
    const finish = (value: unknown | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, CLI_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", () => {});
    child.on("error", () => finish(null));

    child.on("close", async () => {
      if (settled) return;
      try {
        const envelope = JSON.parse(stdout) as {
          successful?: boolean;
          storedInFile?: boolean;
          outputFilePath?: string;
          data?: unknown;
        };
        if (envelope.successful === false) return finish(null);
        if (envelope.storedInFile && envelope.outputFilePath) {
          const body = JSON.parse(await readFile(envelope.outputFilePath, "utf8")) as { data?: unknown };
          return finish(body.data ?? null);
        }
        finish(envelope.data ?? null);
      } catch {
        // Non-JSON stdout is how the CLI reports a missing login or an unknown flag.
        finish(null);
      }
    });
  });
}
