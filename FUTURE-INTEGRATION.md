# Future Integration

Ideas that were considered, researched, and **deliberately deferred** — with enough
detail to pick them up later without redoing the research. Nothing here is
committed to a roadmap.

Each entry states what it would take, what it would cost, and an honest verdict.
A deferral is not a rejection: it's a note that the current architecture doesn't
support it cheaply and that no user problem yet justifies the change.

Researched 2026-08-16. **Voice pricing moved twice during 2026 — re-check every
figure below before budgeting against it.**

| Idea | Verdict | Blocked on |
|---|---|---|
| [Voice tour-guide agent](#voice-tour-guide-agent) | Defer — separate product | A streaming LLM client; a real user problem |
| [Multi-agent personas](#multi-agent-personas) | Don't build | Evidence a single call can't hold the constraints |
| [Authentication](#authentication) | Defer — insurance paid | A second user, or deployment |

---

## Voice tour-guide agent

A voice agent that talks the traveler through their itinerary while they walk it,
with the generated plan as context.

### The load-bearing fact: Anthropic has no realtime voice API

Claude's consumer voice mode is a product, not an API surface, and it isn't
speech-native — the July 2026 update added model choice but kept the pipeline
turn-based (listen, think, speak), leaning on an external TTS vendor. Claude
Code's voice mode is dictation into the prompt box, nothing more.

So a voice guide means pairing Claude with **someone else's audio layer**, or
dropping Claude from that path. There is no configuration of the current setup
that gets there.

### Provider landscape

| Option | Architecture | Rough cost | Latency / transport |
|---|---|---|---|
| OpenAI Realtime (`gpt-realtime-2.1`) | True speech-to-speech | ~$0.06–0.11/min (mini: ~$0.02–0.05) | Sub-second; WebRTC in browser |
| Gemini Live (native audio) | True speech-to-speech | ~$0.005/min in, ~$0.018/min out | Cheapest headline; WebSocket native, WebRTC via partners |
| ElevenLabs Agents | Managed STT→LLM→TTS | $0.08–0.12/min, **LLM billed separately**, charged on wall-clock including silence | Managed; best voice quality |
| Deepgram Voice Agent | STT+TTS on one stream, bring your own LLM | $4.50/hr = $0.075/min | Sub-300ms end-to-end |
| Cartesia Sonic 3/3.5 | TTS only — not an agent | ~$5–37 per 1M chars | Claims 40–90ms; independently measured 166–190ms |
| LiveKit Agents / Pipecat | Frameworks, not models | Free (OSS) + provider bills | LiveKit is WebRTC-native and built for scale; Pipecat has the larger plugin catalog and suits prototyping |

The per-minute figures for OpenAI and Gemini are third-party conversions from
token pricing, not vendor-published rates. They swing 3–5× with prompt caching
and with the ratio of talking to listening. Treat them as order-of-magnitude.

### What the browser side would need

Use **WebRTC, not WebSocket**. WebRTC brings jitter buffering, echo
cancellation, packet-loss concealment, and Opus for free; a raw WebSocket means
building all of it.

1. A route handler mints a short-lived **ephemeral token** server-side. The real
   API key never reaches the browser.
2. A client component calls `getUserMedia({ audio: true })` — needs a secure
   context (HTTPS, or `localhost`, which the dev server already satisfies) and a
   user gesture. Must be `"use client"`, no SSR.
3. `RTCPeerConnection` does SDP offer/answer against the provider; the returned
   track attaches to an `<audio>` element.

The deployment payoff: media flows browser↔provider directly, so the server only
mints tokens and a serverless function covers it. A WebSocket design instead
needs a long-lived connection the host has to hold open, which is the harder
thing to deploy.

### The cheap fallback, and why it isn't the product

`SpeechSynthesis` (output) is broadly supported and free. `SpeechRecognition`
(input) is the weak half:

- Chrome/Edge/Opera support it. Safari 14.1+/iOS 14.5+ support it behind
  `webkitSpeechRecognition`. **Firefox has it behind a disabled-by-default flag**
  — effectively unavailable.
- Chrome ships the audio to Google's servers. Worth stating plainly to users.
- Safari **WebView** errors immediately without prompting for the mic, so this
  breaks inside PWAs and native wrappers.
- No barge-in, no VAD tuning, no diarization; synthesis quality is a per-OS lottery.

It demonstrates the idea. It is push-to-talk, not conversation.

### Why this breaks the current architecture

For speech-to-speech, Claude leaves the loop entirely — the audio is never text
you can pipe into a process.

For a pipeline (STT → Claude → TTS), technically nothing stops it, but
`runClaude()` in [`src/lib/claude.ts`](src/lib/claude.ts) spawns the CLI, waits
for a *complete* non-streaming response, and exits. Process startup plus
full-completion latency puts first audio seconds away; conversational voice needs
roughly 500–800ms. Closing that gap means token streaming with sentence-chunked
TTS — an HTTP streaming client, not a one-shot subprocess. That also means the
`llm_traces`/`llm_runs` instrumentation needs a second write path for streamed
calls, since it currently records one row per completed process.

### Verdict

**Defer.** This is a separate integration, not an increment. The cheapest
credible version is Deepgram or ElevenLabs for managed audio with Claude over
streaming HTTP, at roughly $0.08–0.12/min — about **$5–7 for a one-hour walking
tour**, before the LLM bill. That needs a real product reason before it justifies
a second LLM client and a parallel tracing path.

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
- [MDN — SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
