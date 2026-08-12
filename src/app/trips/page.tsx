"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Stamp } from "lucide-react";
import { TripSummary } from "@/lib/types";
import ErrorNote from "@/components/ErrorNote";
import DockedPanel from "@/components/DockedPanel";
import { formatDateRange, formatMoney } from "@/lib/format";
import { usePlacePhoto } from "@/lib/usePlacePhoto";

/** A small, stable tilt per trip so the stack doesn't re-shuffle on every render — derived
 *  from the id itself rather than `Math.random()`, which would pick a new angle on every
 *  re-render (a fresh save, a refetch) and make the "physical object" read as jittery. */
function tiltFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 41) / 10 - 2;
}

function MemoryPostcard({ trip }: { trip: TripSummary }) {
  const photo = usePlacePhoto(trip.destination, "full");
  return (
    <Link
      href={`/trip/${trip.id}`}
      style={{ transform: `rotate(${tiltFor(trip.id)}deg)` }}
      // `.memory-postcard`'s own box-shadow is plain unlayered CSS, which the cascade
      // layers spec puts above any `@layer`-emitted rule regardless of specificity —
      // including Tailwind's `ring-*` utilities, which compose onto `box-shadow` and
      // would render as invisible here. `outline` is a separate property, so the two
      // don't fight.
      className="memory-postcard pointer-events-auto block rounded-2xl p-2.5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
    >
      {/* Base tile paints first and never unmounts — the Constant-Ground Rule, same as
          ItineraryCard's header: a photo miss or a slow Wikipedia lookup must not leave a
          blank postcard, and a resolved photo must not repaint the card's own material. The
          photo itself lives on its own layer over that base, keyed on its URL, and fades in
          with .value-in rather than overwriting the tile's own paint — mirroring
          BlurredPhotoLayer (ItineraryCard.tsx) instead of a hard pop the moment it resolves. */}
      <div
        className="memory-postcard-photo relative h-36 overflow-hidden rounded-xl"
        style={{ backgroundColor: "var(--postcard-ink-muted)" }}
      >
        {photo && (
          <div
            key={photo}
            aria-hidden="true"
            className="value-in absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${photo})` }}
          />
        )}
        {/* A lucide icon rather than the comp's literal "TRIP/MATE" wordmark: repeating the
            brand mark at a size this small read as barely-legible clutter, and a stamp glyph
            carries the same postal motif without it. */}
        <div
          aria-hidden="true"
          className="absolute top-3 right-3 flex h-9 w-8 flex-col items-center justify-center gap-0.5 rounded-[3px] border border-dashed"
          style={{
            borderColor: "rgba(0,0,0,0.35)",
            backgroundColor: "rgba(255,255,255,0.35)",
            color: "rgba(0,0,0,0.45)",
          }}
        >
          <Stamp className="h-3.5 w-3.5" strokeWidth={2} />
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-2 px-1.5 pt-2.5 pb-1">
        <h2 className="font-display text-base font-semibold" style={{ color: "var(--postcard-ink)" }}>
          {trip.destination}
        </h2>
      </div>
      {/* Stacked rather than the comp's single baseline row: the comp only carried a date
          range, but keeping the budget figure (per an explicit ask, so the postcard's own
          caption doesn't lose data the old list showed) makes one row too long to stay
          legible at the docked panel's ~360-520px width. */}
      <div className="px-1.5 pb-1 text-xs tabular-nums" style={{ color: "var(--postcard-ink-muted)" }}>
        {formatDateRange(trip.startDate, trip.endDate)} · {formatMoney(trip.budget)} budget
      </div>
    </Link>
  );
}

export default function TripsPage() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Three things this has to get right, and it used to get none of them: check the
    // status (a 500 that renders the empty state tells you your saved trips are gone),
    // default the array (an error payload has no `trips` key, so this set state to
    // undefined and `trips.map` crashed the route on the very next render), and have
    // somewhere to put the failure.
    fetch("/api/trips")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setTrips(data.trips ?? []);
      })
      .catch(() => setError("We couldn't load your memories. Reload to try again."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="dashboard-page min-h-full">
      {/* Not collapsible: there is no route drawn on this surface, so there is no map
          under the panel worth revealing. */}
      <DockedPanel>
        {/* The page's own title. Its "New trip" action used to sit beside it here —
            moved into the global nav (Navbar.tsx), which now carries it on this route. */}
        <h1 className="hero-legible font-display text-2xl font-semibold tracking-tight text-foreground">
          My memories
        </h1>

        {loading && (
          <p role="status" className="text-sm text-muted">
            Loading your memories…
          </p>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        {!loading && !error && trips.length === 0 && (
          <div className="glass-itinerary rounded-2xl border-dashed p-8 text-center">
            {/* "No saved trips yet" on a page titled "My memories" named the same thing
                two ways in one viewport. */}
            <p className="text-sm text-muted">No memories yet.</p>
            <Link
              href="/"
              className="mt-3 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none active:scale-[0.98]"
            >
              Plan your first trip
            </Link>
          </div>
        )}

        {trips.length > 0 && (
          <ul className="memory-postcards space-y-5">
            {trips.map((trip) => (
              <li key={trip.id}>
                <MemoryPostcard trip={trip} />
              </li>
            ))}
          </ul>
        )}
      </DockedPanel>
    </main>
  );
}
