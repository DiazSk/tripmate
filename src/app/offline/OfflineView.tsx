"use client";

import { useCallback, useEffect, useState } from "react";
import Meridian from "@/components/Meridian";

import "@/components/polar/PolarLanding.css";
import "./offline.css";

/**
 * "You're out of range" (canvas design "Offline · 1 Out of range"). Served by `public/sw.js` when a
 * page load has no network and no saved copy of the page asked for.
 *
 * **It only says what it can know.** The trips listed are the `/trip/<id>` pages the service worker
 * actually kept: read from Cache Storage in the browser, named by each saved page's own `<title>`
 * ("Lisbon · TripMate"), and dated by the cached response's `Date` header, which is when the page was
 * fetched. Their links are plain `<a>`s on purpose: the worker serves saved copies to full page loads
 * only (see the note at the top of `sw.js`), so a client-side transition would fail where a hard load
 * opens the copy.
 *
 * When the connection comes back (the window's `online` event, or Try again reaching the server) the
 * page it stood in for is loaded: a reload, since the address is still the one that was asked for, or
 * home if somebody opened `/offline` itself.
 */

type Conn = "offline" | "checking" | "back";

/** Must match `PAGES_CACHE` in `public/sw.js`. */
const PAGES_CACHE = "tripmate-pages-v1";
const TRIP_PATH = /^\/trip\/(?!preview$|latest$)[^/]+$/;
const BACK_DELAY_MS = 1200;

interface SavedTrip {
  href: string;
  place: string;
  region: string | null;
  savedAt: string;
  at: number;
}

function savedLabel(date: Date): string {
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  const day = date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${time}`;
}

/** "today at 8:15 AM" or "on Tue 14 Oct, 9:40 PM", for a sentence. */
const savedPhrase = (savedAt: string) => (savedAt.startsWith("Today, ") ? `today at ${savedAt.slice(7)}` : `on ${savedAt}`);

async function readSavedTrips(): Promise<SavedTrip[]> {
  // `has` before `open`: opening creates the cache, and reading must not leave one behind.
  if (!("caches" in window) || !(await caches.has(PAGES_CACHE))) return [];
  const cache = await caches.open(PAGES_CACHE);
  const out: SavedTrip[] = [];
  for (const request of await cache.keys()) {
    const url = new URL(request.url);
    if (!TRIP_PATH.test(url.pathname)) continue;
    const response = await cache.match(request);
    if (!response) continue;
    const title = new DOMParser().parseFromString(await response.text(), "text/html").title;
    const destination = title.replace(/\s*·\s*TripMate\s*$/, "").trim();
    // A trip whose page could not name its destination says so in its title; it is still a trip.
    const named = destination && !/^Your trip itinerary$/i.test(destination);
    const [place, ...rest] = (named ? destination : "A saved trip").split(",");
    const date = new Date(response.headers.get("date") ?? "");
    const at = Number.isNaN(date.getTime()) ? 0 : date.getTime();
    out.push({
      href: url.pathname,
      place: place.trim(),
      region: rest.join(",").trim() || null,
      savedAt: at ? savedLabel(date) : "Earlier",
      at,
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 6);
}

export default function OfflineView() {
  const [conn, setConn] = useState<Conn>("offline");
  const [lastTried, setLastTried] = useState<string | null>(null);
  /** Null while the cache is being read, so the empty line never flashes before the list. */
  const [trips, setTrips] = useState<SavedTrip[] | null>(null);
  const [opening, setOpening] = useState<SavedTrip | null>(null);

  useEffect(() => {
    let alive = true;
    readSavedTrips()
      .then((found) => alive && setTrips(found))
      .catch(() => alive && setTrips([]));
    return () => {
      alive = false;
    };
  }, []);

  const goBack = useCallback(() => {
    setConn("back");
    window.setTimeout(() => {
      // A full load, not the router: this page is the worker's stand-in for a load that failed, and
      // the real page has to come from the network the way that load would have.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (window.location.pathname === "/offline") window.location.assign("/");
      else window.location.reload();
    }, BACK_DELAY_MS);
  }, []);

  useEffect(() => {
    window.addEventListener("online", goBack);
    return () => window.removeEventListener("online", goBack);
  }, [goBack]);

  /** Ask the server directly. A HEAD is never a navigation, so the worker lets it through to the network. */
  const tryAgain = async () => {
    setConn("checking");
    try {
      const res = await fetch(window.location.href, { method: "HEAD", cache: "no-store" });
      if (res.ok || res.status < 500) return goBack();
    } catch {
      // Still no network; fall through.
    }
    setConn("offline");
    setLastTried(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  };

  const status =
    conn === "checking"
      ? "Checking for a connection…"
      : conn === "back"
        ? "Back online. Opening the page you asked for."
        : `Waiting for a signal${lastTried ? ` · last tried ${lastTried}` : ""}`;

  return (
    // `map-chrome-hidden`: the map behind is not a map anybody can read offline, so its controls stand down.
    <main className="tm ofl map-chrome-hidden" data-conn={conn}>
      <div className="ofl-main">
        <section className="ofl-say" aria-labelledby="ofl-title">
          {/* Meri as everywhere else: still with no signal (its own offline state), thinking while it
              checks, and the success lift when the connection is back. */}
          <Meridian state={conn === "checking" ? "thinking" : conn === "back" ? "success" : "offline"} size={64} className="ofl-meri" />
          <p className="tm-eyebrow ofl-eyebrow">{conn === "back" ? "Connected" : "No connection"}</p>
          <h1 id="ofl-title" className="ofl-title">
            {conn === "back" ? "You’re back." : "You’re out of range."}
          </h1>
          <p className="ofl-body">
            {conn === "back"
              ? "The connection is back, so this page can load. Your saved trips will update to the latest the next time you open them."
              : "This page needs the internet, and there is none right now. Trips you opened on this device are kept, so they open without it. TripMate tries again the moment you’re back."}
          </p>
          <p className="ofl-status" role="status" aria-live="polite">
            <span className={`ofl-pip is-${conn}`} aria-hidden="true" />
            {status}
          </p>
          <div className="ofl-actions">
            {conn !== "back" && (
              <button type="button" className="tm-signal tm-signal-lg" onClick={tryAgain} disabled={conn !== "offline"}>
                {conn === "checking" ? "Checking…" : "Try again"}
              </button>
            )}
            <button type="button" className="tm-ghost" onClick={() => window.history.back()}>
              Go back <Arrow />
            </button>
          </div>
        </section>

        <section className="ofl-kept" aria-labelledby="ofl-kept-title">
          <header className="ofl-kept-head">
            <h2 id="ofl-kept-title" className="tm-eyebrow">
              Kept on this device
            </h2>
            <span className="tm-caption">{trips?.length ? `${trips.length} ${trips.length === 1 ? "trip" : "trips"}` : ""}</span>
          </header>
          {trips === null ? null : trips.length ? (
            <ul className="ofl-list">
              {trips.map((t) => (
                <li key={t.href}>
                  <a className="ofl-row" href={t.href} onClick={() => setOpening(t)} aria-label={`Open your saved copy of ${t.place}, saved ${savedPhrase(t.savedAt)}`}>
                    <span className="ofl-place">
                      <b>{t.place}</b>
                      {t.region && <span>{t.region}</span>}
                    </span>
                    <span className="ofl-saved">
                      Saved
                      <br />
                      {t.savedAt}
                    </span>
                    <span className="ofl-go">
                      <Arrow />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ofl-empty">Nothing is kept on this device yet. Trips you open while you’re online stay here for moments like this one.</p>
          )}
          <p className="ofl-note" aria-live="polite">
            {opening
              ? `Opening the copy of ${opening.place} saved ${savedPhrase(opening.savedAt)}…`
              : "The plan, its times and notes open from here. The map and photographs wait for a connection."}
          </p>
        </section>
      </div>

      <p className="ofl-monument" aria-hidden="true">
        {conn === "back" ? "Online" : "Offline"}
      </p>
    </main>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
