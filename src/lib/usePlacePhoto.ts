"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, string | null>();

export function usePlacePhoto(name: string): string | null | undefined {
  const [state, setState] = useState(() => ({ name, url: cache.get(name) }));

  // Render-phase state adjustment (not an effect) when `name` changes between renders —
  // see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (state.name !== name) {
    setState({ name, url: cache.get(name) });
  }

  useEffect(() => {
    if (cache.has(name)) return;
    let cancelled = false;
    fetch(`/api/place-photo?name=${encodeURIComponent(name)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        cache.set(name, data.thumbnailUrl);
        setState({ name, url: data.thumbnailUrl });
      })
      .catch(() => {
        if (cancelled) return;
        cache.set(name, null);
        setState({ name, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return state.name === name ? state.url : cache.get(name);
}
