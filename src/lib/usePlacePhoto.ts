"use client";

import { useEffect, useState } from "react";

type Photo = { thumbnailUrl: string | null; imageUrl: string | null; extract: string | null };

const resolved = new Map<string, Photo>();
// Same name is requested concurrently by several components (a stop's avatar and its stacked
// photo, plus StrictMode's double-invoke), and `resolved` only fills once a response lands — so
// without this, every mount fires its own duplicate request and the burst trips Wikipedia's
// rate limiter. Sharing the in-flight promise collapses them into one request per name.
const inflight = new Map<string, Promise<Photo | null>>();

function fetchPhoto(name: string): Promise<Photo | null> {
  const existing = inflight.get(name);
  if (existing) return existing;

  const request = fetch(`/api/place-photo?name=${encodeURIComponent(name)}`, { cache: "no-store" })
    .then((res) => {
      // A non-OK status means the lookup itself failed (upstream error/rate limit), not that the
      // place has no photo — don't cache it, so the next mount retries instead of being stuck
      // photo-less for the rest of the session.
      if (!res.ok) throw new Error(`place-photo ${res.status}`);
      return res.json() as Promise<Photo>;
    })
    .then((data) => {
      resolved.set(name, data);
      return data;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(name);
    });

  inflight.set(name, request);
  return request;
}

/**
 * `variant: "full"` asks for the larger `imageUrl` (header backgrounds), `"extract"` for the
 * Wikipedia one-paragraph description that arrives in the same response; default is the small
 * thumbnail. All three variants share one request and one cache entry per name, so asking for
 * the extract alongside a photo costs nothing extra.
 */
export function usePlacePhoto(
  name: string,
  variant: "thumb" | "full" | "extract" = "thumb"
): string | null | undefined {
  const [state, setState] = useState(() => ({ name, photo: resolved.get(name) }));

  // Render-phase state adjustment (not an effect) when `name` changes between renders —
  // see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (state.name !== name) {
    setState({ name, photo: resolved.get(name) });
  }

  useEffect(() => {
    // The empty-name guard is not just an optimization: callers that pass a field the user
    // hasn't filled in yet (the loader asks for the destination on every render of the plan
    // step) would otherwise fire a lookup for "" on each mount, which can only ever 400 or
    // miss, and burns a Wikipedia request every time.
    if (!name || resolved.has(name)) return;
    let cancelled = false;
    fetchPhoto(name).then((photo) => {
      if (!cancelled) setState({ name, photo: photo ?? undefined });
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const photo = state.name === name ? state.photo : resolved.get(name);
  // undefined = not resolved yet (or the lookup failed and will be retried); a resolved place
  // with no photo comes back as an object whose urls are null.
  if (!photo) return undefined;
  if (variant === "extract") return photo.extract;
  return variant === "full" ? photo.imageUrl : photo.thumbnailUrl;
}
