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

Researched 2026-08-16, extended 2026-08-17. **Voice pricing moved twice during 2026 —
re-check every figure below before budgeting against it.**

| Idea | Verdict | Blocked on |
|---|---|---|
| [Voice tour-guide agent](#voice-tour-guide-agent) | **Building — MVP scoped** | Nothing; design below |
| [Multi-agent personas](#multi-agent-personas) | Don't build | Evidence a single call can't hold the constraints |
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

### Verdict

**Don't build it.** Itinerary generation is a textbook case of the pattern
Anthropic says not to use multi-agent for. A day plan is one coherent artifact
under shared constraints — budget, geography, opening hours, travel time. A
foodie agent and a budget agent writing independently produce conflicts that a
synthesizer then has to reconcile, at ~15× tokens, for output a single
well-prompted call already produces.

The genuinely parallel, breadth-first part of the app — POI research and
enrichment — is **already handled deterministically** by plain HTTP fetches in
`trip-fetch`, which is cheaper and more reliable than agents doing it.

Keep personas as **prompt sections, not agents**: one call, one voice, rules in
[`.claude/skills/itinerary-planner/SKILL.md`](.claude/skills/itinerary-planner/SKILL.md).
Revisit only if evals show a single call can't hold multiple objectives at once —
and if it comes back, the shape is orchestrator-workers over *research*, not over
*writing*.

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
