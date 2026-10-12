"use client";

import { useEffect, useState } from "react";
import type { HomeCity } from "@/lib/travelerProfile";
import { suggestDestinations, suggestionLabel, type GeoSuggestion } from "@/lib/weather";

/** A city search that resolves to a `HomeCity`. Used by the welcome and by /profile. */
export default function HomeCitySearch({ value, onPick }: { value: HomeCity | null; onPick: (home: HomeCity | null) => void }) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<GeoSuggestion[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === value?.name) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      suggestDestinations(q, 5).then((r) => { if (!cancelled) setResults(r); }).catch(() => { if (!cancelled) setResults([]); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, value?.name]);
  return (
    <div className="grid gap-2">
      <input value={query} onChange={(e) => { setQuery(e.target.value); if (value && e.target.value.trim() !== value.name) onPick(null); }} placeholder="Search your city" aria-label="Home city" autoComplete="off"
        className="rounded-2xl border border-card-border bg-white/5 px-4 py-3.5 text-lg text-foreground focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none" />
      <div role="listbox" className="grid gap-1">
        {(query.trim().length >= 2 ? results : []).map((r) => (
          <button key={`${r.lat},${r.lon}`} role="option" aria-selected={value?.name === r.name} type="button"
            onClick={() => { setQuery(r.name); setResults([]); onPick({ name: r.name, latitude: r.lat, longitude: r.lon }); }}
            className="flex justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5 aria-selected:bg-white/5">
            <span>{r.name}</span><span className="text-sm text-muted">{suggestionLabel(r).replace(`${r.name}, `, "")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
