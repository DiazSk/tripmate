# React Native mobile app (Android + iOS)

**Status:** approved design, not yet implemented
**Date:** 2026-09-22

## Why

A native SwiftUI iOS app already exists on this branch (`ios/TripMate` + `ios/TripMateKit`,
~16,200 lines of Swift) but there is no Android app. Rather than write a second native app by
hand, or throw away the Swift work, the decision is: **freeze the Swift app as-is (no further
Swift development), and build a new React Native app that covers both Android and iOS going
forward.** The two apps coexist; the Swift app is not deleted.

## What's already built in Swift (parity inventory)

This is the checklist for RN delivery — everything below is a *feature that already works on
iOS* and needs an RN equivalent. Line counts are the existing Swift, as a rough size signal, not
a target.

| Area | Swift files | ~LOC | What it does | RN needs |
|---|---|---|---|---|
| Shell / nav | `AppShell.swift`, `TabBar.swift`, `Chrome.swift`, `PlanSheet.swift`, `PanelMetrics.swift`, `WorldMapView.swift`, `DesignTokens.swift`, `Typography.swift`, `ShellExclusions.swift` | 1,535 | 3-tab shell (Home / Memories / Profile), docked-vs-floating panel over the map above a width threshold, design tokens | Bottom tab navigator, one responsive breakpoint for tablet/foldable width |
| Home / landing | `HomeView.swift`, `LandingContent.swift`, `LandingBands.swift` | 824 | Landing content, entry into the plan wizard | Landing screen + wizard entry |
| Plan wizard | `PlanWizardView.swift`, `PlanStore.swift`, `DestinationSuggest.swift` | 1,764 | Multi-step form (basics → group → preferences), destination autosuggest, drives generation | Multi-step form, destination search-as-you-type against `/api/geocode` or `/api/place-search` |
| Map | `MapSearch.swift`, `AddStopSheet.swift`, `RoutePresentation.swift`, `DayRouteOverlay.swift`, `StopResolver.swift`, `StopAnnotation.swift` | 1,222 | Native map (MapKit, not Cesium/MapLibre) with stop pins + route line per day, add-stop flow, place search on the map | `react-native-maps`, custom markers, drawn polyline per day, same add-stop flow |
| Trips / chat | `TripsListView.swift`, `TripsStore.swift`, `TripDetailView.swift`, `ChatSheet.swift` | 2,113 | Memories + drafts lists, trip detail (days), chat sheet to edit a plan by asking | List/detail screens, chat UI hitting `/api/trip-chat` + `/api/trip-edit` |
| Profile | `ProfileView.swift`, `ProfileStore.swift`, `SaveProfileSheet.swift` | 596 | Traveler profile display + edit (how you travel, interests, food) | Profile screen, same fields |
| Photos | `PlacePhotoStore.swift` | 115 | Place photo fetch/cache for trip cards | Image fetch against `/api/place-photo`, cached |
| Shared logic (`TripMateKit`) | `TripMateAPI.swift`, `PlanDraft.swift`, `TravelerPortrait.swift`, `DayDisplay.swift`, `RouteGeometry.swift`, `Tiers.swift`, `Overlap.swift`, `DaySlotting.swift`, `StopResolution.swift`, `Spend.swift`, `Framing.swift`, `TimeOfDay.swift`, `TripCopy.swift`, `TripsCopy.swift`, `UserAnswers.swift`, `SSEReader.swift`, `AuthSession.swift`, `TokenStore.swift`, `Thinking.swift`, `TripWireModels.swift`, `DestinationCountry.swift`, `DayFit.swift` | 4,135 | The API client, all trip/day/itinerary domain types and formatting logic, streaming (SSE) reader for generation progress, auth/token scaffolding | TS port of the API client + domain types (`mobile/src/api/`); most of this is direct types-and-formatting logic, cheap to port |

**Explicitly out of scope for RN v1** (confirmed with the user): the web's 3D globe
(Cesium/MapLibre), the custom WebGL route arcs, and story mode (narrated camera flights + TTS).
The Swift app already made this same call and shipped a plain native map instead — RN follows
that precedent rather than reopening it.

Total existing Swift to use as the reference: **~12,189 lines** app-side + **4,135** in the
shared kit. This is the amount of already-solved product/UX decision-making RN gets to copy
rather than re-derive — the RN work is a port of *behavior*, not a fresh design pass.

## Architecture

New `mobile/` folder at the repo root, an Expo (TypeScript) app, alongside the existing `ios/`
folder and the Next.js `src/`. No changes to `src/` for the REST surface — RN calls the same
endpoints the Swift app calls (`/api/trips`, `/api/trip-edit`, `/api/trip-chat`, `/api/profile`,
`/api/place-photo`, `/api/geocode`, `/api/place-search`, etc.).

**Tooling:** Expo managed workflow + EAS Build/Update. `expo-secure-store` for whatever the
identity mechanism below turns out to need; `react-native-maps` for the map. No custom native
modules required at this scope.

**State:** plain React Context + hooks, one provider per feature area (Trips, Plan, Profile),
mirroring the Swift app's per-domain `@Observable` store split (`TripsStore`, `PlanStore`,
`ProfileStore`, `PlacePhotoStore`). No Redux/Zustand unless this genuinely falls short.

**Networking:** `mobile/src/api/tripMateApi.ts`, a thin `fetch` wrapper with one function per
`TripMateAPI.swift` method (`listTrips`, `trip(id)`, `createTrip`, `updateTrip`, `editTrip`,
profile get/update, place-photo). Types hand-ported from `src/lib/types.ts` (already camelCase —
a copy, not a redesign).

**Fail-soft:** same idiom as the rest of this codebase — the API layer returns `null` for "the
fetch failed" vs `[]`/`{}` for "fetched fine, nothing found," so a screen can distinguish "search
is busy" from "no results" the way `holidays.ts`/`poiDetails.ts` already do on the web.

### Open risk: anonymous identity

The web scopes trips to an anonymous `owner` cookie minted by `src/proxy.ts` middleware — there
is no login, no accounts, no password anywhere in this product. The Swift app has bearer-token
scaffolding (`AuthSession.swift`, `KeychainTokenStore` in `TokenStore.swift`) but **nothing calls
`.adopt()` anywhere in the app**, and the backend has no `Authorization`-header handling at all —
it is unwired forward-looking scaffolding, not a working mechanism today.

So neither app has actually solved mobile identity yet. For RN:

1. First, test empirically whether the default cookie jar on each platform's `fetch`
   implementation (iOS: NSURLSession-backed; Android: whatever Expo's fetch polyfill uses)
   persists the `Set-Cookie` response from `proxy.ts` across app relaunches, the same way a
   mobile browser would.
2. If it does on both platforms, ship with that — zero new backend work, identical mechanism to
   the web.
3. If it doesn't (most likely to fail on Android), read the `Set-Cookie` header manually on the
   first response, store the value in `expo-secure-store`, and echo it back as a `Cookie` header
   on every subsequent request. This needs no backend change either — `resolveOwnerId()` in
   `src/lib/owner.ts` only cares about the cookie's value, not how it arrived.

This is empirical work in implementation, not a design decision to pre-solve here — flagged so it
isn't silently assumed away.

## Screens / navigation

Bottom tab navigator, three tabs, matching the Swift `AppTab` enum exactly:

- **Home** — landing + plan wizard (basics → group → preferences → generate), streamed
  generation progress via the same SSE mechanism `SSEReader.swift` reads.
- **Memories** (`trips` internally, "Memories" is the label the same way the Swift app's is) —
  saved trips + drafts tabs, trip detail (day list, native map with stop pins + route polyline,
  chat sheet to edit the plan by asking).
- **Profile** — traveler profile display + edit.

## Build / deploy

Expo + EAS Build for both App Store and Play Store; EAS Update for OTA pushes on JS-only changes.

## Testing

Matches this repo's existing "narrow, not small" test philosophy (see `CLAUDE.md`): only pure
logic ported into TS (date/itinerary formatting, day-fit/overlap math mirrored from
`TripMateKit`) gets a unit test. Screens, navigation, and networking are verified by running the
app (Expo Go / simulator), not by a unit test suite.

## Non-goals (for this spec)

- No 3D map, no story mode, no TTS narration — deferred, matching the Swift app's own scope call.
- No new backend endpoints — RN is a new client of the existing REST API.
- No changes to the Swift app or its files.
- No real accounts/login system — the product has none today; RN follows the same anonymous
  model.
