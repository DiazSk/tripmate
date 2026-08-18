import { register } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Lets `node --test` import the app's TypeScript modules directly.
 *
 * Node 22 strips TypeScript types on its own, but its ESM resolver still demands a full specifier —
 * so `import { x } from "../travelTime"` (the style every file in src/ uses, and the style
 * Next/tsc require) throws ERR_MODULE_NOT_FOUND under the test runner. The existing
 * itinerary.test.mjs only got away with it because its subject has no runtime imports.
 *
 * This hook appends the extension Node won't infer, and nothing else: relative specifiers with no
 * extension are retried as `.ts`, then as `/index.ts`. Registered via `--import` in the `test`
 * script, so it affects the test runner only — the dev server and the build never load it.
 */
register(
  `data:text/javascript,
  export async function resolve(specifier, context, next) {
    try {
      return await next(specifier, context);
    } catch (err) {
      if (!specifier.startsWith(".") || /\\.[a-z]+$/.test(specifier)) throw err;
      for (const suffix of [".ts", "/index.ts", ".tsx"]) {
        try {
          return await next(specifier + suffix, context);
        } catch {}
      }
      throw err;
    }
  }`,
  pathToFileURL("./")
);
