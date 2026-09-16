import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { OWNER_COOKIE, OWNER_COOKIE_MAX_AGE_S, isValidOwnerId, newOwnerId } from "@/lib/owner";

/**
 * Mints the owner cookie on a browser that doesn't have one yet.
 *
 * **`proxy.ts`, not `middleware.ts`.** The `middleware` file convention is deprecated in Next 16
 * and renamed to `proxy` — same behaviour, different file and export name. Writing the old one
 * still "works" in the sense that Next warns rather than errors, which is exactly how a deprecated
 * convention survives in a codebase until it doesn't.
 *
 * This has to live here rather than in a route or a layout because of a hard constraint in the
 * cookies API: `.set()` is **not supported during Server Component rendering** — HTTP cannot set a
 * cookie once streaming has begun, so only a Route Handler, a Server Function, or this can do it.
 * The `/trips` page is a server component that needs the owner id at render time, so the cookie
 * must already exist by the time it runs. That is precisely what a proxy is for.
 */
/**
 * The developer surface, closed outside development.
 *
 * Three of these had no gate of any kind and were reachable in every mode. `/api/llm-traces`
 * returns `prompt` and `raw_response` for every call the app has ever made — a traveller's whole
 * trip, verbatim — and `/api/llm-mode` accepts a **POST** that flips the transport for the whole
 * process, from an anonymous caller. `/backend` renders the console (`/backend/pipeline` beneath
 * it was gated; its parent was not).
 *
 * Blocked by prefix here rather than by adding `notFound()` to seven files, because the list that
 * matters is "the ops surface" and a new `/api/llm-traces/<something>` should be covered the day
 * it is written rather than the day someone remembers. The per-file `NODE_ENV` checks in
 * `/bench`, `/backend/pipeline` and `/api/bench` stay where they are — they are tested, and a
 * second lock costs nothing if this matcher is ever narrowed.
 */
const DEV_ONLY_PREFIXES = ["/api/llm-traces", "/api/llm-mode", "/api/bench", "/backend", "/bench"];

export function proxy(request: NextRequest) {
  if (
    process.env.NODE_ENV !== "development" &&
    DEV_ONLY_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p))
  ) {
    // 404 rather than 403: whether this deployment has a trace viewer is not information an
    // anonymous caller needs, and every other "not here" in this app answers 404.
    return new NextResponse(null, { status: 404 });
  }

  const existing = request.cookies.get(OWNER_COOKIE)?.value;
  if (isValidOwnerId(existing)) return NextResponse.next();

  const ownerId = newOwnerId();

  // Set on the REQUEST as well as the response, and that is the whole trick. A cookie set only on
  // the response reaches the browser but not the render that is happening right now — so the very
  // first page view would fall back to the legacy owner, write a trip under it, and only start
  // behaving from the second request onward. Mutating the request makes `cookies()` upstream see
  // the id immediately, so the first visit behaves like every later one.
  request.cookies.set(OWNER_COOKIE, ownerId);
  const response = NextResponse.next({ request: { headers: request.headers } });

  response.cookies.set({
    name: OWNER_COOKIE,
    value: ownerId,
    maxAge: OWNER_COOKIE_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
    // Readable by the server only. Nothing on the client needs it — every query that uses it runs
    // server-side — and keeping it out of `document.cookie` is free here.
    httpOnly: true,
    // Off in development so plain-HTTP localhost still receives it; on in production, where the
    // deployed app is HTTPS and a cookie sent in the clear would be pointless.
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export const config = {
  /**
   * Everything except static assets and Next's own internals.
   *
   * Without a matcher a proxy runs on *every* request including `_next/static`, image optimization
   * and everything in `public/` — which here means the Cesium bundle: thousands of asset requests
   * that would each mint and re-send a cookie for no reason. `/api` is deliberately NOT excluded:
   * the trips routes read this cookie, and a curl against them should get the same legacy-owner
   * fallback a cookieless browser would.
   */
  matcher: ["/((?!_next/static|_next/image|cesium|favicon.ico|sitemap.xml|robots.txt).*)"],
};
