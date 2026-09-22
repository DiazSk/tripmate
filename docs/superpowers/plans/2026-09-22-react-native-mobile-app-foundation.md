# React Native Mobile App — Foundation & Read Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new `mobile/` Expo app, port the API client and domain types from the
Swift reference, and ship a working read-only vertical slice — Memories list, trip detail (no
map yet), Profile view — talking to the real backend.

**Architecture:** Expo (TypeScript, default template — file-based routing via `expo-router`, not
hand-wired React Navigation; the default template ships this for free, which is the lazier
correct choice than wiring `@react-navigation/native` by hand). One thin `fetch` wrapper per
domain, plain TS interfaces ported from the Swift wire models (which themselves mirror
`src/lib/types.ts`), no state library beyond React Context.

**Tech Stack:** Expo SDK (latest), TypeScript, `expo-router`, `expo-secure-store`, Jest +
`jest-expo` for the pure-logic unit tests.

**Spec:** [docs/superpowers/specs/2026-09-22-react-native-mobile-app-design.md](../specs/2026-09-22-react-native-mobile-app-design.md)

## Global Constraints

- No changes to `src/` or `ios/` — this plan only creates files under a new `mobile/` folder.
- No 3D map, no story mode, no TTS — out of scope per the spec.
- No login/signup screens — this product has no accounts; identity is the anonymous
  owner-cookie mechanism the web already uses.
- Fail-soft: an API function returns `null`/`undefined` for "the fetch failed," and `[]`/`{}` for
  "fetched fine, nothing found" — never conflate the two.
- Types and endpoint shapes here are taken verbatim from the existing Swift reference
  (`ios/TripMateKit/Sources/TripMateKit/TripWireModels.swift`, `PlanDraft.swift`,
  `TripMateAPI.swift`), which itself mirrors `src/lib/types.ts` — do not invent fields.

## Scope note (read before starting)

The full spec covers Home/wizard, map, chat, photos, profile-edit, and EAS deploy. Building all
of that as one plan means either skipping real code for most of it or writing a plan too large to
review. This plan is **foundation + the first working vertical slice** (Memories list → trip
detail → Profile, all read-only) — a real, demoable app end to end. Each of the following ships
as its own follow-up plan once this one is merged and its pattern is proven:

- Map on trip detail (`react-native-maps`, stop pins, route polyline)
- Plan wizard + streamed generation (replaces the Home placeholder this plan ships)
- Chat / edit-by-asking on a trip
- Place photos on trip cards
- Profile editing (this plan is view-only)
- EAS Build/Update configuration

---

## Task 1: Scaffold the Expo app

**Files:**
- Create: `mobile/` (via `create-expo-app`, default template)
- Modify: `mobile/package.json` (add test script)
- Create: `mobile/jest.config.js`

**Interfaces:**
- Produces: a bootable Expo app at `mobile/`, `npm test` runs Jest inside it.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/zaidshaikh/GitHub/tripmate
npx create-expo-app@latest mobile
cd mobile
npx expo install jest-expo jest @types/jest --save-dev
```

- [ ] **Step 2: Wire the test script**

Edit `mobile/package.json`, add under `"scripts"`:

```json
"test": "jest"
```

Add at the top level:

```json
"jest": {
  "preset": "jest-expo"
}
```

- [ ] **Step 3: Write one trivial test to prove the harness works**

Create `mobile/src/sanity.test.ts`:

```ts
test("jest is wired up", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 4: Run it**

Run: `cd mobile && npm test`
Expected: PASS, 1 test.

- [ ] **Step 5: Verify the app itself boots**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors (default template is already typed clean).

- [ ] **Step 6: Commit**

```bash
cd /Users/zaidshaikh/GitHub/tripmate
git add mobile
git commit -m "Scaffold the Expo app for the RN mobile client"
```

---

## Task 2: Domain types

**Files:**
- Create: `mobile/src/api/types.ts`
- Test: none — pure interface declarations have no runtime behavior to test (YAGNI: a test
  asserting an interface's shape only re-states the interface).

**Interfaces:**
- Consumes: nothing.
- Produces: every type below, imported by Task 3 onward — `TripSummary`, `Trip`, `Itinerary`,
  `DayPlan`, `Stop`, `Lodging`, `DayWeather`, `TravelerProfile`, `PlacePhoto`.

- [ ] **Step 1: Write the types, ported field-for-field from the Swift wire models**

Create `mobile/src/api/types.ts`:

```ts
export type StopCategory = "food" | "entry" | "transit" | "other";
export type TierId = "budget" | "midrange" | "luxury";
export type TripStatus = "draft" | "saved";

export interface Stop {
  name: string;
  lat: number;
  lng: number;
  cost: number;
  note: string;
  why?: string;
  time: string;
  durationLabel: string;
  tags?: string[];
  category: StopCategory;
  actualCost?: number;
}

export interface Lodging {
  name: string;
  cost: number;
  note: string;
  actualCost?: number;
}

export interface DayWeather {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  historical: boolean;
  precipitationProbability?: number;
  humidity?: number;
  weatherCode?: number;
  sunrise?: string;
  sunset?: string;
}

export interface DayPlan {
  // Date-only ISO string ("2026-09-19"). Never format with a local-timezone formatter — parse
  // with the UTC accessors, or it rolls back a day anywhere west of Greenwich.
  date: string;
  weather: string;
  weatherDetail?: DayWeather;
  summary?: string;
  title?: string;
  lodging?: Lodging;
  stops: Stop[];
}

export interface Itinerary {
  tier?: TierId;
  days: DayPlan[];
}

export interface TripSummary {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  status?: TripStatus;
}

export interface Trip {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  status?: TripStatus;
  itinerary: Itinerary;
  userAnswers: unknown | null;
  chatSessionId: string | null;
}

export type GroupType = "solo" | "couple" | "family" | "friends" | "other";
export type ExplorerStyle = "planner" | "spontaneous" | "mixed";
export type EnergyLevel = "relaxed" | "moderate" | "packed";
export type CrowdPreference = "quiet" | "mixed" | "lively";

export interface DietaryNeeds {
  tags: string[];
  note: string;
}

export interface TravelerProfile {
  group: GroupType;
  explorerStyle: ExplorerStyle;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  priorities: string[];
  topPriorities: string[];
  dietary: DietaryNeeds;
}

export interface PlacePhoto {
  thumbnailUrl: string | null;
  imageUrl: string | null;
  extract: string | null;
}
```

> `UserAnswers` (the wizard's write shape, 20 optional fields in `UserAnswers.swift`) is left as
> `unknown` on `Trip` for this plan — nothing in the read-only slice inspects it. The wizard plan
> ports it in full when it needs to *write* one.

- [ ] **Step 2: Commit**

```bash
cd /Users/zaidshaikh/GitHub/tripmate
git add mobile/src/api/types.ts
git commit -m "Port trip/profile domain types from the Swift wire models"
```

---

## Task 3: API base URL + session (identity) wrapper

**Files:**
- Create: `mobile/src/api/config.ts`
- Create: `mobile/src/api/session.ts`
- Test: `mobile/src/api/session.test.ts`

**Interfaces:**
- Consumes: `expo-secure-store`.
- Produces: `apiBaseUrl: string`, `fetchWithSession(path: string, init?: RequestInit): Promise<Response>` — every method in Task 4 goes through this instead of raw `fetch`.

- [ ] **Step 1: Base URL config**

Create `mobile/src/api/config.ts`:

```ts
import { Platform } from "react-native";

// EXPO_PUBLIC_API_BASE_URL overrides everything — set it in mobile/.env for a physical device
// or a deployed backend. The defaults below are dev-only fallbacks: the Android emulator's
// loopback to the host machine is 10.0.2.2, never localhost — that is an emulator quirk, not
// a bug in this file.
const DEV_DEFAULT = Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";

export const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? DEV_DEFAULT;
```

- [ ] **Step 2: Write the failing test for the session wrapper**

Create `mobile/src/api/session.test.ts`:

```ts
import * as SecureStore from "expo-secure-store";
import { fetchWithSession } from "./session";

jest.mock("expo-secure-store");

const mockedGet = SecureStore.getItemAsync as jest.Mock;
const mockedSet = SecureStore.setItemAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockResolvedValue(null);
  (global as any).fetch = jest.fn();
});

test("sends a stored cookie on the request when one was saved", async () => {
  mockedGet.mockResolvedValue("owner=abc123");
  (global.fetch as jest.Mock).mockResolvedValue(new Response("{}", { status: 200 }));

  await fetchWithSession("/api/trips");

  const [, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(init.headers["Cookie"]).toBe("owner=abc123");
});

test("stores a Set-Cookie header from the response for next time", async () => {
  const headers = new Headers();
  headers.set("set-cookie", "owner=fresh456; Path=/; HttpOnly");
  (global.fetch as jest.Mock).mockResolvedValue(new Response("{}", { status: 200, headers }));

  await fetchWithSession("/api/trips");

  expect(mockedSet).toHaveBeenCalledWith("tripmate.session.cookie", "owner=fresh456; Path=/; HttpOnly");
});

test("sends no Cookie header when nothing has been stored yet", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(new Response("{}", { status: 200 }));

  await fetchWithSession("/api/trips");

  const [, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(init.headers["Cookie"]).toBeUndefined();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd mobile && npm test -- session.test.ts`
Expected: FAIL — `Cannot find module './session'`

- [ ] **Step 4: Implement the session wrapper**

Create `mobile/src/api/session.ts`:

```ts
import * as SecureStore from "expo-secure-store";
import { apiBaseUrl } from "./config";

const COOKIE_KEY = "tripmate.session.cookie";

// The backend scopes trips to an anonymous `owner` cookie (src/proxy.ts) — there is no login on
// this product, on web or on the existing Swift app. Whether each platform's fetch persists that
// cookie automatically across launches like a browser would is unverified; this wrapper does not
// assume it does. It reads the cookie back manually and echoes it forward itself, which is
// correct whether or not the platform *also* handles it — a double-send of the same cookie value
// is a no-op for the server.
export async function fetchWithSession(path: string, init: RequestInit = {}): Promise<Response> {
  const stored = await SecureStore.getItemAsync(COOKIE_KEY);
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (stored) headers["Cookie"] = stored;

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) await SecureStore.setItemAsync(COOKIE_KEY, setCookie);

  return response;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd mobile && npm test -- session.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/zaidshaikh/GitHub/tripmate
git add mobile/src/api/config.ts mobile/src/api/session.ts mobile/src/api/session.test.ts
git commit -m "Add the anonymous-owner session wrapper for the mobile API client"
```

> **Manual verification, once, on a real device/simulator against a running `npm run dev`:**
> open the app, load Memories (Task 6), kill and relaunch the app, load Memories again. If the
> same trips still show up, the cookie survived — the wrapper above is doing its job either
> alongside or instead of the platform's own jar. If trips disappear (a fresh owner id was
> issued), the `Set-Cookie` value itself is being dropped somewhere between platforms, which is
> the one real risk called out in the spec — stop and look at `response.headers.get("set-cookie")`
> directly on that platform before writing any more screens.

---

## Task 4: API client — trips + profile

**Files:**
- Create: `mobile/src/api/tripMateApi.ts`
- Test: `mobile/src/api/tripMateApi.test.ts`

**Interfaces:**
- Consumes: `fetchWithSession` (Task 3), types from `./types` (Task 2).
- Produces: `listTrips(status?: TripStatus): Promise<TripSummary[] | null>`,
  `getTrip(id: string): Promise<Trip | null>`, `getProfile(): Promise<TravelerProfile | null | undefined>` —
  used by every screen task below. Return convention: `undefined` means "the fetch itself failed,"
  `null` means "the server said there is nothing" (a real, meaningful answer for profile — see
  `PlanDraft.swift`'s comment that a fresh install has no profile row yet), `[]` means "fetched
  fine, no trips."

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/api/tripMateApi.test.ts`:

```ts
import { listTrips, getTrip, getProfile } from "./tripMateApi";

jest.mock("./session", () => ({ fetchWithSession: jest.fn() }));
import { fetchWithSession } from "./session";
const mockedFetch = fetchWithSession as jest.Mock;

beforeEach(() => jest.clearAllMocks());

test("listTrips returns the trips array on success", async () => {
  mockedFetch.mockResolvedValue(
    new Response(JSON.stringify({ trips: [{ id: "1", destination: "Kyoto", startDate: "2026-10-01", endDate: "2026-10-05", budget: 2000, status: "saved" }] }), { status: 200 })
  );

  const result = await listTrips();

  expect(result).toEqual([{ id: "1", destination: "Kyoto", startDate: "2026-10-01", endDate: "2026-10-05", budget: 2000, status: "saved" }]);
  expect(mockedFetch).toHaveBeenCalledWith("/api/trips?status=saved", expect.anything());
});

test("listTrips returns undefined when the fetch fails", async () => {
  mockedFetch.mockResolvedValue(new Response("", { status: 500 }));

  expect(await listTrips()).toBeUndefined();
});

test("getTrip returns the trip on success", async () => {
  const trip = {
    id: "1", destination: "Kyoto", startDate: "2026-10-01", endDate: "2026-10-05",
    budget: 2000, status: "saved", itinerary: { days: [] }, userAnswers: null, chatSessionId: null,
  };
  mockedFetch.mockResolvedValue(new Response(JSON.stringify(trip), { status: 200 }));

  expect(await getTrip("1")).toEqual(trip);
  expect(mockedFetch).toHaveBeenCalledWith("/api/trips/1", expect.anything());
});

test("getProfile returns null when the traveler has no saved profile", async () => {
  mockedFetch.mockResolvedValue(new Response(JSON.stringify({ profile: null }), { status: 200 }));

  expect(await getProfile()).toBeNull();
});

test("getProfile returns undefined when the fetch fails", async () => {
  mockedFetch.mockResolvedValue(new Response("", { status: 500 }));

  expect(await getProfile()).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npm test -- tripMateApi.test.ts`
Expected: FAIL — `Cannot find module './tripMateApi'`

- [ ] **Step 3: Implement**

Create `mobile/src/api/tripMateApi.ts`:

```ts
import { fetchWithSession } from "./session";
import type { Trip, TripSummary, TravelerProfile, TripStatus } from "./types";

export async function listTrips(status: TripStatus = "saved"): Promise<TripSummary[] | undefined> {
  const res = await fetchWithSession(`/api/trips?status=${status}`);
  if (!res.ok) return undefined;
  const body = await res.json();
  return body.trips as TripSummary[];
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  const res = await fetchWithSession(`/api/trips/${id}`);
  if (!res.ok) return undefined;
  return (await res.json()) as Trip;
}

export async function getProfile(): Promise<TravelerProfile | null | undefined> {
  const res = await fetchWithSession("/api/profile");
  if (!res.ok) return undefined;
  const body = await res.json();
  return body.profile as TravelerProfile | null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd mobile && npm test -- tripMateApi.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/zaidshaikh/GitHub/tripmate
git add mobile/src/api/tripMateApi.ts mobile/src/api/tripMateApi.test.ts
git commit -m "Add the trips/profile read API client"
```

---

## Task 5: Tab shell (Home / Memories / Profile)

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx` (from the default template)
- Modify: `mobile/app/(tabs)/index.tsx` → Home placeholder
- Create: `mobile/app/(tabs)/memories.tsx` (stub, filled in Task 6)
- Create: `mobile/app/(tabs)/profile.tsx` (stub, filled in Task 8)
- Delete: whichever default-template tab files aren't Home (typically `explore.tsx`)

**Interfaces:**
- Produces: three routed tabs, `home`, `memories`, `profile`, matching the Swift `AppTab` enum's
  three cases, labels ("Home", "Memories", "Profile") and icons (house, bookmark, person) exactly
  — see `ios/TripMate/TripMate/Shell/TabBar.swift`.

- [ ] **Step 1: Replace the default tab layout**

Edit `mobile/app/(tabs)/_layout.tsx` to:

```tsx
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="memories"
        options={{ title: "Memories", tabBarIcon: ({ color, size }) => <Ionicons name="bookmark" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 2: Delete the default template's extra tab**

Run: `rm mobile/app/\(tabs\)/explore.tsx` (path may differ slightly by Expo SDK version — delete
whichever second demo screen the template generated; `index.tsx` and `_layout.tsx` stay).

- [ ] **Step 3: Home placeholder**

Replace `mobile/app/(tabs)/index.tsx` with:

```tsx
import { View, Text } from "react-native";

export default function Home() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Plan a trip — coming in the next plan.</Text>
    </View>
  );
}
```

- [ ] **Step 4: Stub the other two so the tabs render**

Create `mobile/app/(tabs)/memories.tsx`:

```tsx
import { View, Text } from "react-native";

export default function Memories() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Memories</Text>
    </View>
  );
}
```

Create `mobile/app/(tabs)/profile.tsx` with the same shape, `<Text>Profile</Text>`.

- [ ] **Step 5: Verify manually**

Run: `cd mobile && npx expo start` — open in the iOS simulator and an Android emulator (or Expo
Go on each). Confirm three tabs, correctly labeled and iconed, and tapping between them switches
screens.

- [ ] **Step 6: Commit**

```bash
cd /Users/zaidshaikh/GitHub/tripmate
git add mobile/app
git commit -m "Wire the three-tab shell (Home / Memories / Profile)"
```

---

## Task 6: Memories screen (saved trips list)

**Files:**
- Modify: `mobile/app/(tabs)/memories.tsx`
- Create: `mobile/app/trip/[id].tsx` (detail route target, filled in Task 7 — this task only needs it to exist so navigation doesn't 404)

**Interfaces:**
- Consumes: `listTrips` (Task 4).
- Produces: tapping a row navigates to `/trip/[id]`, read by Task 7.

- [ ] **Step 1: Implement the list**

Replace `mobile/app/(tabs)/memories.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { listTrips } from "../../src/api/tripMateApi";
import type { TripSummary } from "../../src/api/types";

export default function Memories() {
  const router = useRouter();
  // undefined = still loading, null = the fetch failed, [] = fetched fine, no trips yet.
  const [trips, setTrips] = useState<TripSummary[] | null | undefined>(undefined);

  useEffect(() => {
    listTrips().then((result) => setTrips(result ?? null));
  }, []);

  if (trips === undefined) return <ActivityIndicator style={{ flex: 1 }} />;
  if (trips === null) return <Centered text="Couldn't load your trips. Check your connection." />;
  if (trips.length === 0) return <Centered text="No trips yet — plan one from Home." />;

  return (
    <FlatList
      data={trips}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push(`/trip/${item.id}`)} style={{ padding: 16, borderBottomWidth: 1, borderColor: "#eee" }}>
          <Text style={{ fontSize: 17, fontWeight: "600" }}>{item.destination}</Text>
          <Text style={{ color: "#666" }}>{item.startDate} – {item.endDate}</Text>
        </Pressable>
      )}
    />
  );
}

function Centered({ text }: { text: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ textAlign: "center" }}>{text}</Text>
    </View>
  );
}
```

- [ ] **Step 2: Stub the detail route so it exists**

Create `mobile/app/trip/[id].tsx`:

```tsx
import { Text, View } from "react-native";

export default function TripDetail() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Trip detail — next task.</Text>
    </View>
  );
}
```

- [ ] **Step 3: Verify manually against the real backend**

Run the Next.js backend: `cd /Users/zaidshaikh/GitHub/tripmate && npm run dev`
Run the app: `cd mobile && npx expo start`, open on simulator/emulator.
Confirm: the Memories tab shows the same saved trips the web app shows at `/trips` on the same
machine (same dev server, same SQLite file), tapping one navigates to the stub detail screen.

- [ ] **Step 4: Commit**

```bash
cd /Users/zaidshaikh/GitHub/tripmate
git add mobile/app
git commit -m "List saved trips on the Memories tab"
```

---

## Task 7: Trip detail (day list, no map)

**Files:**
- Modify: `mobile/app/trip/[id].tsx`

**Interfaces:**
- Consumes: `getTrip` (Task 4), `Trip`/`DayPlan`/`Stop` types (Task 2).

- [ ] **Step 1: Implement**

Replace `mobile/app/trip/[id].tsx` with:

```tsx
import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { getTrip } from "../../src/api/tripMateApi";
import type { Trip } from "../../src/api/types";

export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);

  useEffect(() => {
    getTrip(id).then((result) => setTrip(result ?? null));
  }, [id]);

  if (trip === undefined) return <ActivityIndicator style={{ flex: 1 }} />;
  if (trip === null) return <Text style={{ padding: 24 }}>Couldn't load this trip.</Text>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{trip.destination}</Text>
      <Text style={{ color: "#666", marginBottom: 16 }}>{trip.startDate} – {trip.endDate}</Text>
      {trip.itinerary.days.map((day, i) => (
        <View key={day.date} style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 17, fontWeight: "600" }}>Day {i + 1} · {day.date}</Text>
          {day.title ? <Text style={{ fontStyle: "italic" }}>{day.title}</Text> : null}
          {day.stops.map((stop, j) => (
            <View key={`${stop.name}-${j}`} style={{ paddingVertical: 6 }}>
              <Text>{stop.time ? `${stop.time} — ` : ""}{stop.name}</Text>
              {stop.note ? <Text style={{ color: "#666" }}>{stop.note}</Text> : null}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Verify manually**

Same servers as Task 6. Open a saved trip from Memories and confirm every day and stop from the
web's own trip detail page appears here (names, times, notes) — cross-check against `/trip/<id>`
on the web app for the same trip id.

- [ ] **Step 3: Commit**

```bash
cd /Users/zaidshaikh/GitHub/tripmate
git add mobile/app/trip/\[id\].tsx
git commit -m "Show a trip's days and stops on the detail screen"
```

---

## Task 8: Profile screen (view-only)

**Files:**
- Modify: `mobile/app/(tabs)/profile.tsx`

**Interfaces:**
- Consumes: `getProfile` (Task 4), `TravelerProfile` type (Task 2).

- [ ] **Step 1: Implement**

Replace `mobile/app/(tabs)/profile.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { getProfile } from "../../src/api/tripMateApi";
import type { TravelerProfile } from "../../src/api/types";

export default function Profile() {
  // undefined = loading, null = fetch failed, "none" = fetched fine, no profile saved yet.
  const [profile, setProfile] = useState<TravelerProfile | null | "none" | undefined>(undefined);

  useEffect(() => {
    getProfile().then((result) => setProfile(result === undefined ? null : result === null ? "none" : result));
  }, []);

  if (profile === undefined) return <ActivityIndicator style={{ flex: 1 }} />;
  if (profile === null) return <Text style={{ padding: 24 }}>Couldn't load your profile.</Text>;
  if (profile === "none") return <Text style={{ padding: 24 }}>You haven't filled in your travel profile yet.</Text>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Row label="Group" value={profile.group} />
      <Row label="Explorer style" value={profile.explorerStyle} />
      <Row label="Energy" value={profile.energy} />
      <Row label="Crowds" value={profile.crowds} />
      <Row label="Top priorities" value={profile.topPriorities.join(", ") || "—"} />
      <Row label="Dietary" value={profile.dietary.tags.join(", ") || "—"} />
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: "#666" }}>{label}</Text>
      <Text style={{ fontSize: 17 }}>{value}</Text>
    </View>
  );
}
```

- [ ] **Step 2: Verify manually**

With a profile already saved on the web app (via the web's `/profile` page against the same dev
server), confirm the same six fields show here with the same values. With a fresh SQLite DB
(no profile row), confirm the "haven't filled in" empty state shows instead of an error.

- [ ] **Step 3: Commit**

```bash
cd /Users/zaidshaikh/GitHub/tripmate
git add mobile/app/\(tabs\)/profile.tsx
git commit -m "Show the traveler profile, read-only, on the Profile tab"
```

---

## Self-Review Notes

- **Spec coverage:** this plan covers the spec's "Architecture," "Screens/navigation" (Home
  stubbed, Memories + Profile real), "Data layer," and "Open risk: anonymous identity" sections.
  Map, wizard/generation, chat, photos, profile-edit, and EAS build are explicitly deferred to
  named follow-up plans in the Scope Note above — each is a section of the spec, not a section
  dropped silently.
- **Type consistency checked:** `TripStatus`, `TripSummary`, `Trip`, `TravelerProfile` are defined
  once in Task 2 and referenced with the same names/shapes in Tasks 4, 6, 7, 8 — no drift.
- **No placeholders:** every step above has runnable code and an exact verification command;
  the only intentionally-thin screen is the Home tab, which is real (if minimal) code, not a
  `TODO`.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-22-react-native-mobile-app-foundation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
