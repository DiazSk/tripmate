/* Run: node --test src/lib/jsxEscapes.test.mjs
 *
 * A JSX attribute in plain quotes is not a JS string: `title="Couldn’t reach search"` renders
 * the six characters `’` on screen, which the phone's add-place sheet did. Write the character
 * itself, or put the string in braces. Both clients are scanned. */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const tsx = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : tsx(join(dir, e.name))) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []
  );

test("no quoted JSX attribute carries a \\u escape", () => {
  const offenders = [];
  for (const file of [...tsx("src"), ...tsx("mobile/src")]) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/\s[a-zA-Z]+="[^"{}]*\\u[0-9a-fA-F]{4}/.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
