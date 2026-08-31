# Replace Composio's Yelp Search with the Direct Yelp Fusion API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Composio is moving to wallet-based billing on 2026-09-10. `dietaryVenues.ts` is the first of 7 Composio-backed integrations to move off it (decided in brainstorming — see "Bounded path" design in this session). This is sub-project 1 of 7; the other 6 (`flights.ts`, `lodging.ts`, `placeFacts.ts`, `destinationSafety.ts`, `destinationFestivals.ts`, `routeMatrix.ts`) are out of scope here and stay on Composio.

**Architecture:** `runComposioTool("YELP_SEARCH_BUSINESSES", …)` proxied Yelp's own Fusion API and passed its `{businesses: [...]}` response through untouched (confirmed: `distilVenues()` already reads Yelp's native shape). So the fix is narrow — call Yelp Fusion directly with a free-tier API key, same params, same response shape. No distiller changes.

**Tech Stack:** TypeScript, `fetch` with `AbortSignal.timeout` (the pattern already used in `src/lib/pois.ts` for `OPENTRIPMAP_API_KEY`), `node --test` for the existing pure-function tests.

**Spec:** none — this is a bounded task per superpowers:brainstorming (single existing file, no new subsystem). No `docs/superpowers/specs/` file exists for it; treat this plan document as the sole source of requirements.

## Global Constraints

- **Fail-soft house convention:** `null` means "the fetch failed / can't tell," `[]` means "fetched fine, nothing found." `fetchDietaryVenues` must keep returning `null` for a missing key, network error, timeout, or non-ok response — and `[]` only when Yelp responds successfully with zero matching businesses. Do not collapse these.
- **No git commit trailer of any kind.** No `Co-Authored-By`, no "Generated with Claude Code" — this overrides the harness default.
- **`AGENTS.md` is rewritten by `next dev`.** If it shows dirty, commit it with the work.
- **Test files import with an explicit `.ts` extension.** Run with `npm test`, never bare `node --test` (the glob needs double quotes).
- **Do not touch `src/lib/composio.ts` or any of its other 6 callers.** Out of scope for this task.

## File Structure

**Modify:**
| Path | Change |
|---|---|
| `src/lib/dietaryVenues.ts` | `fetchDietaryVenues` calls Yelp Fusion directly instead of `runComposioTool`; drop the now-unused `runComposioTool` import |
| `.env.local.example` | Add `YELP_API_KEY` with a comment matching the `OPENTRIPMAP_API_KEY` style |
| `README.md` | Add a `YELP_API_KEY` row to the degrade-soft key table |

---

### Task 1: Direct Yelp Fusion call in `fetchDietaryVenues`

**Files:**
- Modify: `src/lib/dietaryVenues.ts`
- Modify: `.env.local.example`
- Modify: `README.md`

**Interfaces:**
- No exported signatures change. `fetchDietaryVenues(point: {lat, lon}, dietary: DietaryNeeds | null): Promise<DietaryVenue[] | null>` keeps its exact signature and null/[] contract.
- `distilVenues`, `searchableCategories`, `dietaryNote`, `noOptionsFinding` are untouched — do not edit them.

**Yelp Fusion API, exact values to use:**
- Endpoint: `https://api.yelp.com/v3/businesses/search`
- Auth header: `Authorization: Bearer ${apiKey}` (not a query param)
- Query params: `latitude`, `longitude`, `categories` (comma-joined string, already built by `searchableCategories`), `radius` (meters — pass `AREA_RADIUS_M`, already 1500, well under Yelp's 40000m cap), `limit` (pass `10`, matching the current Composio call's `limit: 10`)
- Response body on success: `{ businesses: [...] }` — same shape `distilVenues` already parses.
- Timeout: `AbortSignal.timeout(10_000)`, matching `src/lib/pois.ts`'s `FETCH_TIMEOUT_MS`.

- [ ] **Step 1: Add the API key env var**

In `.env.local.example`, add a block matching the existing `OPENTRIPMAP_API_KEY` one:

```
# Free tier at https://www.yelp.com/developers (5,000 calls/day). Without this, dietary-matched
# venue suggestions silently degrade to none — generation still works.
YELP_API_KEY=
```

- [ ] **Step 2: Rewrite `fetchDietaryVenues`**

In `src/lib/dietaryVenues.ts`, replace the Composio import and the function body. Remove line 1
(`import { runComposioTool } from "./composio";`). Add a base-URL constant near `TOOL_SLUG` (which
is now unused and should be removed too — nothing else in the file reads it):

```ts
const YELP_SEARCH_URL = "https://api.yelp.com/v3/businesses/search";
const FETCH_TIMEOUT_MS = 10_000;
```

Replace the body of `fetchDietaryVenues`:

```ts
export async function fetchDietaryVenues(
  point: { lat: number; lon: number },
  dietary: DietaryNeeds | null
): Promise<DietaryVenue[] | null> {
  const categories = searchableCategories(dietary);
  if (categories.length === 0) return null;

  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) return null;

  try {
    const url = new URL(YELP_SEARCH_URL);
    url.searchParams.set("latitude", String(point.lat));
    url.searchParams.set("longitude", String(point.lon));
    url.searchParams.set("categories", categories.join(","));
    url.searchParams.set("radius", String(AREA_RADIUS_M));
    url.searchParams.set("limit", "10");

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return distilVenues(data);
  } catch {
    return null;
  }
}
```

Keep the function's existing doc comment above it unchanged — the `null` vs `[]` contract it
describes still holds exactly.

- [ ] **Step 3: Document the key in README**

In `README.md`'s degrade-soft table (the one with `OPENTRIPMAP_API_KEY` and
`NEXT_PUBLIC_CESIUM_ION_TOKEN`), add a row:

```
| `YELP_API_KEY` | No dietary-matched venue examples in generated notes. Generation still works |
```

- [ ] **Step 4: Run the existing tests**

```bash
npm test 2>&1 | tail -15
```

Expected: all pass, unchanged count. `dietaryVenues.test.mjs` only exercises the pure functions
(`distilVenues`, `searchableCategories`, `dietaryNote`, `noOptionsFinding`), none of which changed
behavior — if any of those tests fail, something outside the intended diff moved.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: both clean. `TOOL_SLUG` and the `runComposioTool` import must be fully removed, or lint's
unused-import rule (if configured) or `tsc` will flag it — either way, grep the file for
`composio` and `TOOL_SLUG` before declaring done and confirm zero hits.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dietaryVenues.ts .env.local.example README.md
git commit -m "Call Yelp Fusion directly instead of proxying through Composio

Composio moves to wallet-based billing on 2026-09-10. Composio's
YELP_SEARCH_BUSINESSES tool was passing Yelp's own API response through
untouched, so this is a transport swap, not a data-shape change:
distilVenues() already parses Yelp's native {businesses: [...]} shape.
Same fail-soft contract — missing key, network error, timeout, or a
non-ok response all resolve null; a real empty result stays []."
```
