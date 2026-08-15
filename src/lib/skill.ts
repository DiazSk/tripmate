import { readFile } from "fs/promises";
import path from "path";

/**
 * Loads a skill's body from `.claude/skills/<name>/SKILL.md`.
 *
 * runClaude() spawns the CLI with `--setting-sources ""` and `--tools ""` (see claude.ts), so
 * the CLI loads no settings sources and has no Skill tool — it can't discover or invoke a skill
 * on its own. Injecting the body into the prompt is therefore the only way to apply it without
 * changing those flags, which would alter the behaviour of every existing call.
 *
 * The YAML frontmatter is stripped: `name`/`description` exist to help a host decide *when* to
 * load a skill, and we've already made that decision by calling this.
 */
export async function loadSkill(name: string): Promise<string> {
  const file = path.join(process.cwd(), ".claude", "skills", name, "SKILL.md");
  const raw = await readFile(file, "utf8");
  return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}
