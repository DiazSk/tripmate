import type { PostHog } from "posthog-js";
import { createHeld } from "./heldEvents";
import { internalParam, posthogInitOptions, scrubEvent, viaParam } from "./clientConfig";

/**
 * The web's whole PostHog surface, and the only module that imports `posthog-js`.
 *
 * Nothing here runs until a tester has said Yes: the SDK is a dynamic import inside `start()`, so
 * a No (or no answer) downloads nothing and sends nothing, and nothing in this file touches
 * `window` at import time, so SSR never reaches it. Every function is a no-op without a started
 * client, and none throws to its caller except `setConsent`, whose failure the prompt must show.
 */

export type ClientEvent =
  | "plan_started" | "plan_wait_abandoned" | "trip_opened" | "chat_edit_sent" | "error_shown"
  | "offline_screen_shown" | "story_film_played" | "story_film_finished" | "sign_up_completed" | "sign_in_completed"
  | "idea_sent" | "idea_answered" | "idea_unmatched" | "idea_built" | "ready_trip_opened" | "ready_trip_used" | "filter_pill_selected";

/** Both are inlined at build, so they must be read as these literals; unset key means analytics is off. */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

export const analyticsConfigured = Boolean(KEY);

export const CONSENT_EVENT = "tripmate:analytics-consent-changed";
const LOCAL_KEY = "tripmate:analytics-consent";
const LINK_KEY = "tripmate:analytics-link";

let ph: PostHog | null = null;
let starting: Promise<PostHog | null> | null = null;
/** Set by a No and cleared by a Yes; `start()` checks it after its import, which a No can overtake. */
let withdrawn = false;

/** Who is signed in on this page, set by the provider from Clerk; `null` is signed out. */
export type Account = { id: string; name: string | null; email: string | null };
let account: Account | null = null;
/** The Clerk user the SDK is currently identified as, so identifying twice is a no-op. */
let identified: string | null = null;

/** Fired by the sign-in finish page once the claim has landed, so the provider re-reads a consent answer that may have moved with it. */
export const SIGNED_IN_EVENT = "tripmate:analytics-signed-in";

/** What this browser remembers answering; `null` is never asked. Storage may throw (private windows). */
export function localConsent(): boolean | null {
  try {
    const v = localStorage.getItem(LOCAL_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

function rememberConsent(yes: boolean) {
  try {
    localStorage.setItem(LOCAL_KEY, yes ? "1" : "0");
  } catch {
    // The server holds the real answer; this only keeps the prompt from coming back.
  }
}

/**
 * The server's answer. `null` means the read failed (429, network, 5xx, malformed), which is "no
 * answer yet": never a Yes, and never a reason to show the prompt either.
 */
export async function readStoredConsent(): Promise<{ consent: boolean | null } | null> {
  try {
    const res = await fetch("/api/analytics/consent", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { consent?: unknown };
    return body.consent === true || body.consent === false || body.consent === null ? { consent: body.consent } : null;
  } catch {
    return null;
  }
}

/**
 * `?via=` and `?internal=1` arrive on the first page, before a tester may have answered, and
 * nothing may be sent until they have. So they wait in sessionStorage (two short strings, never
 * sent anywhere from here) and are applied when the SDK starts.
 */
export function rememberLinkParams() {
  try {
    const via = viaParam(location.search);
    const internal = internalParam(location.search);
    if (!via && !internal) return;
    const prev = JSON.parse(sessionStorage.getItem(LINK_KEY) ?? "{}") as { via?: string; internal?: boolean };
    sessionStorage.setItem(LINK_KEY, JSON.stringify({ via: via ?? prev.via, internal: internal || prev.internal }));
  } catch {
    // No storage, no link tags: the person is still counted.
  }
}

function applyLinkParams(client: PostHog) {
  try {
    const { via, internal } = JSON.parse(sessionStorage.getItem(LINK_KEY) ?? "{}") as { via?: string; internal?: boolean };
    if (internal) client.setPersonProperties({ internal: true });
    // `$set_once`: the first invite wins, so a later link cannot rewrite where a tester came from.
    if (via) client.setPersonProperties(undefined, { invite: via });
  } catch {
    // Same as above.
  }
}

/** Starts the SDK once, after a Yes. Resolves `null` (and stays off) when analytics is unconfigured, a No overtook the import, or the import fails. */
export function start(): Promise<PostHog | null> {
  if (!KEY) return Promise.resolve(null);
  starting ??= import("posthog-js")
    .then(({ default: posthog }) => {
      // A No can land while the chunk downloads; `ph` is still null then, so only this flag can stop the init.
      if (withdrawn) {
        starting = null;
        return null;
      }
      posthog.init(KEY, {
        ...posthogInitOptions({ host: HOST }),
        before_send: scrubEvent,
        // Before the first pageview, so every event carries the pair. `signed_in` is persisted by
        // the SDK, so a signed-in tester's next visit keeps `true` until they sign out.
        loaded: (p) => {
          p.register({ platform: "web" });
          p.register_once({ signed_in: false });
        },
      });
      // Lifts the opt-out a No on this device left behind; skipped otherwise, since each call emits an `$opt_in` event.
      if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
      applyLinkParams(posthog);
      ph = posthog;
      // Clerk may have reported a signed-in user before the SDK was up.
      void identifySignedIn();
      return posthog;
    })
    .catch((err) => {
      // A blocked script or a failed chunk must never reach the page: the app works without analytics.
      console.warn("[analytics] not started:", err instanceof Error ? err.message : err);
      starting = null;
      return null;
    });
  return starting;
}

/**
 * Acts on the server's stored answer, as read by the provider (as opposed to a press, which is
 * `setConsent`). A stored No must stop an SDK that is already up: after a sign-in claim the
 * account can hold a No while this browser had said Yes anonymously, and it must not keep capturing
 * or be identified.
 */
export async function applyStoredConsent(yes: boolean): Promise<void> {
  withdrawn = !yes;
  if (!yes) {
    held.clear();
    ph?.stopSessionRecording();
    ph?.opt_out_capturing();
    return;
  }
  const client = await start();
  if (client?.has_opted_out_capturing()) {
    client.opt_in_capturing();
    client.startSessionRecording();
  }
  // A stored Yes was found at load: what the page fired meanwhile was agreed to, if still fresh.
  if (client && !withdrawn) for (const w of held.take()) track(w.event, w.properties);
}

type Props = Record<string, string | number | boolean | null>;

/** Events fired before the SDK is up; see `heldEvents.ts` for the queue and the rules around it. */
const held = createHeld<{ event: ClientEvent; properties?: Props }>();

/**
 * Fire-and-forget. Properties are lengths, counts and categories, never typed text.
 *
 * Until the tester has opted in this sends nothing. An event fired in the first seconds of a page
 * load (a trip page's `trip_opened`, a sign-in's finish) is held only while there is no stored
 * answer and no No, and released only when a stored Yes is found at load, if it is under ten
 * seconds old. A Yes tapped in the prompt or the Profile switch clears the queue first: nothing
 * from before the tap was agreed to.
 */
export function track(event: ClientEvent, properties?: Props): void {
  try {
    if (ph) ph.capture(event, properties);
    else if (analyticsConfigured) held.hold({ event, properties }, !withdrawn);
  } catch {
    // Analytics never breaks a screen.
  }
}

/**
 * Records the answer on the server first, and only then acts on it: a Yes starts the SDK, a No
 * stops it. Throws when the server did not take the answer, so the prompt can say so and stay.
 */
export async function setConsent(yes: boolean): Promise<void> {
  // A No takes effect on the press, not when the server answers: the SDK's import can finish inside
  // that round trip, and the first pageview would go out for someone who has already said no.
  const before = withdrawn;
  withdrawn = !yes;
  held.clear();
  if (!yes && ph) {
    ph.stopSessionRecording();
    ph.opt_out_capturing();
  }
  let res: Response;
  try {
    res = await fetch("/api/analytics/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: yes }),
    });
    if (!res.ok) throw new Error(`consent not saved: ${res.status}`);
  } catch (err) {
    // Not recorded, so the answer on file stands; a Yes that was stopped is put back.
    withdrawn = before;
    if (!yes && ph && !before) {
      ph.opt_in_capturing({ captureEventName: false });
      ph.startSessionRecording();
    }
    throw err;
  }
  rememberConsent(yes);
  if (yes) {
    const wasUp = ph !== null;
    const client = await start();
    // Already up and opted out means a No earlier on this page load; a fresh start has handled that itself.
    if (wasUp && client?.has_opted_out_capturing()) {
      client.opt_in_capturing();
      client.startSessionRecording();
    }
    // Only what was fired after the tap is left in the queue (it was cleared at the press).
    if (client) for (const w of held.take()) track(w.event, w.properties);
  }
  // Any other surface asking (the prompt, the Profile switch) hears it, so two never disagree on screen.
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: yes }));
}

/**
 * Identifies the signed-in Clerk user as the derived id of their owner (PostHog merges the
 * anonymous history into it), then names the person for follow-up. Keyed on Clerk's "signed in",
 * never on the id route answering: it returns an HMAC for anonymous owners too. The pair
 * `signed_in: true`, `name` and `email` is only set once `identify` has gone out.
 */
async function identifySignedIn(): Promise<void> {
  const who = account;
  if (!ph || !who || withdrawn || identified === who.id) return;
  identified = who.id;
  try {
    const res = await fetch("/api/analytics/id", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const { id } = (await res.json()) as { id: string | null };
    // The user may have signed out, or said No, while the id was in flight.
    if (!id || !ph || withdrawn || account?.id !== who.id) throw new Error("stale");
    ph.identify(id);
    ph.register({ signed_in: true });
    ph.setPersonProperties({ ...(who.name ? { name: who.name } : {}), ...(who.email ? { email: who.email } : {}) });
  } catch {
    // Still counted under the anonymous id; the next sign-in or page load tries again.
    if (identified === who.id) identified = null;
  }
}

/** The provider reports Clerk's state here. Leaving a signed-in state is a sign-out, wherever it came from. */
export function setAccount(next: Account | null): void {
  const wasIdentified = identified !== null;
  account = next;
  if (next) void identifySignedIn();
  else if (wasIdentified) resetAfterSignOut();
}

/** After the claim: the account's owner may now carry a consent answer, and the SDK may already be up. */
export async function identifyAfterSignIn(): Promise<void> {
  window.dispatchEvent(new Event(SIGNED_IN_EVENT));
  await identifySignedIn();
}

/**
 * Sign-out starts a stranger on a fresh anonymous id, who has said nothing yet. So capture stops
 * first (the reset and the next pageview must not send for them), and resumes only if the new
 * owner's stored answer is a Yes; a failed read is not one.
 */
export function resetAfterSignOut(): void {
  identified = null;
  held.clear();
  const client = ph;
  if (!client) return;
  try {
    client.stopSessionRecording();
    client.opt_out_capturing();
    // `reset` drops super properties along with the id, so the pair is put back for the next person.
    client.reset();
    client.register({ platform: "web", signed_in: false });
  } catch {
    // Same as `track`.
  }
  void readStoredConsent().then((stored) => {
    if (stored?.consent !== true || withdrawn || account) return;
    client.opt_in_capturing();
    client.startSessionRecording();
  });
}
