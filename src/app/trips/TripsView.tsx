"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Stamp, Trash2 } from "lucide-react";
import { TripSummary } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import ErrorNote from "@/components/ErrorNote";
import { formatDateRange, formatMoney } from "@/lib/format";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { useMapCamera } from "@/lib/mapCamera";

/** One tile of the hero collage. A photo miss or slow lookup must not open a hole in the
 *  hero back to the live globe behind it — the tile's own solid slate base (matching
 *  MemoryPostcard's photo tile) is the permanent layer, the photo fades in over it.
 *
 *  next/image, not a CSS background-image: a background-image on a box that also has
 *  overflow-hidden + a hover transform (this one, via the bento grid's own hover — and
 *  MemoryPostcard's) is a common trigger for the browser to promote it to its own
 *  GPU-composited layer, which can rasterize/scale the photo at a visibly softer filter
 *  quality than a plain <img> gets on the normal paint path. next/image also resizes and
 *  re-encodes server-side instead of shipping the raw ~3840px source and asking the
 *  browser to downscale it live — the same pipeline ImageRow already uses for the landing
 *  page's own photos, ported here rather than reinvented. */
function HeroTile({
  trip,
  sizes,
  className = "",
}: {
  trip: TripSummary;
  /** Comes from the active HERO_LAYOUTS entry, because how wide a tile actually renders is
   *  a property of the layout, not of the tile. Hardcoding one value here meant a one-trip
   *  hero — where the tile is the full viewport — still requested a 33vw candidate and
   *  rendered visibly soft, which is the failure the Optimized-Photo Rule exists to stop. */
  sizes: string;
  className?: string;
}) {
  const photo = usePlacePhoto(trip.destination, "full");
  return (
    <div className={`relative overflow-hidden bg-[rgb(var(--surface-deep-rgb))] ${className}`}>
      {photo && (
        <Image
          key={photo}
          src={photo}
          alt=""
          fill
          sizes={sizes}
          // contrast/saturate, not a color-grading pass: these tiles are real, uncurated
          // photos of whatever the destination happens to be — no art direction, no shared
          // exposure — unlike the landing page's hand-picked, edited scenes. The globe has
          // the same problem with Google's photorealistic tiles and solves it the same way
          // (DESIGN.md's Globe section: a deliberate, small colorBlendAmount "to return the
          // separation" a bare mid-grey tile lost) rather than pretending every source
          // photo already matches.
          className="value-in object-cover contrast-105 saturate-110"
        />
      )}
    </div>
  );
}

/**
 * How the collage composes itself for each possible tile count, 1 through 5.
 *
 * This used to be one fixed template — three columns by two rows above `sm`, with the first
 * tile always spanning both — regardless of how many trips existed. That only ever filled
 * cleanly at exactly five: at one trip four of its cells had no tile in them and rendered as
 * the container's own bare slate, so the hero read as a single photo beside a large empty
 * block rather than as a collage.
 *
 * `spans` lists the row-span class for tiles by index; anything past its end gets none. The
 * asymmetric 1.3fr hero column only appears from three tiles up, where there is something
 * for it to be asymmetric *against* — at two tiles a 1.3fr/1fr split just reads as a
 * mistake, so that count uses even columns instead.
 *
 * Every class here is written as a complete literal string. Tailwind scans source text and
 * cannot see a class built by interpolation, so `grid-cols-${n}` would compile to nothing.
 */
const HERO_LAYOUTS: Record<number, { grid: string; spans: string[]; sizes: string }> = {
  // One trip: the tile is the whole hero, so the photo is requested at full viewport width.
  1: { grid: "grid-cols-1 grid-rows-1", spans: [], sizes: "100vw" },
  // Two: stacked on a phone (a landscape photo cut to a half-width sliver loses its
  // subject), side by side above `sm`.
  2: {
    grid: "grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1",
    spans: [],
    sizes: "(max-width: 640px) 100vw, 50vw",
  },
  // Three: the hero column arrives, with two stacked beside it at both sizes.
  3: {
    grid: "grid-cols-2 grid-rows-2 sm:grid-cols-[1.3fr_1fr]",
    spans: ["row-span-2"],
    sizes: "(max-width: 640px) 50vw, 45vw",
  },
  // Four: tile 2 takes a row-span of its own above `sm`. Without it the fourth tile wraps
  // and leaves the bottom-right cell empty — the same hole this table exists to close.
  // Below `sm` the four sit as even quadrants, so neither tile spans there.
  4: {
    grid: "grid-cols-2 grid-rows-2 sm:grid-cols-[1.3fr_1fr_1fr]",
    spans: ["sm:row-span-2", "sm:row-span-2"],
    sizes: "(max-width: 640px) 50vw, 33vw",
  },
  // Five: the original composition, which already filled every cell.
  5: {
    grid: "grid-cols-2 grid-rows-2 sm:grid-cols-[1.3fr_1fr_1fr]",
    spans: ["row-span-2"],
    sizes: "(max-width: 640px) 50vw, 33vw",
  },
};

/**
 * The page's own opening beat, full-bleed like the landing page's Hero — occludes the
 * globe for one viewport-height stretch, then the postcard grid below returns to floating
 * over it. Two variants rather than one component with a loading branch: there's nothing
 * true to collage until there's at least one saved trip, so "no photos yet" and "no trips
 * yet" are the same state, not two.
 *
 * Both variants' outermost `<section>` carries `pointer-events-auto`, not just their
 * individual buttons/links — this page's content sits inside AppShell's own
 * `pointer-events-none` scroll container (that's what keeps the Cesium globe underneath
 * draggable), so a wheel event over any patch of the hero with no `pointer-events-auto`
 * anywhere in its hit-test chain passes straight through to the globe canvas instead of
 * scrolling the page, and Cesium consumes it as a zoom rather than letting it bubble. Most
 * of a full-bleed hero's own area is prose and decoration, not a button, so leaving
 * `pointer-events-auto` off the section and only on its one CTA link was reachable but
 * left almost the entire viewport unscrollable — confirmed by trying to scroll past it.
 * `Hero.tsx` and `.scene-band` already opt the whole section in for the same reason; this
 * follows that precedent instead of the narrower "just the leaf controls" reading of the
 * Pointer-Events Opt-In Rule.
 */
function MemoriesHero({ trips }: { trips: TripSummary[] }) {
  if (trips.length === 0) {
    return (
      <section className="pointer-events-auto relative flex min-h-dvh items-center justify-center overflow-hidden p-5 text-center sm:p-6">
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

  // Up to five tiles in a bento grid whose shape follows the count (see HERO_LAYOUTS), so
  // every cell holds a photo at any number of saved trips. At five on a narrow viewport the
  // last two still fall outside the 2x2 template and the hero's own `overflow-hidden`
  // quietly clips them — that clipping is deliberate and unchanged; what the table fixes is
  // empty cells, not overflow.
  const tiles = trips.slice(0, 5);
  const layout = HERO_LAYOUTS[tiles.length];
  const first = tiles[0]?.destination.split(",")[0];
  const last = tiles[tiles.length - 1]?.destination.split(",")[0];
  return (
    <section className="pointer-events-auto relative flex min-h-dvh items-end overflow-hidden p-5 sm:p-6">
      <div className={`absolute inset-0 grid gap-0.5 bg-[rgb(var(--surface-deep-rgb))] ${layout.grid}`}>
        {tiles.map((trip, i) => (
          <HeroTile key={trip.id} trip={trip} sizes={layout.sizes} className={layout.spans[i] ?? ""} />
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

function MemoryPostcard({ trip, onDelete }: { trip: TripSummary; onDelete: () => void }) {
  const photo = usePlacePhoto(trip.destination, "full");
  return (
    // The delete button is a *sibling* of the card, never a child: the whole postcard is
    // one <a>, and HTML forbids interactive content inside an anchor — nesting a <button>
    // there is invalid, and browsers resolve the overlap unpredictably. This wrapper is
    // what gives the button a positioning context and what `.memory-postcard-slot:hover /
    // :focus-within` keys the reveal off, so hovering the card (or tabbing into it) is
    // what surfaces the control.
    <div className="memory-postcard-slot relative">
    <Link
      href={`/trip/${trip.id}`}
      // The resting tilt is a CSS custom property, not a `transform` written here directly —
      // an inline `transform` would permanently outrank the stylesheet's own
      // `:hover`/`:focus-visible` rule that straightens the card, no matter how that rule's
      // specificity compares, so the straighten-on-hover motion would never play.
      style={{ "--tilt": `${tiltFor(trip.id)}deg` } as React.CSSProperties}
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
      {/* 200px, not the h-36 (144px) this started at — at this card's own width that was
          roughly a 3:1 letterbox, and a landscape photo whose subject is a single tall
          landmark (a tower, a bridge) center-crops straight through the part of the photo
          that made it recognizable. 200px matches the Tier Cards' own established photo
          height (DESIGN.md: "a three-up grid of 200px-tall image buttons") rather than
          inventing a second photo aspect ratio for the same kind of card. */}
      <div
        className="memory-postcard-photo relative h-[200px] overflow-hidden rounded-xl"
        style={{ backgroundColor: "var(--postcard-ink-muted)" }}
      >
        {/* next/image, not a CSS background-image — see HeroTile's own comment for why a
            background-image on an overflow-hidden + hover-transform box like this one
            rasterizes softer than a plain <img>, independent of the source file's own
            resolution. */}
        {photo && (
          <Image
            key={photo}
            src={photo}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            // See HeroTile's own comment: same real-photo inconsistency, same fix.
            className="value-in object-cover contrast-105 saturate-110"
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
      {/* 22px inset mirrors the stamp opposite it — the card's own 10px padding plus the
          stamp's top-3 within the photo tile — rather than a new spacing value. Dark glass
          on the one slate, not a light chip: this sits on an arbitrary destination photo,
          so it darkens (the Darken-Never-Lighten Rule) and only turns red on intent. */}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete your ${trip.destination} trip`}
        className="memory-postcard-delete pointer-events-auto absolute top-[22px] left-[22px] flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--surface-deep-rgb)/0.72)] text-white backdrop-blur-sm hover:bg-red-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
      >
        <Trash2 className="h-4 w-4" strokeWidth={2.25} />
      </button>
    </div>
  );
}

export default function TripsView({ initialTrips }: { initialTrips: TripSummary[] }) {
  // Seeded by the server page, then owned locally so a delete can splice the list without a
  // refetch. There is no `loading` here any more, and no fatal `error` either: the read is a
  // synchronous SQLite call inside the page component, so the list is already correct on first
  // paint, and a read that throws is caught by `error.tsx` beside this file rather than by a
  // state branch that renders the whole route as a message.
  const [trips, setTrips] = useState<TripSummary[]>(initialTrips);
  // The trip the dialog is currently asking about — holding the whole summary rather than
  // an id lets the prompt name the destination without a second lookup, and doubles as the
  // dialog's own open/closed state.
  const [pendingDelete, setPendingDelete] = useState<TripSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Deliberately not the `error` above. That one is fatal — it early-returns a page with
  // nothing but the message, which is right when the trips never loaded. A delete that
  // failed leaves a perfectly good grid on screen, so reusing `error` would blank the very
  // list the message is about.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { resetToHome } = useMapCamera();

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/trips/${pendingDelete.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error);
      }
      // Splice locally rather than refetch: the list is already in hand and the server has
      // no other change to report. Deleting the last trip drops `trips.length` to 0, which
      // is what flips the hero to its empty variant and drops <main>'s padding — both are
      // already keyed on that count, so neither needs its own branch here.
      setTrips((prev) => prev.filter((t) => t.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (e) {
      // The dialog closes on failure so the error underneath isn't hidden behind it; the
      // card stays put, which is the honest reflection of a delete that didn't happen.
      setPendingDelete(null);
      setDeleteError(
        e instanceof Error && e.message ? e.message : "We couldn't delete that trip. Try again."
      );
    } finally {
      setDeleting(false);
    }
  }

  // Mount-only, mirroring page.tsx's own reset effect: the globe lives above the route
  // boundary and never unmounts, so arriving here from /trip/[id] (which flies to that
  // trip's destination and stops) would otherwise leave the camera, its marker pin, and
  // its drawn route exactly where that page last left them — visible through this page's
  // own grid gaps once the hero scrolls past. `page.tsx` only ever needed to handle the
  // opposite direction (/trips → /), back when this page never touched the camera at all;
  // now that its hero/grid keep the globe on screen, this side needs the same reset too.
  useEffect(() => {
    resetToHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `map-chrome-hidden` is a deliberate behaviour change, not
  // a copy of the plan step's own class list: this route used to leave the zoom/compass
  // stack visible, but the hero now occludes the globe entirely on arrival, and nothing on
  // this page — no route, no stop markers — is a map being *read*. Controls for a globe
  // you can't see, that point at nothing once you scroll past the hero, are noise. Removing
  // them was confirmed rather than assumed, since it takes away working controls.
  //
  // There used to be centered loading and error returns above this one, both of which
  // deliberately withheld the hero because they didn't yet know the trip count the hero needs to
  // pick its variant. Neither exists now: the count arrives with the first render, so the hero
  // never has to guess and the page can no longer reflow into a different hero a moment later.
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
        <div className="pointer-events-auto mx-auto max-w-5xl pt-10 sm:pt-12">
          {/* A delete that failed reports here rather than inside the dialog, which has
              already closed — the grid it refers to is what's on screen. */}
          {deleteError && (
            <div className="mb-5">
              <ErrorNote>{deleteError}</ErrorNote>
            </div>
          )}
          <ul className="memory-postcards grid grid-cols-1 gap-5 sm:grid-cols-2">
            {trips.map((trip) => (
              <li key={trip.id}>
                <MemoryPostcard trip={trip} onDelete={() => setPendingDelete(trip)} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this trip?"
        body={
          <>
            Your {pendingDelete?.destination} itinerary will be permanently deleted. This
            can&apos;t be undone.
          </>
        }
        confirmLabel="Delete trip"
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  );
}
