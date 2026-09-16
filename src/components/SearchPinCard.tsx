"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Plus, X } from "lucide-react";

import { devLabel } from "@/lib/devInspector";
import { searchColourFor } from "@/lib/searchPalette";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import type { FoundPlace } from "@/lib/placeSearch";

/**
 * A photograph from the place's own Wikidata item, when OSM gave it one.
 *
 * Kept here rather than beside `wikidataPhoto` because that module reaches `fetchCache` and
 * therefore the database — it is a server module, and importing it from a component would put
 * `libsql` in the client bundle.
 *
 * A miss is the ordinary answer and is cached as such by the module-level map, so clicking back and
 * forth between two pins does not re-ask. `null` means asked-and-none; `undefined` means not yet.
 */
const wikidataPhotos = new Map<string, string | null>();
/** One request per id however many components ask at once, the way `usePlacePhoto` collapses its
 *  own — StrictMode's double-invoke alone would otherwise double every lookup. */
const wikidataInflight = new Map<string, Promise<void>>();

function useWikidataPhoto(qid: string | undefined): string | null | undefined {
  // Only to re-render when an answer lands. The answer itself is read from the module cache during
  // render, so there is no state to keep in step with it and nothing to set synchronously.
  const [, bump] = useState(0);

  useEffect(() => {
    if (!qid || wikidataPhotos.has(qid)) return;
    let alive = true;
    const existing = wikidataInflight.get(qid);
    const request =
      existing ??
      fetch(`/api/place-photo-wikidata?qid=${encodeURIComponent(qid)}`)
        .then((r) => r.json())
        .then((d: { url?: string | null }) => {
          wikidataPhotos.set(qid, d.url ?? null);
        })
        // A place with no photograph is the common case; failing to find out looks the same to a
        // traveller, and the card is built to be finished either way.
        .catch(() => {
          wikidataPhotos.set(qid, null);
        })
        .finally(() => {
          wikidataInflight.delete(qid);
        });
    wikidataInflight.set(qid, request);
    request.then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [qid]);

  if (!qid) return null;
  // `undefined` while in flight, so the frame is not rendered and then unrendered.
  return wikidataPhotos.get(qid);
}

/**
 * The place you clicked on the map, and what is known about it.
 *
 * Named for what it is anchored to, deliberately: `PlaceDetailPanel` already exists, is docked in
 * the itinerary column, describes a `Stop` that is already in the plan, and fills itself from a
 * model. This describes a `FoundPlace` that is not in the plan yet, sits on the map beside its own
 * dot, and invents nothing.
 *
 * **It is built for the case where almost nothing is known**, because that is the common case.
 * Measured across 60 named cafés in Siena: 90% have a street, 81% outdoor seating, 52% a phone,
 * 36% opening hours, 14% a website, and essentially none have a photograph. So every field is
 * conditional, the photo frame does not exist when there is no photo, and the card has to look
 * finished with a name, a category and a street — which is all a third of them will ever offer.
 * A reserved empty photo slot is the single fastest way to make this look cheap.
 */
export default function SearchPinCard({
  cardRef,
  place,
  addedDay,
  suggestionText,
  onClose,
  action,
  children,
}: {
  /** The anchoring hook writes `transform` straight onto this node every frame the camera moves,
   *  so it has to be the card itself — a wrapper would need a transform of its own to pass on. */
  cardRef: React.RefObject<HTMLElement | null>;
  place: FoundPlace;
  /** The day it is already on, if it has been added this session. */
  addedDay?: number;
  /** "Closest to Day 6 — 6.0km from its other stops", already computed for the row. */
  suggestionText?: string;
  /** The ✕ in the header, and Escape. */
  onClose: () => void;
  /** The "Add to a day" trigger — the card's one accent action, and now the only place in the whole
   *  search surface where a day can be chosen. */
  action?: React.ReactNode;
  /** The two-step day question itself, once that trigger has been pressed. */
  children?: React.ReactNode;
}) {
  /**
   * Two sources, asked in order of how much they actually know.
   *
   * The Wikidata id came from OpenStreetMap and points at a specific item, so where it exists it is
   * simply right. The Wikipedia-by-name lookup is a guess that pays off for famous landmarks and
   * misses everything else — measured, 2 of 8 names and 0 of 4 museums — so it is the fallback
   * rather than the first question.
   */
  const wikidataPhoto = useWikidataPhoto(place.wikidataId);
  const namePhoto = usePlacePhoto(place.name);
  const photo = wikidataPhoto ?? namePhoto;
  /**
   * Which place's photo failed, rather than whether *a* photo failed.
   *
   * The card does not unmount when you click a second pin — it swaps contents — so a boolean would
   * carry one place's broken image on to the next one. Keying it by id means there is nothing to
   * reset, which also keeps the effect below to the one job it actually has.
   */
  const [photoFailedFor, setPhotoFailedFor] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  /**
   * Focus moves to the heading when the card opens *and* when it becomes a different place.
   *
   * Keyed on the id rather than on mount because clicking a second pin swaps the contents of a card
   * that never unmounted — without this, a screen reader would announce nothing and a keyboard user
   * would be left holding focus on a row that now describes something else. Same reasoning, and the
   * same shape, as `PlaceDetailPanel`'s focus effect.
   */
  useEffect(() => {
    headingRef.current?.focus();
  }, [place.id]);

  const hasPhoto = !!photo && photoFailedFor !== place.id;

  /* Only the facts that exist. `DESIGN.md`: never show a heading for a value that isn't there. */
  const facts: [string, string][] = [];
  if (place.openingHours) facts.push(["Hours", place.openingHours]);
  if (place.cuisine) facts.push(["Serves", place.cuisine.replace(/[_;]/g, " ")]);
  if (place.outdoorSeating) facts.push(["Seating", "Tables outside"]);
  if (place.wheelchair === "yes") facts.push(["Access", "Step-free"]);
  if (place.wheelchair === "limited") facts.push(["Access", "Partly step-free"]);
  if (place.phone) facts.push(["Phone", place.phone]);

  return (
    <aside
      ref={cardRef as React.RefObject<HTMLDivElement>}
      aria-label={place.name}
      // Opened by a click and closed by one — hover opens nothing. The hover gesture read well on
      // a mouse and was unusable in practice: the card carries "Add to a day", so the journey that
      // matters ends in a *click*, and any pause to decide which place you are looking at raced a
      // timer. It also had no answer at all for touch. Not `role="dialog"`: this takes no focus
      // trap, so calling it one would promise a screen reader something that is not here.
      onKeyDown={(e) => {
        // Escape closes the card and stops there. Without this it reaches the panel's own handler,
        // which would clear the search text or shut the panel — throwing away the list behind a
        // card the traveller was only trying to dismiss.
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="search-pin-card pointer-events-auto"
      {...devLabel("SearchPinCard")}
    >
      {/* The frame exists only when there is something in it — no reserved hole, no grey slab.
          **The name sits below it, not on it.** Over the photograph the two were one bad
          aspect-ratio apart from colliding: the heading was pulled up into the frame by a fixed
          negative margin, so any image shorter than that margin plus the heading's own height put
          the street address on top of the picture. Below it, the overlap cannot happen at whatever
          size the card ends up, and the scrim that existed only to make the collision legible is
          gone with it. */}
      {hasPhoto && (
        <div className="search-pin-card-photo">
          {/* A raw `img`, following `StopList`'s: these are arbitrary external Wikipedia thumbnails,
              already about 320px wide, and `next/image` on an unconfigured host *throws* — which is
              what once took the whole of /trip/[id] down. The worst this can do is not load. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia thumbnails, already thumbnail-sized, and a throwing next/image would take the card's host down with it */}
          <img
            key={photo}
            src={photo}
            alt=""
            width={340}
            height={180}
            loading="lazy"
            onError={() => setPhotoFailedFor(place.id)}
            className="value-in h-full w-full object-cover contrast-105 saturate-110"
          />
        </div>
      )}

      <div className="search-pin-card-head">
        <div className="flex min-w-0 items-start gap-2">
          {/* The one map-native colour allowed in here, and only as the swatch the result rows
              already use: it is the single thing tying this card to its dot on the map. Nothing
              else in the card is tinted by category. */}
          <span
            aria-hidden="true"
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: searchColourFor(place.category) }}
          />
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="font-display min-w-0 text-base leading-tight focus-visible:outline-none"
          >
            {place.name}
          </h2>
        </div>
        {/* Small on purpose — the card is 272px wide and this is the least interesting thing on it.
            The 24px box is what shows; the negative margin lets the *tap* target stay a full 44px
            without the glyph growing to match, which is the usual way to keep a dismiss honest on
            touch without giving it visual weight it has not earned. */}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${place.name}`}
          className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/45 transition-colors hover:text-white focus-visible:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 pb-3">
        {place.address && <p className="text-xs text-muted">{place.address}</p>}

        {facts.length > 0 && (
          <dl className="mt-2 text-xs">
            {facts.map(([term, value]) => (
              <div
                key={term}
                className="flex items-baseline justify-between gap-3 border-t border-white/10 py-1.5"
              >
                <dt className="shrink-0 text-white/55">{term}</dt>
                <dd className="min-w-0 text-right text-muted">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* `=== undefined`, not `!addedDay`: day one is index zero, and a falsy check would put the
            "closest to" hint back on a place that had just been added to the first day. */}
        {suggestionText && addedDay === undefined && (
          <p className="mt-2 text-xs text-muted">{suggestionText}</p>
        )}

        {/* One row, because two stacked full-width actions was most of why this card was tall. The
            website is a *departure* — it leaves for somewhere else — so it reads as a link beside
            the action rather than as a second button competing with it. */}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {addedDay !== undefined ? (
            /* Terminal, and not a button — the place is in the plan, and the itinerary is where it
               gets moved or removed. Same stance the result row takes. */
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/20 px-2.5 py-1.5 text-[11px] font-medium text-accent">
              <Check className="h-3 w-3" strokeWidth={3} />
              Added · Day {addedDay + 1}
            </span>
          ) : (
            action
          )}
          {place.website && (
            <a
              href={place.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-xs text-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Website
            </a>
          )}
        </div>

        {/* The two-step day question, when it is open — full width below the row rather than inside
            it, because a day list squeezed beside a link is a day list nobody can read. */}
        {children}
      </div>

      {/* Drawn rather than positioned: the hook writes `--tail-x` so this keeps pointing at the dot
          even once the card has stopped following it into a screen corner. */}
      <span aria-hidden="true" className="search-pin-card-tail" />
    </aside>
  );
}

/** The plain "Add to a day" trigger, so the card and the row press the same-looking button. */
export function AddToDayButton({
  name,
  expanded,
  onClick,
}: {
  name: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={`Choose a day for ${name}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent px-3.5 text-xs font-medium text-accent-foreground transition-colors"
    >
      <Plus className="h-3.5 w-3.5" />
      Add to a day
    </button>
  );
}
