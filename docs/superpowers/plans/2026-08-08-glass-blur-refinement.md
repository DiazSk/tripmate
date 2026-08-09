# Glass Blur Refinement (Apple Maps Reference) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.glass-itinerary` (the one CSS class shared by every card in the app) match the soft, heavily-blurred frosted-glass character of an Apple Maps sidebar, while keeping our existing teal-navy tint — tuned live on an isolated branch, merged into `zaidswork` only after the user approves it visually.

**Architecture:** This is a single-file CSS tuning pass (`src/app/globals.css`, the `.glass-itinerary` rule) validated entirely through live browser screenshots against the tripmate dev server — there is no unit-testable logic here, so "tests" in this plan are visual-comparison and computed-contrast checks performed in the Claude Browser tool, not a test runner. Git branch isolation (checkpoint commit → new branch → tune → merge-on-approval) wraps the whole pass so `zaidswork` is never left in a half-tuned state.

**Tech Stack:** Next.js (Tailwind v4 + plain CSS in `globals.css`), Framer Motion (unaffected by this change), Claude Browser MCP tools for live verification, git for branch isolation.

## Global Constraints

- Only `.glass-itinerary` in `src/app/globals.css` changes color/blur values. No component markup, no other CSS selector, changes.
- Keep the existing hue: `rgba(15, 23, 42, …)`. Only the alpha value (and blur/saturate) may change — this is not a recolor.
- Per the approved spec, prioritize visually matching the Apple Maps reference over preserving the current contrast floor (white text ~6.6:1 / `--muted` ~4.5:1 against a worst-case bright backdrop). After tuning, spot-check and report legibility — don't pre-constrain the values to avoid ever regressing it.
- All work happens on a new branch (`glass-blur-refinement`) cut from a checkpoint commit on `zaidswork`. Nothing merges back into `zaidswork` without the user's explicit live sign-off.
- `npx tsc --noEmit && npx eslint src` must stay clean (this pass shouldn't touch any `.ts`/`.tsx`, but re-run it after each commit as a safety net since earlier commits in this session show CSS-adjacent edits can drift).

---

### Task 1: Checkpoint the current work and cut the isolated branch

**Files:**
- None modified — this task is git operations only.

**Interfaces:**
- Produces: a new branch `glass-blur-refinement`, checked out, containing all of `zaidswork`'s current work as a committed baseline that Task 2's "before" screenshots are taken from.

- [ ] **Step 1: Confirm what's currently uncommitted on `zaidswork`**

Run: `git status --short`

Expected: the round 1+2 glass-consistency/loader changes from this session — modified `src/app/globals.css`, `src/app/page.tsx`, `src/app/trip/[id]/page.tsx`, `src/app/trips/page.tsx`, `src/components/AppShell.tsx`, `src/components/ItineraryCard.tsx`, `src/components/PlaceDetailPanel.tsx`, `src/components/TierPicker.tsx`, `src/lib/claude.ts`, `src/lib/types.ts`; deleted `src/app/api/container-theme/route.ts`, `src/components/cesium/TripSearchForm.tsx`, `src/components/cesium/UnboxingContainer.tsx`, `src/hooks/useTripState.ts`, `src/lib/containerThemePrompt.ts`; untracked `src/components/cesium/GenerationLoader.tsx`. If the list differs meaningfully from this, stop and check with the user before committing — don't commit unrelated work by accident.

- [ ] **Step 2: Commit the checkpoint on `zaidswork`**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Make glass-over-globe treatment consistent app-wide, rework generation loader

- AppShell: full-bleed globe overlay on every route, not just "/"
- /trip/[id] and /trips: same bounded right-docked glass panel as the
  home page result view, glass-itinerary applied consistently
- Destination form/tier picker: glass-itinerary instead of opaque cards;
  CTA button matches the app's real accent teal instead of a rainbow gradient
- GenerationLoader replaces UnboxingContainer: no LLM-picked per-destination
  theme, 5 distinct drawn icon scenes with real contrast against the map
EOF
)"
```

Expected: commit succeeds, `git status --short` now shows a clean tree.

- [ ] **Step 3: Create and check out the new branch**

```bash
git checkout -b glass-blur-refinement
```

Expected: `git branch --show-current` prints `glass-blur-refinement`. `git log --oneline -3` shows the checkpoint commit from Step 2 at the tip, with `zaidswork` unchanged and still pointing at that same commit (`git log zaidswork -1 --oneline` matches).

---

### Task 2: Capture baseline screenshots before touching any CSS

**Files:**
- None modified.

**Interfaces:**
- Consumes: the running dev server from Task 1's branch.
- Produces: four "before" screenshots (one per surface) kept in context for Task 4's comparison — no files written, just screenshots taken via the Claude Browser tool and inspected in the same session.

- [ ] **Step 1: Restart the dev server clean**

Use the `preview_start` tool with `name: "tripmate-dev"`. If a server is already running from a prior session, stop it first with `preview_stop` and start fresh — this session has repeatedly hit stale-HMR issues after file changes, so don't rely on hot-reload picking up the new branch's state.

- [ ] **Step 2: Screenshot the four `.glass-itinerary` surfaces at today's values**

In the Claude Browser tool:
1. Navigate to `http://localhost:3000`, fill the destination form (any destination/dates/budget), screenshot the form step.
2. Submit to the tier step, screenshot it.
3. Click "Generate itinerary", wait for the real generation call to finish (~60-90s), screenshot the result step (the docked itinerary panel).
4. Navigate to `http://localhost:3000/trips`, screenshot it.
5. Click into any saved trip (or reuse one from a prior session), screenshot `/trip/[id]`.

Expected: five screenshots total, all showing today's `blur(16px)` / `rgba(15, 23, 42, 0.7)` look — this is the "before" reference Task 4 compares against, and also the fallback to revert to if the tuned version turns out worse.

---

### Task 3: Tune `.glass-itinerary`'s blur, saturate, and alpha

**Files:**
- Modify: `src/app/globals.css:122-142` (the `.glass-itinerary` rule)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the tuned `.glass-itinerary` rule that every other task's verification checks against.

- [ ] **Step 1: Make the first pass at heavier blur + saturate**

Replace the current rule:

```css
.glass-itinerary {
  background: rgba(15, 23, 42, 0.7);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
  --foreground: #ffffff;
  --muted: #cbd5e1;
  --card-border: rgba(255, 255, 255, 0.12);
}
```

with:

```css
.glass-itinerary {
  /* Matches an Apple Maps sidebar's frosted-glass character: heavy blur erases
     backdrop detail into soft color blobs, saturate keeps what little color
     bleeds through from looking washed out. Alpha tuned for that same soft/dark
     feel, not for the contrast floor the previous (lighter-blur) version was
     tuned for — see docs/superpowers/specs/2026-08-08-glass-blur-refinement-design.md. */
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(48px) saturate(160%);
  -webkit-backdrop-filter: blur(48px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
  --foreground: #ffffff;
  --muted: #cbd5e1;
  --card-border: rgba(255, 255, 255, 0.12);
}
```

This is a starting point (48px blur, 0.55 alpha, 160% saturate) — not the final answer. The next steps tune it live.

- [ ] **Step 2: Reload and compare against the Apple Maps reference by eye**

Reload each of the four surfaces from Task 2 in the Claude Browser tool (same navigation steps) and screenshot them. Compare side-by-side against the Task 2 "before" shots and against the user's original Apple Maps reference image (soft indistinct color blobs behind the panel, moderately dark). Judge on: does the backdrop read as *soft, blurred color* rather than *recognizable map detail*? Does the panel feel like frosted glass rather than either a clear window (too light/too little blur) or a solid card (too opaque)?

- [ ] **Step 3: Iterate the three values until it reads right**

Adjust `blur()` (range to explore: 32px-64px), `background` alpha (range: 0.45-0.65), and `saturate()` (range: 140%-200%) in `src/app/globals.css`, reloading and re-screenshotting after each change, until the look genuinely matches the reference's softness and darkness. There's no formula for "matches" here — this is a visual judgment call made by looking at the two side by side, not a number to compute. Do this across at least two of the four surfaces (the result-step panel over the globe, and one of `/trip/[id]`/`/trips`) since the backdrop differs enough between "live 3D globe" and "the same globe behind a docked list" that a value tuned on only one might look different on the other.

- [ ] **Step 4: Commit the tuned values**

```bash
git add src/app/globals.css
git commit -m "Tune .glass-itinerary blur/saturate/alpha to match Apple Maps reference"
```

---

### Task 4: Spot-check legibility and report regressions

**Files:**
- None modified (unless Step 3 below finds a real regression — see that step).

**Interfaces:**
- Consumes: the tuned `.glass-itinerary` from Task 3.
- Produces: a legibility verdict (pass, or specific flagged regressions) that Task 5 presents to the user alongside the final screenshots.

- [ ] **Step 1: Compute the new worst-case contrast numbers**

Run this once to get the new numbers (mirrors the WCAG relative-luminance check used earlier this session — adjust the `glass`/`alpha` constants to whatever Task 3 landed on):

```bash
cat << 'EOF' > /tmp/glass-contrast-check.mjs
function lum([r,g,b]){
  const a=[r,g,b].map(v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);});
  return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];
}
function contrast(c1,c2){
  const l1=lum(c1), l2=lum(c2);
  const hi=Math.max(l1,l2), lo=Math.min(l1,l2);
  return (hi+0.05)/(lo+0.05);
}
function blend(glass, alpha, backdrop){
  return glass.map((g,i)=> g*alpha + backdrop[i]*(1-alpha));
}
const glass = [15, 23, 42];
const alpha = 0.55; // <-- set to whatever Task 3 landed on
const white = [255, 255, 255];
const muted = [203, 213, 225]; // slate-300, --muted inside .glass-itinerary
const worstCaseBg = blend(glass, alpha, white);
console.log('effective bg over worst-case white backdrop:', worstCaseBg.map(v => Math.round(v)));
console.log('white text contrast:', contrast(white, worstCaseBg).toFixed(2));
console.log('--muted text contrast:', contrast(muted, worstCaseBg).toFixed(2));
EOF
node /tmp/glass-contrast-check.mjs
```

Expected: prints two ratios. WCAG AA for normal text is 4.5:1. Note whether either ratio dropped below that — this is expected and acceptable per the spec's priority decision (matching the look over the floor), just needs to be reported, not silently ignored.

- [ ] **Step 2: Visually confirm on a genuinely bright backdrop**

In the Claude Browser tool, fly the globe to a bright destination/camera angle (a coastal or snow-covered area tends to be brightest) and screenshot the result-step panel there. Read the actual heading and body text in the screenshot — is it "softer than before but still readable," or "genuinely hard to make out"? This is the real-world check; the Step 1 math gives the worst theoretical case, but the actual 3D-tile imagery is rarely pure white.

- [ ] **Step 3: If something is genuinely unreadable, note it — don't silently fix it**

If Step 2 finds real, hard-to-read text (not just "less crisp than before"), do not revert or adjust Task 3's values yourself — that would override the user's explicit priority decision. Instead, note exactly what's affected (which surface, what backdrop condition) so Task 5 can present it to the user as part of the live review, and let them decide whether to accept it, ask for a small alpha bump, or reject the whole change.

---

### Task 5: Final verification and merge decision

**Files:**
- None modified (Task 3's commit is the only code change; this task is verification + the merge itself).

**Interfaces:**
- Consumes: Task 3's committed CSS change, Task 4's legibility verdict.
- Produces: either a merge commit on `zaidswork` (if approved) or nothing (branch left as-is if not).

- [ ] **Step 1: Run the type-check and lint safety net**

```bash
npx tsc --noEmit && npx eslint src
```

Expected: both clean. This pass only touched CSS, so this should be a no-op check, but run it anyway — it's caught real issues from CSS-adjacent edits earlier this session.

- [ ] **Step 2: Console-error check on all four surfaces**

In the Claude Browser tool, on each of the four surfaces from Task 2, call `read_console_messages` with `onlyErrors: true` (open a fresh tab first if a surface was already loaded before this session's edits, since this session has seen stale buffered console output from pre-restart state). Expected: no errors on any surface.

- [ ] **Step 3: Present the before/after screenshots and Task 4's legibility verdict to the user**

Show the Task 2 "before" and Task 3/4 "after" screenshots side by side for at least the result-step panel and one of `/trip/[id]`/`/trips`, plus whatever Task 4 found about legibility. Ask directly: does this match what they wanted, and should it merge into `zaidswork`?

- [ ] **Step 4a: If approved — merge into `zaidswork`**

```bash
git checkout zaidswork
git merge glass-blur-refinement
```

Expected: fast-forward or clean merge (no conflicts expected — `zaidswork` hasn't moved since Task 1's checkpoint). Confirm with `git log --oneline -5` that `zaidswork` now includes Task 3's commit. Ask the user whether they also want `glass-blur-refinement` deleted (`git branch -d glass-blur-refinement`) now that it's merged, or kept around — don't delete it unasked.

- [ ] **Step 4b: If not approved — leave `zaidswork` untouched**

Do nothing further to `zaidswork`. The `glass-blur-refinement` branch keeps the attempt available for either more tuning (loop back to Task 3) or discarding later at the user's discretion — don't delete or discard anything without them saying so.

---

## Self-Review

**Spec coverage:** Every requirement from the design spec maps to a task — checkpoint-then-branch isolation (Task 1), blur/saturate/alpha tuning on `.glass-itinerary` only with the teal-navy hue preserved (Task 3), prioritizing the visual match while still reporting (not silently fixing) legibility regressions (Task 4), and merge-only-on-approval (Task 5). The spec's four surfaces (form/tier/result, `/trip/[id]`, `/trips`) are explicitly covered in Task 2's baseline and Task 3's cross-surface tuning check.

**Placeholder scan:** No TBD/TODO. The one open-ended element — the exact final blur/alpha/saturate numbers — is explicitly called out as a live visual judgment call in the spec itself (not a plan gap), with a concrete starting point and ranges given so the task isn't just "figure it out."

**Type consistency:** N/A — no new functions, types, or component interfaces are introduced by this plan; it's a single CSS rule and git operations.
