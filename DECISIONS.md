# Design decisions

The calls that shaped TripMate, why each was made, and what it cost. Each one is still in force;
the code it points to is where to look before changing it.

- [Plans are checked against fetched facts](#plans-are-checked-against-fetched-facts)
- [Rules, facts and the ask live in three places](#rules-facts-and-the-ask-live-in-three-places)
- [Meri answers only from evidence](#meri-answers-only-from-evidence)
- [Refusals come before spending](#refusals-come-before-spending)
- [One choke point for every model call, two transports](#one-choke-point-for-every-model-call-two-transports)
- [Each task gets the cheapest model that can do it](#each-task-gets-the-cheapest-model-that-can-do-it)
- [MapLibre by default, Cesium behind the same interface](#maplibre-by-default-cesium-behind-the-same-interface)
- [Day routes are a custom WebGL layer](#day-routes-are-a-custom-webgl-layer)
- [In story mode, the narration is the clock](#in-story-mode-the-narration-is-the-clock)
- [The neural voice is loaded at runtime and runs in a worker](#the-neural-voice-is-loaded-at-runtime-and-runs-in-a-worker)
- [The server saves the plan, not the client](#the-server-saves-the-plan-not-the-client)
- [Accounts are never required](#accounts-are-never-required)
- [External data degrades instead of failing](#external-data-degrades-instead-of-failing)
- [SQLite through libsql, not Postgres](#sqlite-through-libsql-not-postgres)
- [One Expo app for the phone](#one-expo-app-for-the-phone)
- [The build fails if a chunk won't parse](#the-build-fails-if-a-chunk-wont-parse)
- [Two paid integrations are written and switched off](#two-paid-integrations-are-written-and-switched-off)
- [Analytics wait for a yes](#analytics-wait-for-a-yes)

## Plans are checked against fetched facts

**Decision.** The model never plans from memory alone. Before it writes, TripMate fetches the forecast
and daylight for the exact dates, public holidays, OpenStreetMap opening hours and accessibility
tags, and candidate places. After it writes, guardrails check the plan against the same facts:
closed days, legs that don't fit the gap between stops, budget.

**Why.** A plausible itinerary is easy; a correct one is the product. The failures that make an AI
plan useless (a museum shut on Tuesdays, 34°C at 2 pm, two stops an hour apart) are all facts the
model doesn't have.

**Cost.** More requests per plan, and every upstream can fail. That is why the next decisions about
failure exist.

## Rules, facts and the ask live in three places

**Decision.** The planning rules live in a skill file (`.claude/skills/itinerary-planner/SKILL.md`),
the trip's facts in a generated context document with no instructions in it, and the request in
`src/lib/generationPrompt.ts` with no trip data in it.

**Why.** When a plan comes out wrong, the cause is in exactly one place: a rule, a fact or the ask.
Mixing them made every prompt change a guess.

**Cost.** The staged pipeline that follows this emits markdown, while every screen reads a strict-JSON
plan, so the older single-call generator (`/api/itinerary`) still serves travellers until a converter
exists.

## Meri answers only from evidence

**Decision.** A travel question is answered from facts fetched for that question (climate, diet and
cuisine tags, place search, web pages for food questions, the plan itself). The places, months and
sources a traveller sees are rendered from the evidence records the model's ids point at, never from
its prose. One id the evidence doesn't hold replaces the whole answer with an honest "nothing
checked". Visa questions never reach a model; they get the official-source line.
(`src/lib/meriAnswer.ts`, `src/lib/meriEvidence.ts`)

**Why.** A prompt asking a model not to invent things is a request. A renderer that can only show
what was fetched is a guarantee.

**Cost.** One extra, cheap model call per question. A place named in plain prose is still checked by
the prompt alone; that ceiling is stated rather than hidden.

## Refusals come before spending

**Decision.** `/api/trip-edit` runs in a fixed order: spend cap, input caps, a free scope check,
throttle, the model, then a check on the reply. What the planner won't answer lives in
`src/lib/promptScope.ts` and what it won't read in `src/lib/inputLimits.ts`.

**Why.** A refusal that costs nothing shouldn't use up an allowance, so the free check sits before the
throttle. A reply can only be checked after the model has spoken.

**Cost.** Refused turns are cut back out of the stored conversation so they are never replayed.

## One choke point for every model call, two transports

**Decision.** Every model call goes through `runClaude()` in `src/lib/claude.ts`, which writes a trace
row on every outcome: success, error, timeout or a malformed reply. Behind it are two transports with
the same contract: the `claude` CLI (the default) and the Anthropic API (for a deployed server).

**Why.** The CLI serves local development for free under an existing subscription; the API is what a
container without a signed-in CLI needs. Making both indistinguishable to callers kept the switch to
one environment variable, `LLM_TRANSPORT`.

**Cost.** Two envelope shapes in the trace table forever, and a conversation is only ever resumed
under the transport that created it.

## Each task gets the cheapest model that can do it

**Decision.** On the API, anything that writes or judges a whole plan goes to the strong model, and
bounded work against facts that already exist (chat edits, place details, story scripts, Meri's
answers) goes to the cheap one. Model names live only in `src/lib/llmConfig.ts`.

**Why.** Most calls are small and repetitive; paying top rates for them is waste.

**Cost.** Some request options are errors, not no-ops, on the cheaper models, so they are gated by
capability rather than passed through.

## MapLibre by default, Cesium behind the same interface

**Decision.** The map is drawn by MapLibre GL JS with OpenFreeMap tiles and terrain, or by CesiumJS
with Google Photorealistic 3D Tiles. Both implement `src/lib/mapRenderer.ts`, in metres, degrees and
CSS pixels; nothing above it imports either engine. The Map / Satellite toggle keeps the camera where
it was.

**Why.** Measured under a drag, Cesium issued 3.4 times the draw calls of MapLibre (8,706/s against
2,539/s), with a p95 frame time of 25.2 ms against 9.8 ms and five times the network requests. Every
map frame re-blurs the frosted panels above it, so the cheaper engine is the better default.

**Cost.** Two engines to keep working, and conversions inside the MapLibre renderer (its pitch
convention is the opposite of Cesium's).

## Day routes are a custom WebGL layer

**Decision.** On MapLibre the day's route is drawn as translucent tubes by a custom WebGL layer
(`src/lib/maplibreArcLayer.ts`), not a style layer.

**Why.** MapLibre has no elevated-line primitive: every line layer is draped on the terrain, and
extruded polygons across a steep stretch rendered as a staircase of boxes.

**Cost.** Hand-written GL code to maintain.

## In story mode, the narration is the clock

**Decision.** The camera, the voice and the highlighted subtitle all follow one beat index, and a
beat lasts as long as it takes to say (`src/lib/storyMode.tsx`). The camera flies once per beat;
pausing picks the sentence up at the word it stopped on.

**Why.** The tour this replaced stepped on a fixed 6.5-second timer, so the voice talked over a camera
that had moved on. A narrated beat's length is only known when the voice says it has finished.

**Cost.** Speech engines are unreliable in ways that needed handling one by one: dropped utterances,
missing end events, voices that never start, and novelty voices that sing.

## The neural voice is loaded at runtime and runs in a worker

**Decision.** The natural voice is Kokoro-82M in the browser, fetched from a CDN only when a film
starts and run in a worker built from a Blob. It uses WebGPU at full precision, or WebAssembly at
8-bit, and synthesises during the camera's holds rather than its flights. The platform voice
narrates while it downloads and takes over a sentence that fails.

**Why.** Run on the main thread, one sentence blocked the page for 16.9 s; in the worker the worst
stall was 840 ms. Synthesising mid-flight competed with the map for the GPU: 45 frames over 32 ms in
one film, 7 after moving synthesis into the holds. Keeping it out of the bundle also keeps an
embedded WebAssembly runtime away from the minifier (see the build decision below).

**Cost.** An 88–326 MB download, disclosed on screen with a live percentage.

## The server saves the plan, not the client

**Decision.** The server writes a draft trip the moment a plan exists, one row per run per owner. The
stream's first frame is the run id, and a status endpoint lets the phone recover a stream it lost
instead of starting another generation.

**Why.** iOS suspends an app that is left mid-generation. The plan was still written, at full cost,
and the client had been the only thing that would ever save it.

**Cost.** Drafts need sweeping. With no scheduler, unkept drafts are cleared on read after a fixed
number of days.

## Accounts are never required

**Decision.** Clerk authenticates; a UUID owns. A trip made signed out belongs to an anonymous owner,
and signing in moves it, along with saved places and the traveller profile, onto the account. Nothing
below `currentOwner()` knows Clerk exists.

**Why.** A login wall in front of the first plan loses most people before they see what the app does.

**Cost.** Both clients must call the claim route after every sign-in, not just sign-up.

## External data degrades instead of failing

**Decision.** Every fetcher returns `null` for "the fetch failed" and `[]` for "fetched fine, found
nothing", and bundles carry per-field `available` flags. Partial-failure rules live in one place,
`src/lib/reconcile.ts`.

**Why.** An outage at a free community service shouldn't read as "the app is broken", and the
interface needs to tell an outage ("search is busy") from an empty neighbourhood.

**Cost.** Every caller has to handle both shapes.

## SQLite through libsql, not Postgres

**Decision.** Storage is SQLite through `libsql`: a local file in development, or a hosted Turso
database when its URL is set.

**Why.** `libsql` keeps the synchronous API of the driver it replaced, so the swap was two lines
instead of an async port of about 70 functions and their callers. Tests get their own in-memory
database per file.

**Cost.** Schema changes are additive guards run at startup rather than migration files.

## One Expo app for the phone

**Decision.** The phone client is one Expo / React Native app for iOS and Android, talking to the same
REST routes as the web. It replaced an earlier SwiftUI client.

**Why.** One codebase for both platforms, and some pure logic (story pacing, Meri's motion table) is
shared with the web rather than written twice.

**Cost.** iOS-only features (Live Activities, the Now Playing player) still need native modules.

## The build fails if a chunk won't parse

**Decision.** `npm run build` runs `scripts/verify-build.mjs` after `next build` and fails if any
emitted chunk can't be parsed.

**Why.** For months the build reported success while shipping a map chunk no browser could parse: a
dependency embeds its WebAssembly decoder as a string of raw bytes, and the minifier re-encoded it so
that a NUL byte followed by a digit became an illegal escape. Production rendered the whole app with
no globe and no error, in every browser. Development never showed it because it doesn't minify, and
no typecheck, lint or unit test can see a bundler's output. `shims/spz-loader-core.ts` is the fix;
the check is the guard.

**Cost.** A few seconds per build.

## Two paid integrations are written and switched off

**Decision.** Yelp (verified restaurants for a dietary need) and Google Places (the map's search box)
are implemented and tested, and read their keys if set, but run without them.

**Why.** Both are billed per use, and this is a student project.

**Cost.** Without Google Places, search runs on the free Overpass service, which rate-limits exactly
the traffic a search box makes, so it fails across mirrors and says "search is busy" when turned away.
Without Yelp, restaurant names in a stop's notes come from the model, not a lookup.

## Analytics wait for a yes

**Decision.** PostHog loads only after the traveller agrees, replays are masked, and the id sent is an
HMAC of the owner id rather than the id itself.

**Why.** Consent first is the right default, and an owner id should never leave the server.

**Cost.** The content security policy reads PostHog's origins when the server starts, so adding the
key needs a restart.
