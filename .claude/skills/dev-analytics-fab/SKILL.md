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
