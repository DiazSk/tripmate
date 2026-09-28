/**
 * Point the suite's database at memory, before anything opens the real one.
 *
 * `src/lib/db.ts` resolves `DB_PATH ?? cwd/tripmate.db` and opens it **at import time**, so every
 * test that reaches a DB-touching module was writing real rows into the developer's own
 * `tripmate.db`. Four files do it directly — `db`, `claimOwner`, `savedPlacesDb`, `fetchCache` —
 * and `bench.test.mjs` reaches it transitively through `runBenchmark.ts`. Measured before this
 * existed: **4 trips inserted per `npm test`**, accumulating silently, with fixture destinations
 * ("Kyoto", "Legacy town") landing on the memories wall beside real ones.
 *
 * Those tests are not the bug. They exist to test database behaviour — owner claiming, saved
 * places, the fetch cache — and deleting them to make the suite pure would delete the coverage.
 * What was wrong is only *which* database they reached.
 *
 * **`:memory:` rather than a temp file**, because there is then nothing to create and nothing to
 * clean up, and because `node --test` runs each test file in its own process — so every file gets
 * its own empty database instead of sharing one. That is strictly more isolation than the shared
 * file ever gave, which is also why not one test needed changing: they already tolerated whatever
 * rows happened to be lying around.
 *
 * **Set here rather than inline in the `test` script** (`DB_PATH=:memory: node …`), because that
 * form means nothing to Windows `cmd.exe` — the same platform that already broke this one script
 * over quoting, where single quotes round the glob reached Node literally and the suite reported
 * success while running zero tests. `--import` modules are evaluated before the entry point, and
 * the runner passes its `execArgv` down to the child process per test file, so this lands before
 * `db.ts` is ever loaded in any of them.
 *
 * An explicit `DB_PATH` still wins, so a run can be pointed at a real file for a one-off
 * investigation.
 */
process.env.DB_PATH ??= ":memory:";
