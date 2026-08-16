# Recovering dev-analytics-fab and floating-widget-ui skills

## Background

Same root cause as the itinerary-planner recovery: `.claude/` was entirely gitignored, so these
two skill files never existed in this checkout and were never backed up anywhere. Unlike
itinerary-planner, neither is loaded at runtime (`loadSkill()` is called only with
`"itinerary-planner"`, confirmed by grepping every call site) — both are referenced only as
historical design rationale, in `LlmTraceFab.tsx:24` and in `docs/frontend.md`/`docs/project-crux.md`.
Nothing breaks in production from their absence; this is a documentation/dev-tooling recovery, not
a bug fix.

Per `docs/project-crux.md:84-85`: `dev-analytics-fab` was the original skill ("a pattern for
picking what belongs in a floating developer/analytics widget based on what an app actually
does"), then its UI-mechanics half was split out into `floating-widget-ui` ("the icon/expand/
collapse/list-detail pattern is identical regardless of what content a given FAB shows, so it's
reusable for non-analytics floating widgets too") because that part is content-agnostic and
reusable. `dev-analytics-fab` now only covers content selection and links to `floating-widget-ui`
for the "how to build it" half.

Both are recoverable with high confidence: `LlmTraceFab.tsx` is a complete, working implementation
built from following both skills, so `floating-widget-ui`'s mechanics are extracted directly from
its real structure rather than guessed at. `dev-analytics-fab`'s selection criterion is generalized
from the actual reasoning `docs/frontend.md`/`docs/project-crux.md` already record for why "LLM/AI
calls" was the one category chosen for this app.

## floating-widget-ui

The reusable UI mechanics — collapsed icon, expanded panel, list/detail view-switching, and the
provider/context-hook pattern that lets other parts of the app open the widget pre-focused. Content
selection is explicitly out of scope (that's `dev-analytics-fab`'s job).

```markdown
---
name: floating-widget-ui
description: The icon/expand/collapse/list-detail UI pattern for a persistent floating widget mounted once in the root layout — used for LlmTraceFab, and reusable for any other floating widget (chat, notifications, help, cart). Covers the collapsed-icon/expanded-panel states, the context-provider API for opening the widget pre-focused from elsewhere in the app, and the view-switching mechanics. Does not cover what content belongs in a widget — see dev-analytics-fab for that decision.
---

# Floating Widget UI

A reusable pattern for a persistent floating widget: a small icon in a fixed corner that expands
into a panel, with list and detail views inside it, mounted once for the whole app rather than
routed to. Extracted from `LlmTraceFab` (`src/components/LlmTraceFab.tsx`) — read that file for a
complete worked implementation of everything below.

## When to use this

Use this pattern when something needs to be reachable from anywhere in the app without taking over
the screen or requiring its own route — a persistent utility, not a page. If what you're building
genuinely needs a full page (its own URL, deep-linkable, the primary thing the user came to do),
this is the wrong pattern.

## Collapsed state: the icon

A fixed-position circular button, one Lucide icon, no label text:
- Position: `fixed bottom-5 right-5 z-50`.
- Size: `h-12 w-12`, `rounded-full`, dark solid background (`bg-stone-900 text-white`), `shadow-lg`.
- Hover: `hover:scale-105` with `transition-transform`.
- Always give it both `aria-label` and `title` describing what it opens (e.g. "Open LLM trace
  viewer") — it has no visible text of its own.
- Animate in/out with `framer-motion`'s `AnimatePresence` + a spring transition: `initial={{
  opacity: 0, scale: 0.6 }}`, `animate={{ opacity: 1, scale: 1 }}`, `exit={{ opacity: 0, scale: 0.6
  }}`, `transition={{ type: "spring", stiffness: 260, damping: 22 }}`.

## Expanded state: the panel

Replaces the icon in the same corner when open (mutually exclusive — never show both at once):
- Position: same fixed corner as the icon (`fixed bottom-5 right-5 z-50`).
- Fixed size, not resizable: pick dimensions that comfortably fit a list and a detail view without
  feeling cramped (`LlmTraceFab` uses `h-[32rem] w-[23rem]`).
- Structure: `rounded-2xl border shadow-2xl` shell, a header bar, then a scrollable body that fills
  the remaining height (`flex-1 overflow-hidden` on the body wrapper, the actual view inside handles
  its own `overflow-y-auto`).
- Header: icon + short title on the left, a single collapse button (`X` icon) on the right, in a
  `flex items-center justify-between` row with a bottom border separating it from the body. The
  collapse button always returns to the icon state — it does not close a "session," it just
  collapses the panel.
- Animate in/out with a spring transition that also moves it slightly up as it appears: `initial=
  {{ opacity: 0, scale: 0.9, y: 16 }}`, `animate={{ opacity: 1, scale: 1, y: 0 }}`, `exit={{ opacity:
  0, scale: 0.9, y: 16 }}`, `transition={{ type: "spring", stiffness: 260, damping: 24 }}`.

## View state and navigation

The panel's body swaps between views by a simple discriminated `view` state (a string union, e.g.
`"list" | "detail"` or more if the widget has more than one kind of detail), not by routing:
- A list view fetches and renders a scrollable list of items; each item is a full-width button that
  switches to a detail view for that item.
- A detail view shows a "← Back to list" link/button at its top-left (an arrow icon + short label),
  which switches `view` back to `"list"` and clears whatever selection state pointed at the detail.
- If a detail view can itself drill into a sub-detail (like `LlmTraceFab`'s run view drilling into
  one step of that run), handle that as local state *inside* that view component rather than adding
  more values to the top-level `view` union — keeps the top-level switch small and each view
  self-contained.
- Key detail views by the id they're showing (`key={selectedId}`): switching to a different item
  should remount the view component fresh rather than trying to reset its internal fetch/selection
  state by hand in an effect. This is simpler and avoids a whole class of stale-state bugs.

## The provider and context hook

Mount one `<XWidgetProvider>` in the root layout, wrapping the app once, so the widget is available
on every page without prop-drilling its open/closed state through the tree:
- The provider owns all the widget's state (`isOpen`, `view`, whatever selection ids the views need)
  and renders the actual floating icon/panel component as a sibling of `children`.
- It exposes a context hook (e.g. `useXWidget()`) with an API scoped to what other parts of the app
  actually need to trigger from outside — typically `openList()`, `open<Item>(id)` for jumping
  straight to a specific item's detail, and `close()`. This is what lets a "View details →" link
  anywhere in the app open the widget pre-focused, instead of navigating to a page that doesn't
  exist for this content.
- The hook throws if called outside its provider (`if (!ctx) throw new Error(...)`) rather than
  silently returning a no-op — a call site that isn't inside the provider is a real bug to catch
  immediately, not something to degrade gracefully.
```

## dev-analytics-fab

The content-selection decision framework, generalized from why "LLM/AI calls" was the one category
chosen for this app.

```markdown
---
name: dev-analytics-fab
description: How to decide what content, if any, belongs in a floating developer/analytics widget for a given app. Covers a catalog of common candidate categories and the criterion for picking one, using this app's actual choice (LLM/AI call traces) as the worked example. For the UI mechanics of actually building the widget once you've picked the content, see floating-widget-ui.
---

# Dev/Analytics Floating Widget: What Belongs In It

A floating widget (see `floating-widget-ui` for how to build one) is cheap to add and easy to
justify for almost anything — that's exactly why it needs a real selection criterion, not just
"we have this data, let's surface it."

## The criterion

Pick a category only if it's genuinely invisible during normal development *and* worth the cost of
surfacing — not merely "data the app happens to have." Two questions decide it:

1. **Is it otherwise invisible?** Can you not already see this by reading the UI, the console, or a
   quick log line — do you have to go dig in a database or a raw log file to know what actually
   happened?
2. **Is it worth surfacing?** Does seeing it help with something that actually costs time or money
   to get wrong — debugging a real failure mode, understanding real latency, or tracking real
   spend? "Interesting to look at" is not the same as "worth a permanent UI element."

If a category fails either question, it doesn't get a widget — a log line, a one-off debug script,
or nothing at all is the right amount of visibility for it.

## Common candidate categories

When deciding, run down categories like these against the criterion above, rather than jumping
straight to whichever one somebody happened to mention:

- **LLM/AI call traces** — prompts, raw responses, timing, tokens, cost. Usually a strong yes: the
  call is a black box otherwise, it's slow, and it costs real money per call.
- **API error logs** — failed requests to third-party services. Often a yes if failures are frequent
  enough to need pattern-spotting, but a simple error-rate metric may cover it without a full widget.
- **Background job status** — queued/running/failed async work. A yes only if jobs run long enough
  or fail often enough that "did it actually finish" isn't obvious from the UI already.
- **Cache/rate-limit stats** — hit rates, remaining quota. Usually not worth a permanent widget
  unless the app is regularly bumping into a real rate limit in practice, not hypothetically.
- **Feature-flag / A/B assignment state** — which variant a session is in. Only worth it if flags
  change behavior in ways that are otherwise silent and hard to reproduce.

This list is a starting point for the comparison, not a checklist to fill — most apps will have a
real yes for at most one or two of these, not all of them.

## Worked example: this app

This app's Claude CLI calls (`runClaude()` in `src/lib/claude.ts`) were the one category that
passed both questions cleanly: every call shells out to a subprocess (invisible unless you inspect
the database), takes tens of seconds to minutes (real latency to understand), and costs real money
per call (real spend to track). A plain REST call to Open-Meteo or OSM, by contrast, fails both
questions — it's fast, free, and its failure mode is already handled inline by the fail-soft
convention (`src/lib/holidays.ts`, `poiDetails.ts`) — so it never became a widget category here,
even though the app makes plenty of those calls too.

That's why this app has exactly one floating widget (`LlmTraceFab`, covering LLM/AI call traces)
and not five. If a future feature adds a second category that genuinely passes both questions —
say, background job processing if the app grows one — that's the point to build a second widget
using `floating-widget-ui`'s mechanics, not to fold unrelated content into the existing one.
```

## Testing

No test framework covers skill content. Verification: both files land at their exact expected
paths (`.claude/skills/floating-widget-ui/SKILL.md`, `.claude/skills/dev-analytics-fab/SKILL.md`)
and get tracked in git (per the earlier `.gitignore` fix that un-ignores `.claude/skills/`). Neither
is loaded via `loadSkill()`, so there's no runtime call to verify against — this is documentation
recovery, confirmed correct by review rather than by exercising running code.
