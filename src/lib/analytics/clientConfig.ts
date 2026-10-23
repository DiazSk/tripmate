/**
 * The parts of the web analytics client that need no browser and no `posthog-js`, split out so
 * `node --test` can pin them. `client.ts` is the only module that imports the SDK.
 */

/**
 * Attributes a replay needs to look like the page: they carry no words. Everything else (`aria-*`,
 * `placeholder`, `alt`, `title`, `value`, `href`, `src` (a photo's URL names its place), `data-*`...)
 * can hold something a tester typed or a place they chose, and is replaced by asterisks of the same
 * length.
 *
 * Three more kinds pass, each cleaned of URLs because a `url(...)` in CSS is a photo's address:
 * `style` (an inline `background-image` names its place), and rrweb's own `_cssText` (the
 * stylesheet text it serialises, developer-authored and needed or the replay is unstyled) and
 * `rr_*` (its sizing and scroll metadata). `rr_dataURL` is canvas pixels and stays masked.
 */
const RENDERING = /^(class|id|type|role|width|height|viewbox|d|points|transform|fill.*|stroke.*|cx|cy|r|rx|ry|x|y|x1|x2|y1|y2|colspan|rowspan|hidden|disabled|checked|rel|media|sizes|loading|lang|dir)$/i;
const CSS_URL = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi;
export function maskAttribute(name: string, value: string): string {
  if (/^(style|_cssText)$/.test(name)) return value.replace(CSS_URL, "url()");
  if (/^rr_/.test(name) && name !== "rr_dataURL") return value;
  return RENDERING.test(name) ? value : "*".repeat(value.length);
}

/**
 * What `posthog.init` is given. Every line is a privacy or identity decision, which is why the
 * object is tested whole rather than spot-checked:
 *
 * - `persistence` is the SDK default, spelled out because the server reads PostHog's own
 *   `ph_<key>_posthog` cookie to attach its events to the same person; `localStorage` alone would
 *   leave it nothing to read.
 * - `person_profiles: "always"` so an anonymous tester is a person, not a bare event stream.
 * - The top-level `mask_all_*` options govern **autocapture only**; the recorder reads nothing but
 *   `session_recording.*`. So replay is masked on its own terms, inverted: every text node
 *   (`maskTextSelector: "*"`), every input and every attribute that is not a rendering one is
 *   masked, and what a recording shows is layout, taps and scrolling. (An allow-list of masked elements would leak whatever
 *   screen was added after it, e.g. a review step that prints what the tester typed.)
 *   `data-ph-mask` marks stay on the known free-text spots as a second, explicit signal.
 * - Attributes are masked by `maskAttributeFn`, not `maskAllElementAttributes`: measured, that
 *   option also masks `class`, `id` and `style`, and a replay whose elements have no classes
 *   plays back as unstyled markup, which defeats watching it.
 * - `recordCanvas: false` is pinned because the project's remote config can otherwise switch
 *   canvas recording on, and the canvas is the map.
 * - Console and network capture are pinned here for the same reason: left unset, the project's
 *   settings decide them, and this object is the one privacy contract (nothing in PostHog's UI may
 *   widen it). The console is off (a log line can print a trip); the network log keeps each
 *   request's timing under its scrubbed path only, see `maskNetworkRequest`.
 */
export function posthogInitOptions(env: { host: string }) {
  return {
    api_host: env.host,
    persistence: "localStorage+cookie" as const,
    capture_pageview: "history_change" as const,
    person_profiles: "always" as const,
    autocapture: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    enable_recording_console_log: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      maskAttributeFn: maskAttribute,
      maskCapturedNetworkRequestFn: maskNetworkRequest,
      captureCanvas: { recordCanvas: false },
    },
    capture_exceptions: true,
  };
}

/**
 * A replay's network entry, cut to the scrubbed path of its URL. The query is where a typed
 * destination (`/api/geocode?destination=…`) and a place search travel, and the origin says
 * nothing a path does not; headers and bodies carry cookies and whole trips, so they never stay,
 * whatever the project's settings ask for. Timing and status are what a replay needs. Another
 * site's request keeps only its host: a tile's z/x/y is the area being looked at and a Wikimedia
 * photo's file name is the place. `notRestoredReasons` (Chrome's back/forward cache) carries a URL.
 */
type NetworkEntry = { name: string; requestHeaders?: unknown; requestBody?: unknown; responseHeaders?: unknown; responseBody?: unknown; notRestoredReasons?: unknown };
export function maskNetworkRequest<E extends NetworkEntry>(entry: E): E {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { requestHeaders, requestBody, responseHeaders, responseBody, notRestoredReasons, ...kept } = entry;
  const origin = typeof location === "undefined" ? "http://relative.invalid" : location.origin;
  let name: string;
  try {
    const u = new URL(entry.name, origin);
    name = u.origin === origin ? scrubPath(u.pathname) : u.hostname;
  } catch {
    name = "/";
  }
  return { ...kept, name } as E;
}

/**
 * `/s/<token>` is a capability (anyone with it reads the trip) and `/trip/<id>` names one trip, so
 * neither belongs in an analytics event; the route pattern says which screen it was, spelled as the
 * app directory spells it (`/trip/[id]`, `/s/[token]`) everywhere analytics names a route. `latest`
 * is a fixed route, not an id, and stays. The API routes behind them are cut the same way for a
 * replay's network log; an avatar's path carries an owner id, the bearer credential for every trip.
 */
export function scrubPath(path: string): string {
  return path
    .replace(/^\/s\/[^/?#]+/, "/s/[token]")
    .replace(/^\/trip\/(?!latest(?:[/?#]|$))[^/?#]+/, "/trip/[id]")
    .replace(/^\/api\/trips\/[^/?#]+/, "/api/trips/[id]")
    .replace(/^\/api\/shared\/[^/?#]+/, "/api/shared/[token]")
    .replace(/^\/api\/avatar\/[^/?#]+/, "/api/avatar/[userId]");
}

/**
 * The path, and any query value that is itself a path or a URL (a sign-in's `?next=/trip/<id>`).
 * The query is only rewritten when a value changed, so every other URL keeps its exact spelling.
 */
export function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = scrubPath(u.pathname);
    for (const [k, v] of [...u.searchParams]) {
      const clean = v.startsWith("/") ? scrubPath(v) : /^https?:\/\//i.test(v) ? scrubUrl(v) : v;
      if (clean !== v) u.searchParams.set(k, clean);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** PostHog prefixes the same URL and path properties with `$initial_` and `$session_entry_`, so they are matched by ending. */
const URL_KEY = /^\$.*(url|referrer)$/;
const PATH_KEY = /^\$.*pathname$/;

function scrubBag(bag: Record<string, unknown> | undefined | null) {
  if (!bag) return;
  for (const [k, v] of Object.entries(bag)) {
    if (typeof v !== "string") continue;
    if (URL_KEY.test(k)) bag[k] = scrubUrl(v);
    else if (PATH_KEY.test(k)) bag[k] = scrubPath(v);
  }
}

/**
 * `before_send`: the page title (a trip's name is in it) is dropped, ids and tokens in URLs become
 * route patterns, in the event, in the person-property bags it carries, and in the href of replay
 * snapshots' meta records. Mutates and returns the event, as PostHog expects.
 */
type Bag = Record<string, unknown>;
export function scrubEvent<E extends { properties?: Bag; $set?: Bag; $set_once?: Bag } | null>(event: E): E {
  if (!event) return event;
  const p = event.properties;
  if (p) {
    delete p.title;
    delete p.$title;
    scrubBag(p);
    scrubBag(p.$set as Bag | undefined);
    scrubBag(p.$set_once as Bag | undefined);
    if (Array.isArray(p.$snapshot_data)) {
      for (const rec of p.$snapshot_data as { data?: { href?: unknown } }[]) {
        if (typeof rec?.data?.href === "string") rec.data.href = scrubUrl(rec.data.href);
      }
    }
  }
  scrubBag(event.$set);
  scrubBag(event.$set_once);
  return event;
}

/** This browser's PostHog session count, for the "third session" survey trigger. */
export type SessionCount = { last: string | null; count: number };

/** A new session id counts once; `third` is true exactly once, on the session that makes it three. */
export function countSession(prev: SessionCount, sessionId: string): { next: SessionCount; third: boolean } {
  if (sessionId === prev.last) return { next: prev, third: false };
  const count = prev.count + 1;
  return { next: { last: sessionId, count }, third: count === 3 };
}

/** `?via=linkedin`: where a tester came from. A short word only, since it lands in a person property. */
export function viaParam(search: string): string | null {
  const via = new URLSearchParams(search).get("via");
  return via && /^[A-Za-z0-9-]{1,24}$/.test(via) ? via : null;
}

/** `?internal=1`: marks this browser as Zaid's or Aryan's, for dashboards to filter out. */
export function internalParam(search: string): boolean {
  return new URLSearchParams(search).get("internal") === "1";
}

/**
 * Ask only a tester nobody has an answer from. `stored` is the server's record (the account's, or
 * this device's owner), `local` is what this browser remembers answering. Either one is an answer,
 * so a lost owner cookie does not re-ask someone who already said No.
 */
export function consentPromptVisible(stored: boolean | null, local: boolean | null): boolean {
  return stored === null && local === null;
}
