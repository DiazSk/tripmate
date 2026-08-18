# Future Integration

Ideas that were considered and researched, each with an honest verdict — with enough
detail to pick them up later without redoing the research. Most entries here are
**deliberately deferred**: a deferral is not a rejection, it's a note that the current
architecture doesn't support the idea cheaply and that no user problem yet justifies the
change.

One entry — the voice tour-guide agent — has since been **taken off the shelf and scoped
into an MVP**. Its research is kept here rather than moved, because the constraint that
justified deferring it is real and the design works around it rather than pretending it
went away. Everything else on this page remains uncommitted to a roadmap.

Researched 2026-08-16, extended 2026-08-17, multi-agent revisited 2026-08-18. **Voice pricing
moved twice during 2026 —
re-check every figure below before budgeting against it.**

| Idea | Verdict | Blocked on |
|---|---|---|
| [Voice tour-guide agent](#voice-tour-guide-agent) | **Building — MVP scoped** | Nothing; design below |
| [Multi-agent personas](#multi-agent-personas) | Don't build — re-confirmed 2026-08-18 | A **measured** single-agent baseline showing one call can't hold the constraints |
| [Authentication](#authentication) | Defer — insurance paid | A second user, or deployment |

---

## Voice tour-guide agent

A voice agent that talks the traveler through their itinerary while they walk it,
with the generated plan as context.

**Status: building**, on `feat/voice-tour-guide-mvp`. Deferred 2026-08-16 as "a separate
integration, not an increment"; reopened 2026-08-17 after competitor research reframed
what the thing actually costs and what it has to be.

### What the market actually ships

Researched 2026-08-17. The headline: **no shipped competitor is doing realtime
conversation.** Every product in the category ships pre-generated narration triggered by
GPS, and the "ask it something" surface, where it exists at all, is secondary.

| Product | Shape | Notable |
|---|---|---|
| **iWander** | AI builds a custom tour in ~30s from a prompt; narration **pre-generated**, actor-voiced; 4 guide personalities; 9 languages; full offline | $10/mo unlimited curated + 100 AI-minutes; separate on-demand AI guide via camera/voice/text |
| **Votura** | AI generates route + stops + narration from start point, time budget, transport mode, theme; 500+ cities, 12 languages, offline | Closest structural match to TripMate's output. Audio architecture not disclosed — could not verify pre-gen vs. live |
| **VoiceMap** | Human-authored, podcast-style, GPS-triggered; 600+ destinations, 2,026th tour published early 2026 | Explicitly *labels* where a publisher used an AI tool — human authorship is the position |
| **TalkieWalkie** | GPS-triggered playback at landmarks | Pure trigger-and-play |
| **Rick Steves Audio Europe** | Human, free, personality-driven | Category incumbent; stale catalogue, but the voice carries it |
| **SmartGuide / STQRY** | B2B for museums and venues; STQRY narrates via ElevenLabs | The paying market here is venues, not travelers |

Two structural reads:

**The moat everyone defends is authored narration, not conversation.** VoiceMap's whole
differentiation is that a human local wrote it. iWander pairs actor-voiced curated tours
*with* AI generation and charges for the curated tier. Nobody sells "you can interrupt the
guide and argue with it."

**Google is eating the generic version.** "Ask Maps" (Gemini, rolling out in the US and
India on both platforms since March 2026) plus landmark-aware Immersive Navigation means
"tell me about that building" is becoming a free Maps feature. What *isn't* commoditized is
the asset none of these products have: **the traveler's own generated itinerary** — their
budget, their pacing, their stops, in order. That is the only defensible thing to build a
voice agent on top of, and it is the thing TripMate already produces.

### The load-bearing fact: Anthropic has no realtime voice API

Re-verified 2026-08-17; still true. Claude's consumer voice mode is a product, not an API
surface, and it isn't speech-native — the July 2026 update added model choice but kept the
pipeline turn-based (listen, think, speak), leaning on an external TTS vendor. Claude
Code's voice mode is push-to-talk dictation into the prompt box (`/voice`, ~5% rollout as
of March 2026), nothing more.

So a voice guide means pairing Claude with **someone else's audio layer**. There is no
configuration of the current setup that gets there. The design question is not whether to
add a vendor — it's *how little of the conversation that vendor is allowed to own.*

### Decisions taken (2026-08-17)

| Decision | Chosen | Rejected alternative |
|---|---|---|
| Where the conversation runs | **Managed STT+TTS, Claude stays the brain** | Speech-to-speech (OpenAI Realtime / Gemini Live) with Claude behind tool calls — lower latency, but a second vendor becomes the conversational intelligence |
| MVP surface | **Desk demo, laptop browser** | Real walk on a phone — the actual product, but adds the whole mobile-web minefield (iOS autoplay gates, background audio suspension, mic permission in PWAs) |
| Mutation scope | **Read-only Q&A + spoken edit queue** | Full live editing — an ~84s edit inside a live call is dead air or a confusing partial state |

The first row is the consequential one. Keeping Claude as the brain costs latency and work
versus speech-to-speech, and buys two things: the product's intelligence stays on the model
this codebase is built around, and **every token still passes through a TripMate-owned
choke point that writes a trace row** — the one architectural rule this repo actually
enforces.

### Why the current LLM path cannot do voice, and what changes

Conversation needs first audio in **500–800ms**. The fastest call in the codebase today
takes **84,000ms**. Streaming alone does not close that, and the reason is already measured
in [`src/lib/claude.ts`](src/lib/claude.ts):

- *"time-to-first-token is ~95% of the wall clock"*
- *"~96% of generated tokens are internal reasoning that never reaches the caller"* —
  12.4k output tokens for a 450-token JSON patch
- `--effort low` is the CLI's floor. **There is no way to turn thinking off.**

Streaming a response whose first token arrives at 80s buys nothing. So the fix is not the
transport — it's **leaving the CLI for the HTTP Messages API**, which *can* set
`thinking: {type: "disabled"}` on Haiku 4.5 and delete that 96%. Published Haiku 4.5 TTFT
over HTTP is **~597ms** on short prompts, 610ms median / 843ms p95 on long ones, and
Anthropic measures as the most consistent provider for P50↔P99 spread.

That one substitution is what makes "Claude as the brain" viable. `runClaude()` is
**unchanged** — it keeps serving generation and editing. The voice client is a sibling.

**The second constraint, and the one that makes the whole thing affordable:** the itinerary
already exists before the walk starts. "What's next?", "why this restaurant?", "how far?"
are *context reads, not inference* — the answer is sitting in the prompt prefix. Only
mutations need a planning call, and those keep the existing 84s CLI path, off the
conversational thread.

### Architecture

```
Browser (mic in, audio out)
   │
   ▼
Deepgram Voice Agent ── owns VAD, barge-in, turn-taking, jitter, STT, TTS
   │  POST, OpenAI Chat Completions shape, SSE
   ▼
/api/voice/llm ── our shim: OpenAI wire format ⇄ Anthropic Messages
   │
   ▼
Claude Haiku 4.5 (HTTP, streaming, thinking disabled, cached itinerary prefix)
```

Deepgram is ears and mouth. Claude is the brain. Deepgram's Voice Agent API accepts **any
endpoint conforming to the OpenAI Chat Completions format**, and ships an official
reference proxy for exactly this shape
([deepgram-voice-agent-client-llm-proxy](https://github.com/deepgram-devs/deepgram-voice-agent-client-llm-proxy)).

**Why the custom endpoint and not Deepgram's managed `anthropic` provider.** Deepgram
manages Claude for you, which is less code — and it would hold the conversation, taking
prompt-cache control, `thinking` configuration, and `llm_traces` visibility with it. A
model call that doesn't write a trace row breaks the invariant in
[`src/lib/claude.ts`](src/lib/claude.ts). Not worth it to save a translation layer.

**Why Deepgram and not ElevenLabs.** $4.50/hr flat with BYO-LLM rate reductions and
sub-300ms end-to-end, against ElevenLabs billing on **wall-clock including silence** —
precisely the wrong shape for a walking tour with long quiet stretches.

**Use WebRTC, not a raw WebSocket, for the browser leg.** WebRTC brings jitter buffering,
echo cancellation, packet-loss concealment, and Opus for free; a raw WebSocket means
building all of it. `getUserMedia({ audio: true })` needs a secure context (HTTPS, or
`localhost`, which the dev server already satisfies) and a user gesture, so the component
must be `"use client"` with no SSR. A route handler mints a short-lived **ephemeral token**
server-side; the real key never reaches the browser.

### Latency budget

| Stage | Expected |
|---|---|
| Speech end → final transcript (Deepgram) | 100–300ms |
| Claude TTFT (Haiku 4.5, thinking off, warm cache) | 600–850ms |
| First TTS chunk | 100–200ms |
| **First audio** | **~0.9–1.3s** |

Honest read: that lands *above* the 500–800ms ideal, below the annoyance threshold, and
roughly 65× better than the current path. Two levers if it feels slow in practice —
pre-warm the cache with a `max_tokens: 0` request when the session opens, and let Deepgram
speak a filler acknowledgement while the first tokens land.

### Cost

Deepgram $0.075/min ≈ **$4.50/hr**. Claude adds pennies: a cached prefix reads at ~0.1× and
answers are one to three sentences at Haiku's $1/$5 per MTok. So about **$4.60 for a
one-hour tour** — which confirms the original research's $5–7 estimate *for this
architecture*.

This is the expensive path, chosen deliberately. The cost control that matters is closing
the Deepgram socket on idle and reopening on wake, since billing is connection time.

### Provider landscape

Researched 2026-08-16, re-verified 2026-08-17. **← marks the chosen path.**

| Option | Architecture | Rough cost | Latency / transport |
|---|---|---|---|
| **Deepgram Voice Agent ←** | STT+TTS on one stream, bring your own LLM | $4.50/hr = $0.075/min, BYO-LLM reductions | Sub-300ms end-to-end |
| OpenAI Realtime (`gpt-realtime-2.1`) | True speech-to-speech | ~$0.06–0.11/min (mini: ~$0.02–0.05) | Sub-second; WebRTC in browser |
| Gemini Live (native audio) | True speech-to-speech | ~$0.005/min in, ~$0.018/min out | Cheapest headline; WebSocket native, WebRTC via partners |
| ElevenLabs Agents | Managed STT→LLM→TTS | Bundled minutes per plan (75–12,375), then $0.08/min, **LLM billed separately**, charged on wall-clock including silence | Managed; best voice quality |
| Cartesia Sonic 3/3.5 | TTS only — not an agent | ~$5–37 per 1M chars | Claims 40–90ms; independently measured 166–190ms |
| LiveKit Agents / Pipecat | Frameworks, not models | Free (OSS) + provider bills | LiveKit is WebRTC-native and built for scale; Pipecat has the larger plugin catalog and suits prototyping |

The per-minute figures for OpenAI and Gemini are third-party conversions from token
pricing, not vendor-published rates. They swing 3–5× with prompt caching and with the ratio
of talking to listening. Treat them as order-of-magnitude.

### What gets built

**Phase 0 — the shim, standalone.** `/api/voice/llm` speaking OpenAI Chat Completions over
SSE, backed by streaming Claude. Testable with `curl` alone, no Deepgram account. The whole
risk of the design, isolated and provable first.

**Phase 1 — context and caching.** Build the cached system prefix from a real itinerary;
verify `cache_read_input_tokens` is non-zero across turns; measure real TTFT.

**Phase 2 — the session.** Ephemeral-token route, browser component, Deepgram wired to the
shim. First actual conversation.

**Phase 3 — the edit queue.** Voice tool call → existing `POST /api/trip-edit` → spoken
acknowledgement now, spoken confirmation when it lands seconds later.

**Phase 4 — tracing.** Voice rows in the trace FAB with TTFT and token columns.

### Files and schema

New:

| Path | Role |
|---|---|
| `src/lib/voiceTranslate.ts` | Pure OpenAI ⇄ Anthropic message and chunk mapping. **Type-only imports**, so `voiceTranslate.test.mjs` can cover it — the repo's stated rule for testable modules |
| `src/lib/voiceClient.ts` | Anthropic HTTP streaming client. Thinking disabled, small `max_tokens`, cache breakpoint on the itinerary prefix |
| `src/lib/voiceContext.ts` | Builds the cached prefix. Reuses `buildEditContext()` from [`src/lib/editContext.ts`](src/lib/editContext.ts) rather than re-deriving trip facts |
| `src/lib/voicePosition.ts` | Position source interface plus a desk-demo implementation (step through stops). Keeps real geolocation a later swap, not a rewrite |
| `src/app/api/voice/llm/route.ts` | The shim endpoint |
| `src/app/api/voice/token/route.ts` | Mints the short-lived Deepgram key server-side |
| `src/components/VoiceGuideFab.tsx` | `"use client"`, no SSR. Follows the existing floating-widget pattern — see [`src/components/LlmTraceFab.tsx`](src/components/LlmTraceFab.tsx) |

Modified:

- [`src/lib/claude.ts`](src/lib/claude.ts) — add `"voice"` and `"voice-tool"` to
  `ClaudeCallType`. `runClaude()` itself is untouched.
- [`src/lib/db.ts`](src/lib/db.ts) — extend `llm_traces` through the existing
  `addColumnIfMissing()` guard (house pattern, no migration files): `ttft_ms`,
  `input_tokens`, `output_tokens`, `cache_read_tokens`. Add an `aborted` status for
  barge-in, a real outcome the current `ok`/`error`/`timeout` enum cannot express.
- `src/components/LlmTraceFab.tsx` — surface the new columns.
- `.env.local` — `DEEPGRAM_API_KEY` and `ANTHROPIC_API_KEY`. Both absent must degrade to
  "voice unavailable", matching the `OPENTRIPMAP_API_KEY` fail-soft convention.

### Gotchas

- **Haiku 4.5's minimum cacheable prefix is 4096 tokens.** Below it, caching silently
  no-ops — no error, just `cache_creation_input_tokens: 0`. A short itinerary may not cache
  at all; verify rather than assume.
- **`max_tokens: 0` pre-warming is rejected with `stream: true`.** The warm-up call must be
  non-streaming.
- **`ANTHROPIC_API_KEY` is new to this repo.** Every model call to date went through the
  CLI's own auth; this is the first raw key on the LLM path.
- **Deepgram bills connection time.** Idle sessions cost money.
- **The trace path needs a second write shape.** `llm_traces` records one row per completed
  process; a streamed call has a TTFT and a token count and can be aborted mid-flight.

### The cheaper shape we are deliberately not building

Worth writing down, because it is what the entire market actually ships and it costs ~5×
less.

Generation already produces the text. Add a per-POI narration field, TTS it **once** at
generation time, cache by POI, play back on geolocation. ElevenLabs TTS is $0.05/1k chars
(Flash) or $0.10/1k (Multilingual); a 12-stop tour at ~250 words per stop is ~18,000 chars
→ **$0.90–1.80 for the whole tour**, falling toward zero as popular stops hit cache, since
narration for a landmark is reusable across every traveler who visits it. Browser
`SpeechSynthesis` is free and, for pre-written narration, sufficient — the
`SpeechRecognition` support problems (Firefox behind a disabled flag, Safari WebView
erroring without prompting) are all *input*-side and don't apply.

It needs no streaming client, no second trace path, and no vendor. It is also not a
conversation: it cannot answer "why did you pick this place?" or "I'm tired, what can we
skip?" That's the trade being made, with eyes open.

### Verdict

**Build it, MVP-scoped.** The original deferral was right about the architecture and wrong
about the ceiling: it assumed a conversational Claude meant fighting the 84s path, when the
actual fix is that Claude never needs to be fast for the read-mostly 90% and never needs to
be in the loop for the slow 10%. Deepgram for audio at $4.50/hr, Claude Haiku over
streaming HTTP with thinking off for the brain, ~1s to first audio, read-only plus a queued
edit path, desk demo first.

The honest risk is not technical. It is that no competitor validates conversation as the
thing travelers want, and Google is commoditizing the generic half. The bet is that a guide
which knows *your* itinerary is a different product from one that knows the city — and the
MVP exists to find out cheaply.

---

## Multi-agent personas

Several agents with distinct roles (a food specialist, a budget keeper, a local
guide) collaborating on one itinerary.

Researched 2026-08-16, **revisited 2026-08-18** after a literature and competitor sweep. The
verdict is unchanged. Two of the premises behind it have moved, though, and the sweep turned up
a finding that has nothing to do with agents at all — all three are recorded below the original
research.

### Anthropic's own numbers

From [Anthropic's multi-agent research writeup](https://www.anthropic.com/engineering/multi-agent-research-system):
agents use **~4× the tokens of chat**; multi-agent systems use **~15×**. The
upside is real but scoped — an Opus lead with Sonnet subagents beat single-agent
Opus by 90.2% on their internal *research* eval. Their stated non-fits:

> tasks where all agents need to share the same context, work with heavy
> interdependencies between agents, and most coding tasks

[Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
is blunter: find the simplest solution possible and only add complexity when
needed; optimizing single calls with retrieval and good examples is usually
enough; agentic systems trade latency and cost for task performance.

### Patterns, in ascending complexity

Prompt chaining (sequential decomposition) → routing (classify, then dispatch) →
parallelization (section or vote, then aggregate) → orchestrator-workers (lead
decomposes dynamically, workers execute, lead synthesizes) → evaluator-optimizer
(generator plus critic, worth it only with objective criteria).

Note that TripMate already runs the last one: generate → critique in
[`src/app/api/itinerary/route.ts`](src/app/api/itinerary/route.ts). It works
because "does the total land within 85–100% of budget" is checkable.

### Documented failure modes

Observed by Anthropic in production: subagents spawning 50+ children for simple
queries; several agents duplicating identical work because task division failed;
sequential handoffs creating bottlenecks; degraded source selection. Add the
structural one — **context fragmentation**: a subagent gets a fresh window and
only its delegation prompt, so anything it needs must be restated and its
siblings' conclusions are invisible to it. That is precisely what makes two
personas contradict each other.

### What the tooling would give us

The [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/subagents)
supports this natively — subagents declared in `.claude/agents/*.md`, each with a
fresh context, its own system prompt, a restricted tool list, and a per-agent
model override. Guardrails exist because they're needed: spawn-depth and
concurrency caps, and a budget ceiling.

None of it reaches us. `runClaude()` launches the CLI with `--tools ""`, so the
child has **no Agent tool and cannot delegate**. Any multi-agent design would be
TripMate's own code spawning N subprocesses, paying N× process startup on top of
N× tokens.

### What the 2026 literature adds

Revisited 2026-08-18.

| Source | Finding |
|---|---|
| [Nature Machine Intelligence — *Capable language models can outgrow the benefits of collaboration*](https://www.nature.com/articles/s42256-026-01268-y) | 260 configurations over 6 benchmarks, 5 architectures, 3 model families, holding prompts, tools and compute constant and varying **only** coordination structure. **Single-agent baseline performance is the most robust predictor of whether coordination helps or hurts**, via an empirical *capability-saturation threshold* past which more agents stop paying. It predicts the sign of the effect in **94%** of validation configs on SWE-bench Verified and Terminal-Bench |
| [beam.ai — production orchestration patterns](https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production) | A 3-agent sequential pipeline burns **29,000 tokens against 10,000** for the single-agent equivalent. A 4-agent pipeline accumulates **~950ms of coordination overhead against ~500ms of actual work**. Fan-out conflicts scale **N(N−1)/2**. Orchestrator context overflow is the canonical cost blowup |

The Nature result is the one that changes anything here. It converts "multi-agent is usually
worse" from a rule of thumb into **a predictor you can check before building**: measure the
single-agent baseline first, because past saturation coordination actively degrades the output.
That reframes the original "revisit only if evals show a single call can't hold multiple
objectives" from a hedge into the actual precondition.

### What the travel-planning research does — and it isn't personas

[TravelPlanner](https://osu-nlp-group.github.io/TravelPlanner/) is the field's baseline, and it is
brutal: GPT-4-Turbo with ReAct passes **0.6%** of tasks end-to-end, every other model **0%**. The
failure is not prose quality or taste. It is **hard constraint satisfaction** — and the paper notes
the best agent still loses to plain greedy search on hard constraints.

[TriFlow](https://arxiv.org/html/2512.11271) is the closest published analogue to this codebase and
the most useful reference on the page. Three stages, each narrowing the feasible space:

1. **Retrieval** — decompose the query into structured requirements, then *"parallel modules"*
   fetch flights, distances, restaurants, attractions and accommodation, *"followed by validation
   and deduplication."*
2. **Planning** — city order and time allocation first, details after, through **agent–validator
   loops** of *"suggestion, validation, and normalisation."*
3. **Governance** — each iteration opens with a system report on budget usage, timing consistency
   and preference satisfaction, then constraint checking, then *targeted adjustments* ("replacing
   costly items, resolving timing conflicts, or improving alignment with user preferences").
   **Capped at 8 iterations**, terminating early on convergence.

Its **monotonic feasibility** rule, quoted: *"Once a constraint is satisfied, subsequent steps are
not allowed to violate it. For instance, once the city's order and daily arrangement windows are
fixed, later steps (e.g., selecting restaurants or attractions) must operate within these bounds
rather than revising earlier structural decisions."*

Results: **91.1% final pass** on TravelPlanner (**96.1%** on hard constraints), in **22.6s against
245.7s** for the prior SOTA — a **10.9× speedup**. On TripTailor, **97.7% against 63.3%** for a
workflow baseline.

Read the speedup carefully, because it is the whole lesson. TriFlow is *faster* than the systems it
beats. Adding agents does not make a system faster; **replacing LLM tool-calling loops with
structured retrieval and validation does**. Caveats from reading it properly: the paper does not
disclose whether its validators are rule-based or LLM-driven, runs **no ablations** isolating stage
contributions, and publishes **no token or call-count data**. So the runtime is the reliable number
and the causal attribution is inference.

Three supporting points:

- [OPENPATH](https://arxiv.org/pdf/2606.07486) splits its specialists by **data domain** — transit,
  ADA accessibility, bike-share, routing — each owning a distinct dataset and tool surface. This is
  consistent across every serious system found: decomposition follows *data and tools*, never
  *opinions about the same data*.
- [Is Your LLM-Based Multi-Agent a Reliable Real-World Planner?](https://arxiv.org/pdf/2505.16557)
  finds multi-agent travel planners vulnerable to fraudulent booking sites and prompt injection.
  Worth naming because TripMate's fetches all go to fixed, known endpoints — an under-appreciated
  security property that a tool-using worker fleet would hand away.
- [TravelBench](https://arxiv.org/pdf/2512.22673) evaluates multi-turn tool-using travel tasks
  across GPT-5.1, Gemini 3, DeepSeek R1, Qwen 3 and Kimi K2. Its dominant failures are inconsistent
  tool selection and **requirements lost across turns** — the context-fragmentation mode named
  above, measured.

### What competitors actually ship

**Expedia is the loudest data point, and it cuts both ways.** They deprioritized **Romie**, their
all-in-one AI concierge, having concluded the end-to-end concierge concept wasn't practical, and
pivoted to a **"multi-agentic" architecture of specialized agents** — then acquired
[Layla](https://skift.com/2026/07/31/expedia-acquired-ai-trip-planner-layla-exclusive/) in July 2026
(~25 people, ~€5M raised) for the conversational planning tech and the team. Their framing is
**"point agents"**: small specialists that assist at *specific stages of the journey* — inspire,
plan, book, support — with differentiation staked on trust, first-party traveler data, real
bookable inventory and hallucination safeguards. They are also shipping an **MCP server** giving
partner agents direct inventory access.

Note where they cut. **Along the trip lifecycle, not inside one itinerary generation.** Nobody is
fanning personas out onto a single document.

**Everyone else discloses nothing about topology, and their news is about inventory.** Mindtrip
(11M+ POIs) led 2026 with agentic *flight booking* built on a
[Sabre and PayPal partnership](https://investors.sabre.com/news-releases/news-release-details/mindtrip-launches-travels-first-all-one-agentic-ai-flight);
its public technical description stops at "LLMs, NLP, and a proprietary knowledge base." Layla
pulls live Skyscanner and Booking.com pricing. Wonderplan is free, no signup, no booking. Kayak AI
is a chat-based agentic testbed. Booking Holdings has announced frameworks without dates.

The read for TripMate: **agent topology is not a differentiator anyone is selling.** The market's
axis is bookable inventory and payments — which this app deliberately doesn't have. That is the
same conclusion the voice research reached from the other direction.

### Two premises that have moved

**Parallel fan-out is not N× latency here.** The original objection — N× process startup on top of
N× tokens — holds for *sequential* chains and not for parallel ones.
[`src/lib/claude.ts`](src/lib/claude.ts) records a correlation between prompt size and duration of
**r = 0.132** across a 6× range of prompt sizes: *"essentially none; the variance is fixed overhead
(CLI start, time to first token), not output size."* If duration is dominated by fixed overhead, N
subprocesses spawned concurrently should land near the wall clock of one. Token cost is still N×,
and this is expectation rather than measurement — API-side rate limits could re-serialize it.

**The voice MVP deletes the objection outright.** `src/lib/voiceClient.ts` introduces an Anthropic
Messages API client with `thinking` disabled and ~600ms TTFT. Once it exists, a worker call costs
about a second instead of about two minutes, and "N× CLI cold start" stops being an argument
against anything. This is the largest change to the premises since the original verdict, and it
arrives as a side effect of unrelated work.

Three things in the codebase would break under concurrent LLM calls, all small and all worth
knowing before anyone tries:

- No concurrency limiter exists anywhere — no `p-limit`, no semaphore, nothing bounding spawned
  subprocesses.
- `runs.ts` computes a run's duration as the **sum** of its step durations, which stops meaning
  anything once steps overlap.
- [`src/lib/db.ts`](src/lib/db.ts) orders run steps by **`rowid`**, on the stated assumption that
  synchronous single-connection inserts preserve true order. Concurrent workers would make that
  reflect insert time, not completion order.

### The finding that isn't about agents

TriFlow's governance stage — the thing its 96.1% hard-constraint pass rate comes from — **already
exists in this repo**. It is the bench's deterministic scorers in `src/lib/bench/scorers/`:

- opening hours and closed days (`domain.ts`, OSM-syntax parser, returning null for *unchecked*
  rather than a false pass)
- daylight against real sunrise/sunset, pace, walk-leg caps, rest breaks (`domain.ts`)
- window overlaps and a 14h waking budget (`scoreFeasibility`)
- route quality against an **exact shortest open Hamiltonian path** — Held-Karp — plus meal
  proximity and downtime slack (`route.ts`)
- weather alignment for outdoor stops on adverse days (`context.ts`)

Production uses none of it. [`src/app/api/itinerary`](src/app/api/itinerary/route.ts) guards
generation with an **LLM critique** that costs p50 58s / p90 75s and, on the old 90s ceiling, was
**failing 35% of the time** — 7 of 20 calls, every one dying at exactly the cap. The staged
markdown path has no critique at all. So the validator isn't missing; it is **offline, dev-only,
and pointed at the wrong path.** It grades models rather than guarding trips.

Two caveats keep this honest before anyone picks it up:

- **Budget compliance is not deterministically measured anywhere.** The 85–100% band is prompt text
  only, enforced by that same critique. The bench's `scoreBudget` prices stops from an assumed
  table, excludes lodging and flights, and **has no lower bound** — it returns 1.0 whenever the
  estimate is at or under budget, so a plan spending 20% of it scores perfectly. It is deliberately
  excluded from the composite. Root cause: the staged path carries no prices at all.
- **Travel-time feasibility partly trusts the model.** `scoreFeasibility` uses the model's *own
  stated* travel minutes, so a model that understates travel is rewarded. Everything else is
  haversine × 1.3 at fixed modal speeds. There is no routing ground truth.

### Could we even measure the baseline the Nature result demands?

Mostly, yes. `src/lib/bench/` already isolates exactly one `runClaude()` call with skill, context
digest and prompt held constant, across **6 frozen fixtures** that deliberately span the
degraded-input paths, persisting per-violation detail strings. That is a real single-agent baseline
harness. Four gaps stand between it and a number you could compare anything against:

1. **No repetition, therefore no variance.** One cell per (fixture, model), and
   `listLatestBenchResults()` aggregates `MAX(rowid)` only, so re-runs overwrite rather than
   accumulate. Any multi-agent delta would be indistinguishable from run-to-run noise. Biggest gap,
   smallest fix.
2. **Only the model varies.** No prompt, effort or thinking-budget axis exists, so "baseline at
   effort X" isn't expressible.
3. **No results are durable.** Nothing is checked in; `tripmate.db` is gitignored, so a baseline
   lives in one developer's local SQLite.
4. **No golden itineraries.** Every scorer is a property check against the fixture's own facts, so
   nothing catches a plan that is systematically wrong but internally consistent.

### Verdict

**Still don't build it** — and the 2026 evidence strengthens rather than softens the original call.
Itinerary generation remains the textbook case Anthropic says not to use multi-agent for, the
travel-planning literature decomposes by *data domain* and never by persona, and no competitor
sells its orchestration graph. The Nature capability-saturation result adds the precondition that
was previously only implied: **measure the single-agent baseline before adding coordination**,
because past the threshold coordination makes things worse, and that prediction holds 94% of the
time.

What changed is narrower and worth carrying forward. The cost model was wrong in one direction —
*parallel* fan-out is roughly latency-neutral here because fixed overhead dominates — and it is
about to stop mattering anyway once the voice MVP's HTTP client lands. So if this ever comes back,
the shape is orchestrator-workers over **days or research**, never over writing, and the three
concurrency assumptions above need fixing first.

The more useful thing this sweep found has nothing to do with agents: the deterministic constraint
checking that published SOTA relies on is already written here, sitting in the bench where no trip
ever benefits from it, while production leans on a critique with a known silent failure rate. That
is a lead worth its own investigation, not a multi-agent design.

---

## Authentication

The app has no users, no sessions, and a single SQLite file at the repo root.
Every trip and every trace belongs to whoever is running the dev server.

### Why it's deferred

Adding hosted auth today means an external service dependency, API keys, proxy
middleware, and a network hop on every request — to gate a single-player app on
localhost. That's building the account system before the product.

### Why one column gets paid anyway

There is an asymmetry worth naming, because it cuts the opposite way from the
"don't abstract the LLM vendor" call elsewhere in this project.

Swapping LLM vendors later is cheap: `runClaude()` is the single choke point
every model call already goes through, so it's one file's internals. Retrofitting
**ownership** is not. Once profile and trip rows exist without an owner, adding
one means a data migration plus touching every query that reads them.

Insurance is worth buying where the retrofit is expensive, and only there. So the
traveler-profile table carries `owner_id TEXT NOT NULL DEFAULT 'local'` from day
one. Real auth later fills it with a real subject id and nothing restructures.
That is a column with a default, not an interface with one implementation.

### Options when it's actually needed

| Option | Shape | Trade-off |
|---|---|---|
| **Clerk** | Hosted; sign-in UI provided | Fastest to working auth, strongest App Router support. External dependency, per-MAU pricing, keys in `.env.local` |
| **Better Auth** | Self-hosted, TS-native | Sessions live in the same SQLite file, no external service. You own password and session security |
| **Auth.js (NextAuth v5)** | Self-hosted, adapter-based | Largest provider catalog and most prior art. Heavier configuration; the SQLite adapter needs wiring |

Note for whoever picks this up: Next.js 16 renamed `middleware` to `proxy`, so
auth guides written against 14/15 will name a file that no longer exists.

### Migration path

1. Pick a provider; it supplies a stable subject id per user.
2. Replace the `'local'` default with that subject id on write.
3. Backfill existing rows to the first real account, or leave them as `'local'`
   and treat that as a legacy single-user bucket.
4. Add `owner_id` to `trips` the same way, and filter reads by it.

No table is dropped and no query is restructured — which is the whole point of
paying for the column early.

### Verdict

**Defer.** Revisit when the app is deployed somewhere other than localhost, or
when a second person needs their own trips. Neither is true today.

---

## Sources

- [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic — Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Claude Agent SDK — Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- [OpenAI — Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [ElevenLabs — Conversational AI pricing](https://elevenlabs.io/blog/we-cut-our-pricing-for-conversational-ai)
- [ElevenLabs — API pricing](https://elevenlabs.io/pricing/api)
- [MDN — SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)

Added 2026-08-17 for the voice MVP:

- [Deepgram — Voice Agent LLM models (custom / OpenAI-compatible endpoints)](https://developers.deepgram.com/docs/voice-agent-llm-models)
- [Deepgram — Voice Agent API](https://deepgram.com/product/voice-agent-api)
- [deepgram-voice-agent-client-llm-proxy](https://github.com/deepgram-devs/deepgram-voice-agent-client-llm-proxy)
- [Anthropic — Reducing latency](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency)
- [Artificial Analysis — Claude Haiku 4.5 provider benchmarks](https://artificialanalysis.ai/models/claude-4-5-haiku/providers)
- [LLM API latency benchmarks 2026](https://www.kunalganglani.com/blog/llm-api-latency-benchmarks-2026)
- [Claude Code — voice dictation](https://code.claude.com/docs/en/voice-dictation)
- [Google — Ask Maps and Immersive Navigation](https://blog.google/products-and-platforms/products/maps/ask-maps-immersive-navigation/)
- [iWander](https://iwander.io/) · [Votura](https://votura.app/) · [VoiceMap](https://voicemap.me/) · [SmartGuide](https://www.smartguide.app/) · [STQRY — AI-powered tours](https://www.stqry.com/blog/how-to-create-an-ai-powered-tour-in-2026/)

Added 2026-08-18 for the multi-agent revisit:

- [Nature Machine Intelligence — Capable language models can outgrow the benefits of collaboration](https://www.nature.com/articles/s42256-026-01268-y) ([MIT Media Lab listing](https://www.media.mit.edu/publications/capable-language-models-can-outgrow-the-benefits-of-collaboration/))
- [beam.ai — Multi-agent orchestration patterns for production](https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production)
- [TravelPlanner benchmark](https://osu-nlp-group.github.io/TravelPlanner/) · [arXiv 2402.01622](https://arxiv.org/pdf/2402.01622)
- [TriFlow — progressive multi-agent framework for trip planning (arXiv 2512.11271)](https://arxiv.org/html/2512.11271)
- [OPENPATH — supervisor/specialist urban trip planning (arXiv 2606.07486)](https://arxiv.org/pdf/2606.07486)
- [Is Your LLM-Based Multi-Agent a Reliable Real-World Planner? (arXiv 2505.16557)](https://arxiv.org/pdf/2505.16557)
- [TravelBench — beyond itinerary planning (arXiv 2512.22673)](https://arxiv.org/pdf/2512.22673)
- [Skift — Expedia acquired Layla](https://skift.com/2026/07/31/expedia-acquired-ai-trip-planner-layla-exclusive/) · [Forbes — Expedia's agentic design](https://www.forbes.com/sites/peterhigh/2026/05/29/how-expedia-is-reinventing-travel-through-ai-and-agentic-design/) · [hospitality.today — from all-in-one chatbots to specialized agents](https://www.hospitality.today/article/expedia-shifts-from-all-in-one-ai-chatbots-to-specialized-travel-agents)
- [Sabre — Mindtrip agentic flight booking](https://investors.sabre.com/news-releases/news-release-details/mindtrip-launches-travels-first-all-one-agentic-ai-flight) · [Mindtrip](https://mindtrip.ai/team)
