# TripMate mobile

The TripMate mobile client (Expo / React Native), talking to the existing Next.js backend at the
repo root over HTTP. There is no local database or business logic here — every screen fetches
from the backend's API routes.

Routes live in `src/app/` (Expo Router), **not** `app/` — non-route code (components, hooks,
constants) lives outside `src/app/` under `src/`.

## Running it

1. Start the backend first, from the repo root: `npm run dev` (needs to be up before this app can
   show real trips/profile data — see the root `CLAUDE.md`).
2. From this directory, start the Expo dev server: `npx expo start`.

## Talking to the backend

`src/api/config.ts` resolves the API base URL from `EXPO_PUBLIC_API_BASE_URL`, falling back in dev
to `http://localhost:3000` — except on the **Android emulator**, which cannot reach the host
machine via `localhost`; it defaults to `http://10.0.2.2:3000` there instead (the emulator's
loopback address for the host). Set `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` to point at a
physical device or a deployed backend.

## Commands

```bash
npx expo start        # dev server
npx expo lint         # lint
npx tsc --noEmit       # typecheck
npm test              # jest
```
