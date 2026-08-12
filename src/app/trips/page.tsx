"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Stamp } from "lucide-react";
import { TripSummary } from "@/lib/types";
import ErrorNote from "@/components/ErrorNote";
import { formatDateRange, formatMoney } from "@/lib/format";
import { usePlacePhoto } from "@/lib/usePlacePhoto";

/** One tile of the hero collage. A photo miss or slow lookup must not open a hole in the
 *  hero back to the live globe behind it — the tile's own solid slate base (matching
 *  MemoryPostcard's photo tile) is the permanent layer, the photo fades in over it. */
function HeroTile({ trip, className = "" }: { trip: TripSummary; className?: string }) {
  const photo = usePlacePhoto(trip.destination, "full");
  return (
    <div className={`relative overflow-hidden bg-[rgb(var(--surface-deep-rgb))] ${className}`}>
      {photo && (
        <div
          key={photo}
          aria-hidden="true"
          className="value-in absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${photo})` }}
        />
      )}
    </div>
  );
}

/**
 * The page's own opening beat, full-bleed like the landing page's Hero — occludes the
 * globe for one viewport-height stretch, then the postcard grid below returns to floating
 * over it. Two variants rather than one component with a loading branch: there's nothing
 * true to collage until there's at least one saved trip, so "no photos yet" and "no trips
 * yet" are the same state, not two.
 */
function MemoriesHero({ trips }: { trips: TripSummary[] }) {
  if (trips.length === 0) {
    return (
      <section className="relative flex min-h-dvh items-center justify-center overflow-hidden p-5 text-center sm:p-6">
        {/* No photo to collage, so the base system's own material carries the beat instead
            of reaching for stock imagery — a low-alpha accent wash over slate, matching the
            wider app's "one warm accent on a cool neutral field" rather than inventing a
            new palette for one empty state. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 70% at 50% 30%, rgba(255,179,64,0.10), transparent 65%), radial-gradient(80% 60% at 50% 100%, rgb(var(--surface-deep-rgb) / 0.92), transparent 70%), rgb(var(--surface-deep-rgb))",
          }}
        />
        <div className="relative z-10 max-w-lg">
          <h1 className="font-display text-4xl font-bold text-foreground sm:text-6xl">
            Your memories start here
          </h1>
          <p className="mt-3 text-base text-muted">
            Plan a trip and it&apos;ll show up here once you save it — a postcard for every
            place you&apos;ve been.
          </p>
          <Link
            href="/"
            className="group pointer-events-auto mt-7 inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none active:scale-[0.98]"
          >
            Plan your first trip
            <ArrowRight
              className="h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5"
              strokeWidth={2.25}
            />
          </Link>
        </div>
      </section>
    );
  }

  // Up to five tiles in a bento grid (one tall + four square) on a wide viewport; the same
  // five DOM tiles on a narrow one collapse to a 2x2 template and the hero's own
  // `overflow-hidden` quietly clips the two that don't fit rather than needing a second,
  // conditionally-rendered layout.
  const tiles = trips.slice(0, 5);
  const first = tiles[0]?.destination.split(",")[0];
  const last = tiles[tiles.length - 1]?.destination.split(",")[0];
  return (
    <section className="relative flex min-h-dvh items-end overflow-hidden p-5 sm:p-6">
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5 bg-[rgb(var(--surface-deep-rgb))] sm:grid-cols-[1.3fr_1fr_1fr]">
        {tiles.map((trip, i) => (
          <HeroTile key={trip.id} trip={trip} className={i === 0 ? "row-span-2" : ""} />
        ))}
      </div>
      {/* Same scrim shape ItineraryCard's own photo header uses (a slate wash from the
          Constant-Ground Rule's tokens, darkest where the heading sits), not a new one. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgb(var(--surface-deep-rgb) / 0.95), rgb(var(--surface-deep-rgb) / 0.5) 38%, transparent 70%)",
        }}
      />
      <div className="relative z-10 max-w-2xl">
        <h1 className="font-display text-5xl leading-[0.98] font-bold text-foreground sm:text-7xl">
          My memories
        </h1>
        <p className="mt-3 text-base tabular-nums text-foreground/75">
          {trips.length} {trips.length === 1 ? "trip" : "trips"} remembered
          {first && last && first !== last ? `, from ${first} to ${last}` : first ? `, starting with ${first}` : ""}.
        </p>
      </div>
    </section>
  );
}

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

  // `map-chrome-hidden` on all three returns below is a deliberate behaviour change, not
  // a copy of the plan step's own class list: this route used to leave the zoom/compass
  // stack visible, but the hero now occludes the globe entirely on arrival, and nothing on
  // this page — no route, no stop markers — is a map being *read*. Controls for a globe
  // you can't see, that point at nothing once you scroll past the hero, are noise. Removing
  // them was confirmed rather than assumed, since it takes away working controls.
  //
  // Loading and error are both simple, centered states that don't yet know how many trips
  // there are (or whether the fetch will ever succeed) — the hero needs that count to
  // decide which of its two variants to show, so neither state renders it at all rather
  // than guessing and having the page reflow into a different hero a moment later.
  if (loading) {
    return (
      <main className="dashboard-page map-chrome-hidden flex min-h-full items-center justify-center">
        <p role="status" className="text-sm text-muted">
          Loading your memories…
        </p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="dashboard-page map-chrome-hidden flex min-h-full items-center p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)]">
        <div className="pointer-events-auto mx-auto w-full max-w-5xl">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`dashboard-page map-chrome-hidden min-h-full ${
        trips.length > 0 ? "p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)]" : ""
      }`}
    >
      {/* Cancels this <main>'s own padding for the hero only, the same technique
          ScrollStory uses to take its landing beats full-bleed — everything below the
          hero (the grid) stays in the normal padded flow. No cancelling needed at all in
          the empty state, since that variant is the page's only content and already fills
          the full, unpadded viewport itself. */}
      <div
        className={
          trips.length > 0
            ? "-mx-5 -mt-[calc(var(--nav-h)+1.25rem)] sm:-mx-6 sm:-mt-[calc(var(--nav-h)+1.5rem)]"
            : ""
        }
      >
        <MemoriesHero trips={trips} />
      </div>

      {trips.length > 0 && (
        <div className="mx-auto max-w-5xl pt-10 sm:pt-12">
          <ul className="memory-postcards grid grid-cols-1 gap-5 sm:grid-cols-2">
            {trips.map((trip) => (
              <li key={trip.id}>
                <MemoryPostcard trip={trip} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
