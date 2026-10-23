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
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      maskAttributeFn: maskAttribute,
      captureCanvas: { recordCanvas: false },
    },
    capture_exceptions: true,
  };
}

/**
 * `/s/<token>` is a capability (anyone with it reads the trip) and `/trip/<id>` names one trip, so
 * neither belongs in an analytics event; the route pattern says which screen it was. `latest` is a
 * fixed route, not an id, and stays.
 */
export function scrubPath(path: string): string {
  return path.replace(/^\/s\/[^/?#]+/, "/s/:token").replace(/^\/trip\/(?!latest(?:[/?#]|$))[^/?#]+/, "/trip/:id");
}

export function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = scrubPath(u.pathname);
    return u.toString();
  } catch {
    return url;
  }
}

const URL_KEYS = ["$current_url", "$initial_current_url", "$session_entry_url", "$referrer"];
const PATH_KEYS = ["$pathname", "$initial_pathname", "$session_entry_pathname", "$prev_pageview_pathname"];

function scrubBag(bag: Record<string, unknown> | undefined | null) {
  if (!bag) return;
  for (const k of URL_KEYS) if (typeof bag[k] === "string") bag[k] = scrubUrl(bag[k]);
  for (const k of PATH_KEYS) if (typeof bag[k] === "string") bag[k] = scrubPath(bag[k]);
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
