"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { TripSummary } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import AccountReceipt from "@/components/AccountReceipt";
import { formatDateRange, formatMoney } from "@/lib/format";
import { failureFromResponse, failureFromThrown, type Failure } from "@/lib/failure";
import { useToast } from "@/lib/toast";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { DRAFT_TTL_DAYS } from "@/lib/drafts";
import { tripDays } from "@/lib/tiers";
import { monumentEms } from "@/lib/monumentFit";
import { city, clearsIn, country, featured, phase, phaseLine, postmark, rememberedLine } from "@/lib/memories";
import { useScrollContainer } from "@/lib/scrollContainer";
import { buildHeroOnly, useReveal, useSmoothScroll } from "@/components/polar/motion";

import "@/components/polar/PolarLanding.css";
import "@/components/polar/MemoriesWall.css";

/**
 * The first screen: the next trip still to come (or the one that started last), its photograph full
 * bleed and its city set across the foot as the monument, under the page's own sentence about
 * everything kept.
 *
 * The photograph resolves late (`usePlacePhoto` → Wikipedia), so the night ground is the permanent
 * layer and the photo fades in over it; a miss leaves the ground, never a hole back to the globe.
 */
function Hero({ trips }: { trips: TripSummary[] }) {
  const hero = featured(trips);
  const photo = usePlacePhoto(hero?.destination ?? "", "full");
  if (!hero) return null;
  const word = city(hero);
  return (
    <section className="ma-hero" aria-labelledby="ma-title" data-hero>
      {/* The landing's hero motion (`heroParallax`): the media holds still as the wall rises over it. */}
      <div className="tm-hero-media" aria-hidden="true">
        {photo && <Image key={photo} src={photo} alt="" fill priority sizes="100vw" className="ma-hero-img" />}
        <div className="ma-hero-scrim" />
        <div className="tm-hero-veil" />
      </div>
      <div className="ma-hero-copy" data-hero-copy>
        <p className="tm-eyebrow tm-on-dark ma-next">
          <span className="ma-dot" aria-hidden="true" />
          {phase(hero) === "past" ? "Most recent" : "Next"}: {word} · {phaseLine(hero)}
        </p>
        <h1 id="ma-title" className="tm-display tm-on-dark">
          My memories
        </h1>
        <p className="tm-kicker tm-on-dark ma-line">{rememberedLine(trips)}</p>
        <p className="tm-coord tm-on-dark-2">
          {hero.destination} · {formatDateRange(hero.startDate, hero.endDate)}
        </p>
      </div>
      {/* Sized in the font-size itself, where an em is still the parent's: the gutter is the hero's
          padding, not a margin on this element, whose own em is the word's size. */}
      <div className="tm-monument-wrap">
        <p
          className="tm-monument tm-on-dark ma-monument"
          style={{ fontSize: `min(calc((100cqw - 2 * var(--wd-pad)) / ${monumentEms(word).toFixed(3)}), 34vh)` }}
          aria-hidden="true"
        >
          {word}
        </p>
      </div>
    </section>
  );
}

function Postcard({ trip, onDelete }: { trip: TripSummary; onDelete: () => void }) {
  const photo = usePlacePhoto(trip.destination, "full");
  const draft = trip.status === "draft";
  const pm = postmark(trip);
  const days = tripDays(trip.startDate, trip.endDate);
  const clears = draft ? clearsIn(trip) : null;
  const word = city(trip);
  const place = country(trip);
  return (
    // The delete button is a *sibling* of the card's link, never a child: the whole card is one <a>,
    // and HTML forbids interactive content inside an anchor. It sits in the caption, on paper, level
    // with the destination: on the photograph it crowded the postmark in the same corner.
    <article className="ma-card">
      <Link href={`/trip/${trip.id}`} className="ma-card-link">
        <div className="ma-photo">
          {/* The typographic card is the base and never unmounts: a photo miss reads as the place's
              initial on the night ground rather than a grey box, and a hit fades in over it. */}
          <div className="ma-photo-type" aria-hidden="true">
            <span>{word.slice(0, 1)}</span>
          </div>
          {photo && (
            <Image
              key={photo}
              src={photo}
              alt=""
              fill
              sizes="(max-width: 680px) 100vw, (max-width: 1100px) 50vw, 33vw"
              className="ma-photo-img"
            />
          )}
          <span className="ma-stamp" aria-hidden="true">
            {word}
          </span>
          <span className="ma-postmark" aria-hidden="true">
            <em>{pm.month}</em>
            <b>{pm.year}</b>
          </span>
          {draft ? (
            <span className="ma-flag is-draft">Draft</span>
          ) : phase(trip) !== "past" ? (
            <span className="ma-flag">{phaseLine(trip)}</span>
          ) : null}
        </div>
        <div className="ma-caption">
          <h2 className="ma-dest">
            {word}
            {place && <span>{place}</span>}
          </h2>
          <p className="ma-meta">
            {formatDateRange(trip.startDate, trip.endDate)} · {days} {days === 1 ? "day" : "days"} ·{" "}
            {formatMoney(trip.budget)}
          </p>
          {clears && <p className="ma-clears">{clears}</p>}
        </div>
      </Link>
      <button
        type="button"
        className="ma-delete"
        onClick={onDelete}
        aria-label={draft ? `Discard your ${trip.destination} draft` : `Delete your ${trip.destination} trip`}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      </button>
    </article>
  );
}

/**
 * The two collections this page holds, and the toggle that switches between them.
 *
 * Kept as one page rather than a `/drafts` route because a draft *is* one of your trips — the same
 * itinerary, the same card — differing only in whether you have said you want it.
 */
type TripsTab = "memories" | "drafts";

export default function TripsView({
  initialTrips,
  initialDrafts = [],
}: {
  initialTrips: TripSummary[];
  /** Plans generated but never kept. Defaults to empty so a caller written before drafts existed
   *  still renders the page it used to. */
  initialDrafts?: TripSummary[];
}) {
  // Seeded by the server page, then owned locally so a delete can splice the list without a
  // refetch. A read that throws is caught by `error.tsx` beside this file.
  const [trips, setTrips] = useState<TripSummary[]>(initialTrips);
  const [drafts, setDrafts] = useState<TripSummary[]>(initialDrafts);
  const [tab, setTab] = useState<TripsTab>("memories");
  // The trip the dialog is asking about, which doubles as the dialog's open state and lets the
  // prompt name the destination without a second lookup.
  const [pendingDelete, setPendingDelete] = useState<TripSummary | null>(null);
  // Which trip a delete is in flight for, by id: a retry from a toast must not close or relabel a
  // dialog that is open for a different trip.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleting = deletingId !== null && deletingId === pendingDelete?.id;
  const { showError } = useToast();

  /**
   * Deletes `trip` and says why if it didn't happen (copy rows M-04 to M-06), as a toast: the dialog
   * has closed and the card it was about is either gone or still on the wall. "Try again" asks
   * again without the confirm, which was already answered.
   */
  async function deleteTrip(trip: TripSummary) {
    const what = trip.status === "draft" ? "draft" : "trip";
    setDeletingId(trip.id);
    // Which list it came from is read off the row's own status, not off the tab that was open:
    // a tab that stops being the source of truth for what a card *is* would leave a deleted trip
    // on screen and a live one spliced out.
    const removeById = (prev: TripSummary[]) => prev.filter((t) => t.id !== trip.id);
    const gone = () => (trip.status === "draft" ? setDrafts(removeById) : setTrips(removeById));
    const failed = (f: Failure) =>
      showError({
        code: f.kind === "offline" ? "M-06" : "M-05",
        title:
          f.kind === "offline"
            ? `You’re offline, so that ${what} wasn’t deleted.`
            : `That ${what} wasn’t deleted: TripMate’s server had a problem.`,
        detail: f.kind === "offline" ? "Try again once you’re back online." : "It’s still in your memories.",
        action: { label: "Try again", onClick: () => void deleteTrip(trip) },
      });
    try {
      const res = await fetch(`/api/trips/${trip.id}`, { method: "DELETE" });
      if (res.ok) gone();
      else {
        const f = await failureFromResponse(res, "edit");
        if (f.kind === "not_found") {
          // Already gone elsewhere: the wall was out of date, so the postcard goes either way.
          gone();
          showError({
            code: "M-04",
            title: `That ${what} was already gone, so there was nothing to delete.`,
            detail: "It may have been deleted in another tab or on another device.",
          });
        } else failed(f);
      }
    } catch (e) {
      failed(failureFromThrown(e));
    } finally {
      // Closed on failure too, so the toast isn't hidden behind it.
      setPendingDelete((p) => (p?.id === trip.id ? null : p));
      setDeletingId((id) => (id === trip.id ? null : id));
    }
  }

  // Drafts alone give this page a wall. The hero still keys on *saved* trips — a plan nobody kept
  // isn't a memory yet — but a traveller whose only plans are drafts must still find them here.
  const hasContent = trips.length > 0 || drafts.length > 0;
  // The toggle exists only when there is a second collection, so it can vanish from under the
  // traveller (discarding the last draft); the tab in force is derived every render, not trusted
  // from state, which would leave `tab` pointing at a list that is gone.
  const showTabs = drafts.length > 0;
  const activeTab: TripsTab = showTabs ? tab : "memories";
  const shown = activeTab === "drafts" ? drafts : trips;

  // The landing's smooth scroll and hero, and postcards that arrive as they scroll into view rather
  // than on load, under a full-screen hero where nobody sees them.
  const rootRef = useRef<HTMLElement>(null);
  useSmoothScroll(rootRef, useScrollContainer(), buildHeroOnly);
  useReveal([activeTab, shown.length], ".ma");

  // `map-chrome-hidden`: nothing on this page is a map being read, so the globe's controls stand down.
  return (
    <main ref={rootRef} className="tm ma map-chrome-hidden">
      {trips.length > 0 ? (
        <Hero trips={trips} />
      ) : (
        <section className="ma-empty" aria-labelledby="ma-empty-title">
          <p className="tm-kicker">Nothing kept yet.</p>
          <h1 id="ma-empty-title" className="tm-display">
            Your memories start here
          </h1>
          <p className="tm-body tm-muted">
            Plan a trip and it shows up here once you keep it: a postcard for every place you have been,
            and every place you are going.
          </p>
          <Link href="/" className="tm-signal tm-signal-lg">
            Plan your first trip
          </Link>
        </section>
      )}

      {hasContent && (
        <section className="ma-wall" aria-label="Your trips">
          <div className="ma-wall-head">
            {/* The one render after sign-up, above the wall it is talking about. */}
            <div className="ma-receipt">
              <AccountReceipt />
            </div>
            {/* Deliberately not `role="tablist"`: that role promises arrow-key navigation this
                markup doesn't implement. Two toggle buttons in a named group is what it is. */}
            {showTabs && (
              <div className="ma-tabs" role="group" aria-label="Which trips to show">
                <button type="button" aria-pressed={activeTab === "memories"} onClick={() => setTab("memories")}>
                  My memories <span>{trips.length}</span>
                </button>
                <button type="button" aria-pressed={activeTab === "drafts"} onClick={() => setTab("drafts")}>
                  Drafts <span>{drafts.length}</span>
                </button>
              </div>
            )}
            {/* Drafts appear without anybody asking for them, so the strip says why a plan is here
                that the traveller never kept, and that it will not sit here forever. */}
            {activeTab === "drafts" && (
              <p className="tm-body tm-muted ma-note">
                Plans you generated but haven&apos;t kept. Open one to carry on where you left off. Unkept
                drafts are cleared after {DRAFT_TTL_DAYS} days.
              </p>
            )}
          </div>

          {shown.length > 0 ? (
            <ul className="ma-cards">
              {shown.map((trip, i) => (
                // Staggered across a row (the wall is three wide), since each row now arrives on its own.
                <li key={trip.id} data-reveal-group style={{ ["--i" as string]: i % 3 }}>
                  <Postcard trip={trip} onDelete={() => setPendingDelete(trip)} />
                </li>
              ))}
            </ul>
          ) : (
            // Only reachable on the memories tab with drafts in hand. Says what turns a draft into a
            // memory, since that is the one move this traveller hasn't made yet.
            <p className="tm-body tm-muted ma-note">
              Nothing kept yet. Open a draft and press <em>Keep this trip</em>, and it becomes a memory here.
            </p>
          )}
        </section>
      )}

      <footer className="ma-foot">
        <p className="tm-caption tm-muted">Every journey here was planned in TripMate. Photographs via Wikipedia.</p>
      </footer>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.status === "draft" ? "Discard this draft?" : "Delete this trip?"}
        body={
          <>
            Your {pendingDelete?.destination} itinerary will be permanently deleted. This can&apos;t be
            undone.
          </>
        }
        confirmLabel={pendingDelete?.status === "draft" ? "Discard draft" : "Delete trip"}
        pending={deleting}
        pendingLabel={pendingDelete?.status === "draft" ? "Discarding…" : "Deleting…"}
        onConfirm={() => pendingDelete && void deleteTrip(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  );
}
