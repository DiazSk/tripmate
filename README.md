# TripMate

**Tell it where and when you're going, and it plans the actual days.** Not a list of things to see —
a day-by-day itinerary with times, costs, and a reason each stop is there for *you*, checked against
the weather, opening hours and public holidays for the dates you're actually travelling.

## The problem it's trying to solve

Planning a trip yourself means twenty browser tabs, and the plan that comes out of them is a list of
places with no times on it. Asking an LLM directly gets you a plausible-sounding itinerary that
doesn't know the museum is shut on Tuesdays, that it'll be 34°C at 2pm, or that two of its stops are
an hour apart in opposite directions.

TripMate's bet is that the useful part isn't the prose — it's the constraints. So the generation runs
against real fetched data (forecast and daylight for those exact dates, public holidays, OSM opening
hours and `wheelchair` tags, candidate POIs) and against a stated traveler profile: pace, mobility,
dietary needs, who you're travelling with, whether lodging is already booked.

## Honest status

**This is a working prototype, not a shipped product.** It runs locally, single-user, on a SQLite
file. There's no auth, no hosted deployment, and no payments. As of 2026-08-22 nobody outside the
two-person team has ever reviewed an itinerary it produced — which is the single biggest open
question about it, tracked in [`docs/product-readiness.md`](docs/product-readiness.md).

Output quality is measured rather than asserted: [`docs/itinerary-quality.md`](docs/itinerary-quality.md)
holds a 29-criterion rubric audit and real model-comparison sweeps, including the parts that score
badly and the gaps that are blocked on data nobody publishes for free.

## Running it

Node ≥ 22 is mandatory — `better-sqlite3`'s native binding silently kills the dev server on Node 20
the moment any database route is hit.

```bash
nvm use
npm install
npm run dev
```

Model calls spawn the [`claude` CLI](https://claude.com/claude-code) as a subprocess rather than
using an HTTP SDK, so that needs to be installed and authenticated.

`.env.local` is optional and everything degrades soft without it:

| Variable | Effect if absent |
|---|---|
| `OPENTRIPMAP_API_KEY` | No POI suggestions. Generation still works |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | Globe falls back to free OpenStreetMap raster tiles |
| `BRAVE_API_KEY` | No destination festival/event suggestions. Generation still works |

Weather, geocoding, public holidays and OSM data need no key.

### Accounts

Sign-up and sign-in run on [Clerk](https://clerk.com): email and password with email verification,
an email code, and Apple and Google. Clerk holds the credentials; TripMate keeps only a mapping from
the Clerk user to the anonymous-style owner id that owns the trips (`accounts` in `src/lib/db.ts`).

| Variable | Effect if absent |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | With the secret key, switches accounts on. **Baked in at build**, so it is a Docker build arg, not a runtime variable. Without it `/signin` says accounts aren't set up |
| `CLERK_SECRET_KEY` | Accounts stay off. Runtime-only secret; keep it out of the image |
| `CLERK_WEBHOOK_SIGNING_SECRET` | The `user.deleted` webhook (`/api/webhooks/clerk`) is rejected, so deleting a Clerk user leaves their trips behind |

The mobile app reads `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and the `EXPO_PUBLIC_CLERK_GOOGLE_*`
client ids (web, iOS, Android, plus the iOS URL scheme) from `mobile/.env`.

Without keys, everything works signed out and offline. Signing in locally needs Clerk **development**
keys (the Development instance in the Clerk dashboard) and a network. **Set both Clerk keys or
neither:** with the publishable key alone the sign-in UI mounts while the server stays anonymous,
and the claim after sign-in returns 401. With dev keys set, Clerk's middleware sends a browser's
first document request through a dev-browser handshake with Clerk's servers, so pages cannot load
offline and `verify-hero` and `browser-matrix` need network; curl and the perf scripts are
unaffected. In a development instance a
`+clerk_test` email (for example `you+clerk_test@example.com`) takes the code `424242`, so no real
inbox is involved.

The Swift app in `ios/TripMateKit` is not ported to Clerk; the React Native app in `mobile/` is the
mobile client.

**An account is never required.** You can plan, generate and keep a trip without one — those land
under an anonymous owner cookie, and signing in afterwards moves them, your saved places and your
traveller profile onto the account (`claimAnonymousOwner` in `src/lib/db.ts`). That is why there is
no login wall anywhere in the app.

### Two integrations deliberately not used

`YELP_API_KEY` and `GOOGLE_PLACES_API_KEY` are both read by the code and neither will be set. Both
are paid, and this is a student project — the decision (2026-09-06, Zaid) is to run without them
rather than bill them personally. They are documented here rather than deleted because the code
paths are written, tested and correct; setting either key turns the feature on with no other work.

Each costs something real, and the second one costs more than it looks:

- **Yelp** (`dietaryVenues.ts`) supplied *verified* venue examples matching a dietary need. Without
  it the plan still answers a dietary constraint, but the specific restaurant names in a stop's
  notes are **written by the model rather than looked up** — they are plausible and frequently
  real, and they are not checked against anything. Treat a named venue as a suggestion to verify,
  not as a fetched fact, and say so if anyone asks during a demo.
- **Google Places** (`placeSearch.ts`) was the alternative provider for the map's search box.
  Without it every search goes to Overpass — the free community OSM service, which rate-limits
  exactly the bursty traffic a search box generates and is the least reliable upstream this app
  has. See `src/lib/overpass.ts` for what that costs and how the failover handles it.

## Sharing a plan for review

Any saved trip has a printable, all-days version at `/trip/<id>/print` — plain black-on-white, every
stop labelled `Day N · Stop M`, with a fixed set of review questions at the end. Print to PDF and
send it to someone. The numbering exists so a reviewer can say "day 2, stop 3 is wrong" instead of
"the afternoons felt off".

## Taking a plan with you

A saved trip also has a Download control (`/api/trips/<id>/export`) that produces one self-contained
`.html` file, drawn as a transit line rather than a list — meant for the traveler, not a reviewer, and
built to render identically offline. Photos and the Archivo font subset are inlined as base64 data
URIs; `public/fonts/archivo-latin-var.woff2` (the latin subset of Archivo Variable, taken from Google
Fonts, OFL) is committed for exactly this — the app itself loads Archivo through `next/font/google`,
which leaves nothing readable on disk for the export to reuse.

## Commands

```bash
npm run dev      # next dev (Turbopack)
npm run build    # next build, then verify-build.mjs — fails if any emitted chunk can't be parsed
npm run lint
npm test         # node --test, ~266 tests over pure logic only
npx tsc --noEmit -p tsconfig.json
```

Note that a passing test suite proves less here than usual: it covers only deterministic logic, and
nothing renders, no route boots, no database opens. Verifying a change means exercising routes
against a running dev server too.

## Docs

[`docs/project-crux.md`](docs/project-crux.md) is the index and the rolled-up timeline.
[`CLAUDE.md`](CLAUDE.md) carries the architecture notes and the gotchas worth reading before
changing anything — several of them are load-bearing decisions that look like mistakes until you
know why they're there.
