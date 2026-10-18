"use client";

import { useEffect, useRef, useState } from "react";
import { PlaceDetail, Stop } from "@/lib/types";
import { locationNote } from "@/lib/evidence";
import type { PlaceGallery } from "@/app/api/place-gallery/route";
import BackButton from "@/components/BackButton";
import { devLabel } from "@/lib/devInspector";
import { formatMoney } from "@/lib/format";
import InlineNote from "@/components/InlineNote";
import { formatWait, heldUntil, useHold } from "@/lib/actionHolds";
import { formatResumeTime, type Failure } from "@/lib/failure";
import { formatClockTime, holdSentence, WAIT } from "@/lib/toastQueue";

/** The field labels inside this panel. Uppercase is a field-label device in this
 *  system, but a styled div is not a heading — these were unreachable by heading
 *  navigation, which is the main way a long panel gets skimmed. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{children}</h2>
  );
}

const EMPTY_GALLERY: PlaceGallery = {
  hero: null,
  more: [],
  extract: null,
  address: null,
  website: null,
  phone: null,
  openingHours: null,
  wheelchair: null,
};

/**
 * Everything free sources know about the stop, fetched once per stop.
 *
 * Separate from the `detail` prop — which the host fetches from the model — because the two arrive
 * on completely different clocks: this is cached HTTP measured at 34-55ms warm, that is a ~6s model
 * call. Waiting for one to show the other would hold a photograph behind a paragraph.
 */
function usePlaceGallery(stop: Stop): PlaceGallery {
  const key = `${stop.name}@${stop.lat},${stop.lng}`;
  const [state, setState] = useState({ key, data: EMPTY_GALLERY });

  // Render-phase adjustment when the stop changes, not a `setState` in the effect below — same
  // pattern and same reason as `usePlacePhoto`, which React documents as "adjusting some state
  // when a prop changes". Clearing in the effect would paint the previous place's photographs
  // under the new place's name for a frame.
  if (state.key !== key) setState({ key, data: EMPTY_GALLERY });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/place-gallery?${new URLSearchParams({ name: stop.name, lat: String(stop.lat), lng: String(stop.lng) })}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PlaceGallery | null) => {
        if (!cancelled && data) setState({ key, data: { ...EMPTY_GALLERY, ...data } });
      })
      // The route answers 200-with-nothing rather than erroring, so the only way here is the
      // network itself, and the panel's whole design is that any of this can be absent.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, stop.name, stop.lat, stop.lng]);

  return state.key === key ? state.data : EMPTY_GALLERY;
}

type TabId = "overview" | "verdict" | "practical" | "plan";

export default function PlaceDetailPanel({
  stop,
  detail,
  loading,
  error,
  onRetry,
  onBack,
  actualCost,
  onActualCostChange,
  actualCostNote = "",
  onRetryActualCost,
  upcomingStops,
  onSelectUpcoming,
  polar = false,
}: {
  /** Drawn in Polar on ice (the trip page's drawer, canvas "Trip page · B"). Same tabs, same content. */
  polar?: boolean;
  stop: Stop;
  detail: PlaceDetail | null;
  loading: boolean;
  error: Failure | null;
  /** Asks for this stop's details again: the failure's Try again, and the end of a limit's wait. */
  onRetry?: () => void;
  onBack: () => void;
  actualCost?: number;
  onActualCostChange?: (value: number | undefined) => void;
  /** Copy row T-05: why the actual amount didn't save. Empty while there is nothing to say. */
  actualCostNote?: string;
  onRetryActualCost?: () => void;
  /** Remaining stops for the same day, in order — powers the "Next up" quick-nav list. */
  upcomingStops?: Stop[];
  onSelectUpcoming?: (stop: Stop) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const gallery = usePlaceGallery(stop);

  /**
   * The open tab, reset whenever the stop changes.
   *
   * A render-phase adjustment rather than an effect — the same pattern `usePlacePhoto` uses and
   * React documents as "adjusting some state when a prop changes". `setActive("overview")` inside
   * the focus effect below is what this replaced, and React 19's `set-state-in-effect` rule
   * rejects it: it would render the previous stop's tab once before correcting.
   *
   * It has to reset at all because "Next up" swaps the content **without remounting** — arriving at
   * a new place three tabs deep into the last one is somebody else's reading position, not yours.
   */
  const [tab, setTab] = useState({ name: stop.name, active: "overview" as TabId });
  if (tab.name !== stop.name) setTab({ name: stop.name, active: "overview" });
  const active = tab.active;
  const setActive = (next: TabId) => setTab({ name: stop.name, active: next });

  // Selecting a stop unmounts the row that had focus, so focus lands on <body> and
  // a keyboard or screen-reader user is left at the top of the document with no
  // indication the panel opened. Move it to the panel's own heading instead — and
  // re-run per stop, because "Next up" swaps the content without remounting.
  useEffect(() => {
    headingRef.current?.focus();
  }, [stop.name]);

  const numberFieldClass =
    "h-11 w-24 rounded-md border border-card-border bg-white/10 pr-2 pl-6 text-base tabular-nums text-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

  const hasVerdict = !!(detail?.pros?.length || detail?.cons?.length);
  const hasPractical = !!(
    gallery.address ||
    gallery.openingHours ||
    gallery.phone ||
    gallery.website ||
    gallery.wheelchair
  );

  /**
   * Only tabs that have something behind them.
   *
   * Built from the data rather than declared, because two of the four cannot be promised: "Pros &
   * cons" waits on a model call and "Practical" on whether OpenStreetMap has ever been told this
   * venue's phone number — measured at 52% for cafés, and lower again for a stop whose name is a
   * description rather than a signboard. A tab that opens onto nothing is worse than an absent one:
   * it is a promise the panel breaks after you have paid a click for it.
   */
  const tabs = (
    [
      ["overview", "Overview"],
      hasVerdict ? (["verdict", "Pros & cons"] as const) : null,
      hasPractical ? (["practical", "Practical"] as const) : null,
      ["plan", "In your plan"],
    ] as ([TabId, string] | null)[]
  ).filter(Boolean) as [TabId, string][];

  // Roving tabindex, the contract `ItineraryCard`'s day tabs implement and the reason this claims
  // `role="tab"` at all: `TripsView` records that claiming the role without the arrow keys "is
  // worse for a screen reader user than not claiming it, because it promises navigation that isn't
  // there". The row is one stop in the tab order and the arrows move within it.
  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex(([id]) => id === active);
    const next =
      event.key === "ArrowRight"
        ? index + 1
        : event.key === "ArrowLeft"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next === -1) return;
    event.preventDefault();
    const clamped = Math.max(0, Math.min(tabs.length - 1, next));
    setActive(tabs[clamped][0]);
    tabRefs.current[clamped]?.focus();
  };

  const meta = [stop.time, stop.durationLabel, stop.category].filter(Boolean);

  const tabList = (className: string, tabClass: (on: boolean) => string) => (
    <div role="tablist" aria-label={`About ${stop.name}`} aria-orientation="horizontal" className={className}>
      {tabs.map(([id, label], i) => (
        <button
          key={id}
          ref={(el) => {
            tabRefs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`place-tab-${id}`}
          aria-selected={active === id}
          aria-controls="place-tabpanel"
          tabIndex={active === id ? 0 : -1}
          onClick={() => setActive(id)}
          onKeyDown={onTabKeyDown}
          className={tabClass(active === id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  const tabPanel = (className: string) => (
    <div id="place-tabpanel" role="tabpanel" aria-labelledby={`place-tab-${active}`} tabIndex={-1} className={className}>
      {active === "overview" && <Overview stop={stop} detail={detail} loading={loading} error={error} onRetry={onRetry} gallery={gallery} />}
      {active === "verdict" && detail && <Verdict detail={detail} />}
      {active === "practical" && <Practical gallery={gallery} stop={stop} />}
      {active === "plan" && (
        <InYourPlan
          stop={stop}
          actualCost={actualCost}
          onActualCostChange={onActualCostChange}
          actualCostNote={actualCostNote}
          onRetryActualCost={onRetryActualCost}
          numberFieldClass={numberFieldClass}
          upcomingStops={upcomingStops}
          onSelectUpcoming={onSelectUpcoming}
        />
      )}
    </div>
  );

  // The canvas's order: back, the photographs, the when, the name in the display face, where the
  // pin stands, then the tabs on a hairline with the signal under the open one.
  if (polar) {
    return (
      <div className="td-detail" {...devLabel("PlaceDetailPanel")}>
        <button type="button" className="td-back" onClick={onBack}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to itinerary
        </button>
        <PlaceMosaic gallery={gallery} name={stop.name} />
        {meta.length > 0 && <p className="td-eyebrow">{meta.join(" · ")}</p>}
        <h1 ref={headingRef} tabIndex={-1} className="td-title">
          {stop.name}
        </h1>
        {stop.note && <p className="td-note">{stop.note}</p>}
        {locationNote(stop.located) && <p className="td-prov">{locationNote(stop.located)!.value}</p>}
        {tabList("td-tabs", () => "")}
        {tabPanel("td-prose")}
      </div>
    );
  }

  return (
    // No `overflow-hidden` anywhere on this card, and the photo mosaic is inset rather than bled to
    // the corners *because* of that: the tab bar below is `position: sticky`, and an `overflow` on
    // any ancestor kills sticky silently — globals.css records the same failure taking down the
    // itinerary's compressing hero, where "scrolling to 40, 80, 120 and 160px all settled back at
    // 0". A bleed is not worth trading a working sticky header for.
    <div
      className="glass-itinerary flex flex-col rounded-none sm:rounded-2xl"
      {...devLabel("PlaceDetailPanel")}
    >
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <BackButton onClick={onBack} className="mb-4">
          Back to itinerary
        </BackButton>

        {/* tabIndex={-1} makes the heading a focus target without putting it in the tab
            order — it is where focus goes when this panel replaces the itinerary. */}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-2xl font-semibold text-foreground focus-visible:outline-none"
        >
          {stop.name}
        </h1>
        {meta.length > 0 && (
          <p className="mt-1.5 text-sm text-muted">
            {meta.map((part, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                <span className={i === 2 ? "capitalize" : undefined}>{part}</span>
              </span>
            ))}
          </p>
        )}
        {stop.note && <p className="mt-2 text-sm text-foreground/90">{stop.note}</p>}
        {/* **What the pin is standing on**, in the same words the mobile client uses — both read
            `locationNote`, so the two cannot drift into telling a traveller different things
            about the same stop. That drift is the whole reason the vocabulary is shared rather
            than written per client. Nothing at all on a plan saved before it was recorded. */}
        {locationNote(stop.located) && (
          <p className="mt-2 text-xs tracking-wide text-muted uppercase">
            {locationNote(stop.located)!.value}
          </p>
        )}

        <PlaceMosaic gallery={gallery} name={stop.name} />
      </div>

      {/* Sticky so the place keeps its name and its tabs while a long entry scrolls under them —
          the panel had no sticky anything before this, and the back button scrolled away with
          everything else. `.docked-panel-body` is the scroller this sticks inside. */}
      <div className="glass-itinerary sticky top-0 z-10 mt-5 border-b border-card-border px-5 sm:px-6">
        {tabList("scrollbar-none -mb-px flex gap-1 overflow-x-auto", (on) =>
          `min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset ${
            on ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`
        )}
      </div>

      {tabPanel("px-5 pt-5 pb-5 text-sm focus-visible:outline-none sm:px-6 sm:pb-6")}
    </div>
  );
}

/**
 * The photographs, in the reference's one-large-four-small arrangement.
 *
 * **The large tile is always the curated image** — Wikipedia's chosen lead, or Wikidata's P18. The
 * small ones come from a Commons *category*, which is on-subject but alphabetical and unranked, so
 * it can open on a fountain in the garden or a panorama of the next ridge. See the note on
 * `/api/place-gallery` for why a category and not a geosearch.
 *
 * Three states and no reserved space in any of them. Roughly one stop in seven has a photograph at
 * all (measured over a 20-stop Paris trip), so a frame held open for one is a hole far more often
 * than it is a picture — which is the rule `placePhotos.ts` states and the story-mode beat plate
 * relearned by shipping the other way first.
 */
function PlaceMosaic({ gallery, name }: { gallery: PlaceGallery; name: string }) {
  const { hero, more } = gallery;
  if (!hero) return null;

  const tile =
    "relative overflow-hidden rounded-lg bg-white/5 [&>img]:absolute [&>img]:inset-0 [&>img]:h-full [&>img]:w-full [&>img]:object-cover";

  if (more.length < 4) {
    return (
      <div className="mt-4 space-y-1.5">
        <div className={`${tile} aspect-[16/9]`}>
          <Photo src={hero} name={name} />
        </div>
        {more.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {more.map((src) => (
              <div key={src} className={`${tile} aspect-square`}>
                <Photo src={src} name={name} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    // 1.5fr for the hero against two equal columns: the same proportion the reference uses, and it
    // keeps the four small tiles square at this panel's width.
    <div className="mt-4 grid grid-cols-[1.5fr_1fr_1fr] grid-rows-2 gap-1.5">
      <div className={`${tile} col-span-1 row-span-2`}>
        <Photo src={hero} name={name} />
      </div>
      {more.slice(0, 4).map((src) => (
        <div key={src} className={`${tile} aspect-square`}>
          <Photo src={src} name={name} />
        </div>
      ))}
    </div>
  );
}

/** A tile's picture. Fades in on `value-in` as its own decode lands, the way `StopAvatar` does, so
 *  a mosaic assembles rather than appearing in one jump — the tiles resolve at different times
 *  regardless and pretending otherwise would mean holding all five back for the slowest. */
function Photo({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikimedia thumbnails; next/image *throws* on an unconfigured host, which once took the whole of /trip/[id] down
    <img
      src={src}
      alt=""
      loading="lazy"
      // Decorative: the heading above names the place and the tiles carry no information a
      // screen-reader user would otherwise miss. An alt per tile would be the name, five times.
      aria-hidden="true"
      title={name}
      onError={() => setFailed(true)}
      className="value-in"
    />
  );
}

/** Copy rows T-75..T-80. `{mm:ss}` (T-78) is filled by `DetailFailure`. */
function detailFailureText(f: Failure, name: string): string {
  switch (f.kind) {
    case "offline":
      return `You’re offline, so the details for ${name} didn’t load. Try again once you’re back online.`;
    case "timeout":
      return `Writing the details for ${name} took too long, so it stopped. Try again.`;
    case "rate_limited":
      return `You’ve opened the details of 10 places in the last 10 minutes, which is the limit. You can open ${name}’s in ${WAIT}. The plan and the map work as normal.`;
    case "daily_cap":
      return `Place details are paused for everyone until ${formatResumeTime(f.resumesAt)}. TripMate has reached its limit for the day; it isn’t anything you did. The plan, photos and map still work.`;
    // The server wrote this sentence (copy rows SV-14..SV-17, SV-20); shown as it is, with nothing to retry.
    case "refused":
      return f.message;
    case "invalid":
      return "TripMate couldn’t tell which place this is. Close it and open the stop again.";
    default:
      return `TripMate couldn’t write the details for ${name} just now. Try again.`;
  }
}

/** The details' failure, in the Overview's place. A limit holds Try again as "Try again in {mm:ss}"
 *  and asks again by itself when the wait ends (T-78). */
function DetailFailure({ failure, name, onRetry }: { failure: Failure; name: string; onRetry?: () => void }) {
  const limited = failure.kind === "rate_limited";
  // The bucket the server named, not an assumed one: the wait shown is the wait that was set.
  const { secondsLeft } = useHold(limited ? failure.bucket : "place-detail");
  const over = limited && secondsLeft === null;
  // A ref, so the host's per-render callback does not re-fire the effect while the wait is over.
  const retry = useRef(onRetry);
  useEffect(() => {
    retry.current = onRetry;
  });
  useEffect(() => {
    if (over) retry.current?.();
  }, [over]);

  const text = detailFailureText(failure, name);
  const action =
    failure.kind === "daily_cap" || failure.kind === "invalid" || failure.kind === "refused" || !onRetry
      ? undefined
      : limited
        ? { label: secondsLeft === null ? "Try again" : `Try again in ${formatWait(secondsLeft)}`, onClick: onRetry, busy: secondsLeft !== null }
        : { label: "Try again", onClick: onRetry };
  return (
    <InlineNote size="section" tone="error" action={action}>
      {limited && secondsLeft !== null ? (
        <>
          {/* Ticking for the eye; read once, with the end as a clock time (P-37a). */}
          <span aria-hidden="true">{text.replace(WAIT, formatWait(secondsLeft))}</span>
          <span className="sr-only">{holdSentence(text, formatClockTime(heldUntil(failure.bucket) ?? 0))}</span>
        </>
      ) : (
        text.replace(WAIT, "0:00")
      )}
    </InlineNote>
  );
}

function Overview({
  stop,
  detail,
  loading,
  error,
  onRetry,
  gallery,
}: {
  stop: Stop;
  detail: PlaceDetail | null;
  loading: boolean;
  error: Failure | null;
  onRetry?: () => void;
  gallery: PlaceGallery;
}) {
  return (
    // The guidebook text arrives from a model call per stop and nothing here is
    // instant, so the region announces its own state rather than filling silently.
    <div className="space-y-4" aria-busy={loading} aria-live="polite">
      {loading && (
        <>
          <span className="sr-only">Looking up {stop.name}…</span>
          <div className="animate-pulse space-y-3" aria-hidden="true">
            <div className="h-3 w-full rounded bg-foreground/10" />
            <div className="h-3 w-5/6 rounded bg-foreground/10" />
            <div className="h-3 w-2/3 rounded bg-foreground/10" />
          </div>
        </>
      )}

      {error && !loading && <DetailFailure failure={error} name={stop.name} onRetry={onRetry} />}

      {detail && !loading && (
        <>
          {detail.history && <p className="leading-relaxed text-foreground/90">{detail.history}</p>}
          {detail.bestTime && (
            <div>
              <FieldLabel>Best time to visit</FieldLabel>
              <p className="mt-1 text-foreground/90">{detail.bestTime}</p>
            </div>
          )}
          {detail.duration && (
            <div>
              <FieldLabel>Suggested duration</FieldLabel>
              <p className="mt-1 text-foreground/90">{detail.duration}</p>
            </div>
          )}
          {/* Guarded: an empty tips array used to leave the heading standing over an
              empty list. */}
          {detail.tips?.length > 0 && (
            <div>
              <FieldLabel>Tips</FieldLabel>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/90">
                {detail.tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Wikipedia's own paragraph, last: it is the encyclopaedic account, where everything above
          it is written about this trip. It arrives on a different clock from the model call and
          survives the model failing entirely, which is the other reason it is not folded in. */}
      {gallery.extract && (
        <div className="border-t border-card-border pt-4">
          <FieldLabel>From Wikipedia</FieldLabel>
          <p className="mt-1 leading-relaxed text-foreground/80">{gallery.extract}</p>
        </div>
      )}

      {/* A response can succeed and carry nothing — the panel body was then simply
          blank, with no loading, no error and nothing to read. */}
      {!loading && !error && !detail && !gallery.extract && (
        <p className="text-sm text-muted">
          No guidebook entry for this place yet. Reopening it will try again.
        </p>
      )}
    </div>
  );
}

/**
 * What is good and what is not.
 *
 * **Deliberately not called "Reviews", and carrying no rating.** The reference prints these under
 * "4.6 · 5k reviews" aggregated from real visitors; there is no free source for that number and
 * `placeFacts.ts` says so outright. These are the model's, at the same authority as the tips and
 * the best-time note above them — useful, and not evidence. Printing a star beside them would be
 * the one thing here that was untrue.
 */
function Verdict({ detail }: { detail: PlaceDetail }) {
  const columns = [
    ["Pros", detail.pros ?? [], "text-accent"],
    ["Cons", detail.cons ?? [], "text-alert"],
  ] as const;

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {columns.map(([label, lines, tone]) =>
        lines.length > 0 ? (
          <div key={label}>
            <FieldLabel>{label}</FieldLabel>
            <ul className="mt-2 space-y-3">
              {lines.map((line, i) => {
                // "Short label: the sentence" — the prompt asks for that shape so the label can
                // carry the weight. A line that arrives without a colon is printed whole rather
                // than split on a guess.
                const split = line.indexOf(":");
                const label = split > 0 ? line.slice(0, split) : null;
                const rest = split > 0 ? line.slice(split + 1).trim() : line;
                return (
                  <li key={i} className="leading-relaxed text-foreground/90">
                    {label && <span className={`font-semibold ${tone}`}>{label}. </span>}
                    {rest}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null
      )}
    </div>
  );
}

/** Address, hours, contact — every one of them from OpenStreetMap or Wikidata, and every one of
 *  them independently absent. The tab does not render at all unless one of them landed, so there
 *  is no empty-state copy here on purpose. */
function Practical({ gallery, stop }: { gallery: PlaceGallery; stop: Stop }) {
  const rows: [string, React.ReactNode][] = [];
  if (gallery.address) rows.push(["Address", gallery.address]);
  if (gallery.openingHours)
    // Raw OSM grammar, printed as written. `closedDaysFromOpeningHours` deliberately bails on any
    // `PH`/`off`/quoted syntax, so this cannot be turned into "Open now" without being wrong on the
    // cases that carry an exception — and a wrong "Open" sends somebody across a city.
    rows.push(["Hours", <span key="hours" className="tabular-nums">{gallery.openingHours}</span>]);
  if (gallery.phone)
    rows.push([
      "Phone",
      <a key="phone" className="text-accent hover:underline" href={`tel:${gallery.phone.replace(/\s/g, "")}`}>
        {gallery.phone}
      </a>,
    ]);
  if (gallery.website)
    rows.push([
      "Website",
      <a
        key="website"
        className="break-all text-accent hover:underline"
        href={gallery.website}
        target="_blank"
        rel="noopener noreferrer"
      >
        {gallery.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
      </a>,
    ]);
  if (gallery.wheelchair)
    rows.push([
      "Step-free access",
      gallery.wheelchair === "yes" ? "Yes" : gallery.wheelchair === "limited" ? "Limited" : "No",
    ]);

  return (
    <div className="space-y-4">
      <dl className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[7.5rem_1fr] gap-3">
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</dt>
            <dd className="text-foreground/90">{value}</dd>
          </div>
        ))}
      </dl>
      <a
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-card-border bg-white/10 px-4 text-sm font-medium text-foreground transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        href={`https://www.openstreetmap.org/directions?to=${stop.lat}%2C${stop.lng}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Get directions
      </a>
      {/* Named because these are volunteer records, not a business listing: an address can be a
          decade old and a phone number can belong to whoever had the unit before. The website in
          particular usually arrives from Wikidata rather than OSM, so the line says both. */}
      <p className="text-xs text-muted/70">
        From OpenStreetMap and Wikidata, only as current as their last edit.
      </p>
    </div>
  );
}

/**
 * The stop as a piece of *this* trip, which is the one thing about it no travel guide knows.
 *
 * This slot was going to be the reference's "Guides" tab — collections other travellers had
 * written. TripMate has no accounts and no user content of any kind, so that tab could only ever
 * have been empty. What went here instead is what the app does hold and had been scattering: the
 * time, the planner's reason, the money, and where you go next.
 */
function InYourPlan({
  stop,
  actualCost,
  onActualCostChange,
  actualCostNote,
  onRetryActualCost,
  numberFieldClass,
  upcomingStops,
  onSelectUpcoming,
}: {
  stop: Stop;
  actualCost?: number;
  onActualCostChange?: (value: number | undefined) => void;
  actualCostNote: string;
  onRetryActualCost?: () => void;
  numberFieldClass: string;
  upcomingStops?: Stop[];
  onSelectUpcoming?: (stop: Stop) => void;
}) {
  return (
    <div className="space-y-5">
      {stop.why && (
        <div>
          <FieldLabel>Why it&rsquo;s here</FieldLabel>
          <p className="mt-1 leading-relaxed text-foreground/90">{stop.why}</p>
        </div>
      )}

      {/* One child of the stack with its note, so the empty note adds no gap. */}
      <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium tabular-nums text-foreground">
          Estimated {formatMoney(stop.cost)}
        </span>
        {onActualCostChange && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Actual
            <span className="relative flex items-center">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 text-base text-muted"
              >
                $
              </span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                // Same reasoning as the lodging field in `ItineraryCard`: the wrapping label's
                // "Actual" is a name, not a useful one, and the `$` beside it is aria-hidden.
                aria-label={`Actual cost in dollars for ${stop.name}`}
                aria-describedby="place-cost-note"
                title="What you actually paid. Replaces the estimate in this trip's budget total."
                defaultValue={actualCost}
                onBlur={(e) =>
                  onActualCostChange(e.target.value === "" ? undefined : Number(e.target.value))
                }
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={numberFieldClass}
              />
            </span>
          </label>
        )}
      </div>
      {/* Copy row T-05, under the amount. Mounted empty so it is announced. */}
      {onActualCostChange && (
        <InlineNote size="field" tone="error" id="place-cost-note" action={onRetryActualCost && { label: "Try again", onClick: onRetryActualCost }}>
          {actualCostNote}
        </InlineNote>
      )}
      </div>

      {onSelectUpcoming && upcomingStops && upcomingStops.length > 0 && (
        <div className="border-t border-card-border pt-4">
          <FieldLabel>Next up</FieldLabel>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
            {upcomingStops.map((next, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectUpcoming(next)}
                className="min-h-11 shrink-0 rounded-xl border border-card-border bg-white/10 px-3 py-2 text-left transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <div className="text-sm font-medium text-foreground">{next.name}</div>
                {(next.time || next.durationLabel) && (
                  <div className="text-xs text-muted">
                    {[next.time, next.durationLabel].filter(Boolean).join(" · ")}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
