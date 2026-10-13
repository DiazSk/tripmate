"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Avatar from "@/components/Avatar";
import SiteFooter from "@/components/SiteFooter";
import ChoicePicker, { CROWD_PREFERENCES, ENERGY_LEVELS } from "@/components/ChoicePicker";
import { DiscoveryPicker, PacePicker } from "@/components/ExplorerStylePicker";
import { legacyExplorerStyle, travelStyleOf } from "@/lib/userAnswers";
import GroupTypePicker from "@/components/GroupTypePicker";
import InterestPicker from "@/components/InterestPicker";
import DietaryPicker from "@/components/DietaryPicker";
import HomeCitySearch from "@/components/welcome/HomeCitySearch";
import ErrorNote from "@/components/ErrorNote";
import AccountReceipt from "@/components/AccountReceipt";
import { formatDateRange, formatMoney } from "@/lib/format";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { useClerk } from "@clerk/nextjs";
import { NO_ACCESSIBILITY_NEEDS } from "@/lib/travelerProfile";
import type { TravelerProfile } from "@/lib/travelerProfile";
import type { ProfileStats } from "@/lib/profileStats";
import type {
  CrowdPreference,
  EnergyLevel,
  DiscoveryPreference,
  PacePreference,
  GroupType,
  TripSummary,
} from "@/lib/types";

const DEFAULTS: TravelerProfile = {
  group: "solo",
  explorerStyle: "mixed",
  energy: "moderate",
  crowds: "mixed",
  priorities: [],
  topPriorities: [],
  dietary: { tags: [], note: "" },
  accessibility: NO_ACCESSIBILITY_NEEDS,
};

const MAX_STARRED = 3;

/**
 * One labelled field row in the ruled column. `py-5` on both sides, which is what puts every
 * hairline in a symmetric 20px well — the rhythm the whole column reads by.
 *
 * No `first:pt-0` / `last:pb-0`, which is what this used to carry. Neither could ever match: the
 * divide container's first child is the `SectionOpener` and its last is the save row, so no
 * `<section>` is `:first-child` or `:last-child` and both utilities were inert. Deleted rather than
 * made to work, because there is nothing for them to do — the container's own `lg:pt-16`/`lg:pb-16`
 * sets the region's outer offset, and these rows only ever have peers above and below them.
 */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 py-5">
      <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="pt-1">{children}</div>
    </section>
  );
}

/**
 * The lead photograph in the memories column: the most recent saved trip, at the size the
 * reference gives its contact-page image.
 *
 * `usePlacePhoto(destination, "full")` and the `contrast-105 saturate-110` grade are lifted from
 * `ItineraryCard`'s header photo and `/trips`' own tiles rather than re-derived — these are real,
 * uncurated photos of whatever the destination happens to be, and the grade is what returns the
 * separation an ungraded source loses. Per the Optimized-Photo Rule this is `next/image` with a
 * `sizes` that tracks the column's real width (full-bleed on a phone, roughly a third of the
 * viewport once the two-column split engages at `lg`), never a CSS `background-image`.
 *
 * `bg-tile` underneath is the Constant-Ground Rule: the surface must not change character when a
 * slow Wikipedia lookup lands, so the frame is already the right colour before the photo arrives
 * and the photo fades in over it on `.value-in`.
 */
function LeadMemory({ trip }: { trip: TripSummary }) {
  const photo = usePlacePhoto(trip.destination, "full");
  return (
    <Link href={`/trip/${trip.id}`} className="group block">
      {/* Near-square, measured off the reference's own contact-page image (~1.07:1) rather than
          borrowed from `/trips`' 16:10 cards. At this column's real width a 4:5 portrait ran to
          705px tall and dominated a page whose subject is the form beside it. */}
      <div className="relative aspect-square overflow-hidden bg-tile">
        {photo && (
          <Image
            key={photo}
            src={photo}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 33vw"
            className="value-in object-cover contrast-105 saturate-110"
          />
        )}
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-white/10 pt-2.5">
        <h2 className="font-display text-base font-semibold text-foreground">
          {trip.destination}
        </h2>
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {formatDateRange(trip.startDate, trip.endDate)}
        </span>
      </div>
      <p className="pt-1 text-xs tabular-nums text-muted">
        {formatMoney(trip.budget)} budget
      </p>
    </Link>
  );
}

/**
 * One of the two smaller trips under the lead photo. Same hook and same grade as `LeadMemory`,
 * at a squarer ratio because two of these share the lead's width.
 *
 * A local component rather than a shared one, and called once per trip rather than looped over
 * inside a parent: `usePlacePhoto` is a hook, so each trip needs its own component instance to
 * own its own call. `/trips` reaches for exactly this shape with its own local `MemoryCard`.
 */
function MemoryThumb({ trip }: { trip: TripSummary }) {
  const photo = usePlacePhoto(trip.destination, "full");
  return (
    <Link href={`/trip/${trip.id}`} className="group block min-w-0">
      <div className="relative aspect-[4/3] overflow-hidden bg-tile">
        {photo && (
          <Image
            key={photo}
            src={photo}
            alt=""
            fill
            sizes="(max-width: 1024px) 50vw, 17vw"
            className="value-in object-cover contrast-105 saturate-110"
          />
        )}
      </div>
      <p className="truncate border-t border-white/10 pt-2 text-xs font-medium text-foreground">
        {trip.destination}
      </p>
      <p className="truncate text-xs tabular-nums text-muted">
        {formatDateRange(trip.startDate, trip.endDate)}
      </p>
    </Link>
  );
}

/**
 * The memories column: a lead photograph, up to two thumbnails, and a link out to the full
 * gallery.
 *
 * This is the *preview*, deliberately — not `/trips` relocated. `/trips` is a photo-forward
 * gallery whose imagery leads; this page is a settings form built for scanning. Stacking the whole
 * gallery here would bury one under the other, so the connective tissue is three real trips and a
 * way through to the rest. `My memories` stays a top-level route and a top-level nav link.
 *
 * With nothing saved there is no photography to show, so the frame takes `.scene-void` — the
 * app's existing answer to a beat with no photograph to collage (`/trips`' own empty state) —
 * rather than an empty grey box pretending a picture failed to load.
 */
function Memories({
  trips,
  tripCount,
  savedPlaces,
  savedPlaceCount,
}: {
  trips: TripSummary[];
  tripCount: number;
  savedPlaces: { id: string; name: string; city: string | null }[];
  savedPlaceCount: number;
}) {
  const [lead, ...rest] = trips;

  if (!lead) {
    return (
      <div className="scene-void flex min-h-[22rem] flex-col justify-end p-6">
        <h2 className="font-display text-base font-semibold text-foreground">
          No memories yet
        </h2>
        <p className="pt-1 text-sm text-muted">
          Plan and save a trip and it will show up here, with the places you chose.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <LeadMemory trip={lead} />

      {/* Only when a second trip exists. `grid-cols-2` with one child would leave a half-width
          photo beside a hole, so the row is absent rather than half-populated. */}
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {rest.map((trip) => (
            <MemoryThumb key={trip.id} trip={trip} />
          ))}
        </div>
      )}

      <Link
        href="/trips"
        // `min-h-11` for the 44px target rule. Reached with height rather than by growing the
        // type, per DESIGN.md — the link was 20px tall, the shortest control on the page. The
        // three shared pickers below are 32px and also short of 44, but they are `HomeView`'s
        // controls too and resizing them would redesign the trip wizard's density; that shortfall
        // is recorded in docs/frontend.md rather than fixed from here.
        className="group inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        {tripCount > trips.length ? `See all ${tripCount} in My memories` : "See all in My memories"}
        <ArrowRight
          className="h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5"
          strokeWidth={2}
        />
      </Link>

      <SavedPlaces places={savedPlaces} total={savedPlaceCount} />
    </div>
  );
}

/**
 * The places shared in before there was a trip for them.
 *
 * On this page rather than only in the wizard, because they are the other thing an account
 * accumulates and the profile is where a traveller comes to find what is theirs. Absent entirely
 * when there are none: an empty list here would be a header explaining a feature rather than a
 * record of anything, and `Invitation`'s own rule is that a genuine empty state is an invitation,
 * not an apology — the invitation for these belongs in the wizard that collects them.
 */
function SavedPlaces({
  places,
  total,
}: {
  places: { id: string; name: string; city: string | null }[];
  total: number;
}) {
  if (places.length === 0) return null;
  return (
    <div className="border-t border-card-border pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-foreground">Saved places</h2>
        <span className="shrink-0 text-xs tabular-nums text-muted">{total}</span>
      </div>
      <ul className="pt-2">
        {places.map((place) => (
          <li
            key={place.id}
            className="flex items-baseline justify-between gap-3 border-b border-card-border py-2 text-sm last:border-b-0"
          >
            <span className="min-w-0 truncate text-foreground">{place.name}</span>
            {place.city && <span className="shrink-0 text-xs text-muted">{place.city}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The page's masthead: who this profile belongs to, and what it adds up to.
 *
 * **Full width, above the grid, rather than a row inside the form column — and the placement is
 * the whole of it.** This page's subject is identity, and it opened with a settings form: the name
 * was set into the form column's header well, at roughly half the page's width, on the line above
 * "Who you usually travel with". A masthead sharing a column with a field label is not a masthead,
 * and the page went on reading as the settings form it used to be. So identity spans the page, the
 * figures rule a band under it, and the form begins below both.
 *
 * **The avatar is the most recent trip's photograph.** The mobile app's equivalent carries a
 * placeholder glyph and a comment explaining why — "this product has no accounts and no image
 * storage, and a control that opens a picker whose result cannot be saved is worse than a
 * placeholder that admits what it is". Accounts exist now, and the second half never needed
 * solving: a traveller who has kept a trip has already supplied a picture. Signed out, or with
 * nothing kept, the circle stays the empty tile rather than inventing a face.
 *
 * **Sign out lives here, which retires `AccountRow` entirely.** That block sat beneath the Save
 * button — the last thing on the page — and once a masthead states the account by name and offers
 * the way out, everything left in it was said twice. Its signed-out branch comes along: this is
 * still the one place in the app that asks for an account, and it still asks by naming what an
 * account is for rather than by gating anything.
 */
function Masthead({
  id,
  name,
  email,
  image,
  lead,
  stats,
}: {
  id: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
  lead: TripSummary | undefined;
  stats: ProfileStats;
}) {
  const photo = usePlacePhoto(lead?.destination ?? "", "thumb");
  const router = useRouter();

  return (
    <header>
      <div className="flex min-w-0 items-center gap-5 sm:gap-7">
        {id ? (
          // Signed in: the traveller's own face, editable. `router.refresh()` re-reads the session so
          // the server-rendered page carries the new `user.image` too.
          <Avatar userId={id} name={name} image={image} size={112} editable onChange={() => router.refresh()} />
        ) : (
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-card-border bg-tile sm:h-28 sm:w-28">
            {photo && <Image key={photo} src={photo} alt="" fill sizes="112px" className="value-in object-cover" />}
          </div>
        )}
        <div className="min-w-0">
          {/* `.font-display-xl` — the display serif at a size this page picks. **Not**
              `.font-scene-display`: the scene classes carry the landing's own fluid clamp and are
              scoped to the Persuade surface, and this is an Operate one. **Not** `.font-display`
              either, which since the Melodrama split is the *sans* heading step for panels and
              cards, two registers below a page masthead. `/trips` sets its masthead the same way.

              The clamp's ceiling rose from 2.75rem to 4rem when this left the form column: the old
              one was sized to survive a half-width cell, and a name is the largest thing on this
              page now rather than the widest thing in a sidebar.

              Three classes with overlapping names is a real trap, so: if you change this line,
              change this note. The last two people who touched it did not, and both times the
              comment above ended up describing something the code was not doing. */}
          <h1 className="font-display-xl truncate text-[clamp(2.25rem,5.4vw,4rem)] text-foreground">
            {name ?? "Your travel profile"}
          </h1>
          <p className="max-w-lg truncate pt-2.5 text-sm text-muted">
            {email ?? "Not signed in. Sign in to add a photo and keep this profile on every device."}
          </p>
        </div>
      </div>

      {/* The figures and the account action share the masthead's closing line, above the rule the
          grid below draws.

          The action used to sit opposite the name, which at 1440 left one small pill alone across
          700px of nothing — a heading with a stray control beside it rather than a header. Here it
          ends the line it belongs to, and the masthead reads as two rows instead of one wide one.

          Tabular on the figures, because these three are read against their own past values every
          visit and are set as aligned figures rather than prose. Gold on spend and nowhere else: a
          figure is information, not an invitation.

          **Content-sized and left-aligned, not a three-cell grid — and that is the whole of this
          block.** It was `grid-cols-3` with a hairline between each cell and a rule above and
          below, which at 1440 gave each figure a 460px cell to hold about 60px of content, and put
          two vertical hairlines at the thirds while the grid below splits at 1fr/1.35fr. Rules that
          align with nothing are worse than no rules — the system draws a *grid*, and two grids at
          different divisions read as neither. So the cells went, the dividers went, and the figures
          sit on the page's own left edge, which the memories column below shares.

          The band's own rules went with them. The grid below carries `lg:border-y`, so its top rule
          closes the masthead; a second hairline 40px above it was the same boundary drawn twice,
          and it left that grid's column rule descending from a corner that was not there. */}
      <div className="mt-10 flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
        <dl className="flex flex-wrap gap-x-12 gap-y-7 sm:gap-x-16">
          <Figure k="Trips kept" v={String(stats.trips)} />
          <Figure k="Places seen" v={String(stats.places)} />
          <Figure k="Spent" v={formatMoney(stats.spend)} money />
        </dl>

        {email ? (
          <SignOutButton />
        ) : (
          <Link
            href="/signin?next=/profile"
            className="flex min-h-11 shrink-0 items-center rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

/**
 * Its own component so `useClerk()` only runs where an account exists: the hook throws without a
 * `ClerkProvider`, and the layout mounts one only when Clerk is configured. A signed-in traveller
 * implies it is; the signed-out branch never renders this.
 */
function SignOutButton() {
  const { signOut } = useClerk();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await signOut();
        // `refresh()` rather than a reload: every owner-scoped server component on this route
        // and the next one has to re-read, and leaving the router cache holding the signed-in
        // render would show this traveller their trips after they asked to be signed out.
        router.refresh();
        router.push("/");
      }}
      className="min-h-11 shrink-0 rounded-full bg-[rgb(247_245_242/0.07)] px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-[rgb(247_245_242/0.12)] disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

function Figure({ k, v, money = false }: { k: string; v: string; money?: boolean }) {
  return (
    <div>
      <dd
        className={`font-mono text-[clamp(1.75rem,4vw,2.75rem)] leading-none tabular-nums ${money ? "text-money" : "text-foreground"}`}
      >
        {v}
      </dd>
      <dt className="pt-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-muted">
        {k}
      </dt>
    </div>
  );
}

/**
 * Where the durable traveler traits are actually owned. The plan wizard asks only what
 * changes per trip, so without this page explorer style, energy, crowds, priorities
 * and dietary needs would be set once and never changeable.
 */
export default function ProfileForm({
  initialProfile,
  recentTrips,
  tripCount,
  stats,
  savedPlaces,
  savedPlaceCount,
  accountEmail,
  accountName,
  accountId,
  accountImage,
}: {
  initialProfile: TravelerProfile | null;
  /** The signed-in account's email, or `null` when this is an anonymous browser. Resolved on the
   *  server so the account block paints correct on the first frame, like the rest of this page. */
  accountEmail: string | null;
  /** The account's display name. Never empty for a real account — both clients fall back to the
   *  email's local part at sign-up — so the masthead does not need an empty case, only a
   *  signed-out one. */
  accountName: string | null;
  accountId: string | null;
  accountImage: string | null;
  /** Most-recent saved trips, newest first, for the memories column. Empty is a real state
   *  (nothing saved yet), not a loading one — the server read is synchronous. */
  recentTrips: TripSummary[];
  /** Every kept trip, not just the ones shown, so "All n" tells the truth. */
  tripCount: number;
  stats: ProfileStats;
  savedPlaces: { id: string; name: string; city: string | null }[];
  savedPlaceCount: number;
}) {
  // Seeded from the server read rather than fetched on mount. There is no loading state left to
  // model: the page component reads SQLite synchronously, so by the time this renders the profile
  // is either here or genuinely absent (nothing saved yet), and `DEFAULTS` is the right answer for
  // absent. The old mount-fetch spent a round trip to learn the same thing.
  const [profile, setProfile] = useState<TravelerProfile>(initialProfile ?? DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof TravelerProfile>(key: K, value: TravelerProfile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setSaved(false);
  };

  /**
   * One half of the travel style, plus the legacy field both halves derive to.
   *
   * Written together rather than left to drift: `explorerStyle` is still what a stored row and
   * the frozen Swift app read, so a profile that changed its pace without updating it would
   * answer two different things to two readers.
   */
  const setStyle = (change: { pace?: PacePreference; discovery?: DiscoveryPreference }) => {
    setProfile((p) => {
      const next = { ...travelStyleOf(p), ...change };
      return { ...p, ...change, explorerStyle: legacyExplorerStyle(next) };
    });
    setSaved(false);
  };

  function toggleInterest(tag: string) {
    const selected = profile.priorities.includes(tag)
      ? profile.priorities.filter((t) => t !== tag)
      : [...profile.priorities, tag];
    // Unstarring follows deselection — a starred tag that is no longer selected would
    // otherwise keep driving the plan while showing as unselected.
    const starred = profile.topPriorities.filter((t) => selected.includes(t));
    setProfile((p) => ({ ...p, priorities: selected, topPriorities: starred }));
    setSaved(false);
  }

  function toggleStar(tag: string) {
    const starred = profile.topPriorities.includes(tag)
      ? profile.topPriorities.filter((t) => t !== tag)
      : profile.topPriorities.length < MAX_STARRED
        ? [...profile.topPriorities, tag]
        : profile.topPriorities;
    setProfile((p) => ({ ...p, topPriorities: starred }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save your profile.");
      setSaved(true);
    } catch (e) {
      // Unlike the onboarding card's opportunistic save, this form's whole purpose is
      // saving — staying silent about a failure here would be a lie.
      setError(e instanceof Error ? e.message : "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  }

  // `map-chrome-hidden` drops the globe's zoom/2D-3D/tilt/compass stack: this is a settings
  // form, not a map being read, and there's no route or stop drawn here for those controls
  // to act on — same reasoning trips/page.tsx already applies to its own dead-end globe view.
  //
  // No panel. This page carried `.profile-glass` — a tinted, frosted card — for one reason: to
  // separate a settings form from the live globe behind it. The Mounted-Surface Gate took the
  // globe off this route, so the card had been an opaque slate rectangle floating on a flat
  // `--canvas` for no remaining reason, and a 56px blur of a flat colour is a blur of nothing.
  // The content sits directly on the canvas now, separated by hairlines and space, the way
  // `FeaturedPlans` and `DestinationMap` already treat their own globe-less sections.
  return (
    <main className="map-chrome-hidden min-h-full px-5 pt-[calc(var(--nav-h)+1.25rem)] pb-16 sm:px-6 sm:pt-[calc(var(--nav-h)+1.5rem)] sm:pb-24">
      {/* `pointer-events-auto`: this page's content sits inside AppShell's own
          `pointer-events-none` scroll container (what keeps the Cesium globe underneath
          draggable) — without opting back in here, every click passes through to the
          globe canvas instead of reaching any picker or the Save button. Same pattern
          trips/page.tsx and TripView.tsx already use on their own outermost box. */}
      <div className="pointer-events-auto">
        {/* The reference's contact-page split: photography one side, the form the other. Single
            column until `lg` — two columns on a phone would give the photo a strip too narrow to
            be a photograph and the pickers too little room to stay tappable.

            The reference does not float two columns in whitespace; it draws a grid. So the split is
            a shared hairline rather than a gap: `lg:gap-0` with symmetric `pr-10`/`pl-10` puts the
            rule dead centre in an 80px gutter, and `border-y` brackets the region top and bottom
            the way the reference's own rules bracket its content section. The top rule lives here
            rather than on the header because the header now sits *inside* the right cell — the
            reference's arrangement, and what makes the vertical rule run the region's whole height
            instead of starting below a full-width heading. `SectionOpener` takes `rule={false}` so
            it does not draw a second, half-width one.

            The bottom padding sits on the two cells, not on the grid. On the container it is
            outside the row, so the vertical rule stopped at the row's end and the closing rule sat
            64px below it — two hairlines not quite meeting, which is exactly the tell that
            separates a drawn grid from two bordered boxes. On the cells it is inside the row, so
            the rules meet at the corner.

            The columns must therefore *stretch* — a border only spans as far as its own box, and an
            `items-start` column stops at its content, which left the rule ending halfway down the
            page. Stretching is also the better home for the sticky: the grid item becomes as tall
            as the form, and the `sticky` div inside it has that whole height to travel within.
            This page is far longer than the reference's short contact form, so without sticky the
            photography would scroll away in the first screenful. */}
        {/* Above the identity it explains, and only ever on the one render after sign-up. */}
        <div className="pb-6 empty:hidden">
          <AccountReceipt />
        </div>

        <Masthead id={accountId} name={accountName} email={accountEmail} image={accountImage} lead={recentTrips[0]} stats={stats} />

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-0 lg:border-y lg:border-white/10">
          <div className="lg:pr-10 lg:pt-16 lg:pb-16">
            <div className="lg:sticky lg:top-[calc(var(--nav-h)+2rem)]">
              <Memories
                trips={recentTrips}
                tripCount={tripCount}
                savedPlaces={savedPlaces}
                savedPlaceCount={savedPlaceCount}
              />
            </div>
          </div>

          <div className="min-w-0 divide-y divide-card-border lg:border-l lg:border-white/10 lg:pt-16 lg:pb-16 lg:pl-10">
            {/* What this column is, now that the page's masthead is above the grid rather than
                inside this cell. `SectionOpener` went with the page title it used to open: its
                label sat beside a heading naming the *page*, and the page names itself at the top
                now. What is left is a standfirst for the form — one paragraph, no heading, because
                a second `<h1>`-scale line 40px under the real one is the kicker the No-Kicker Rule
                bans, in the one arrangement it has no exception for.

                `pb-10` rather than the `py-5` every `Section` below carries, and the asymmetry is
                deliberate: this is the column's header, not its first field row, and the hairline
                under it separates *groups*. Giving it the same 20px well as the gap between
                "Crowds" and "Budget" flattens it into the eighth row of a list. 40px is `gap-10`,
                the step this grid already uses between its columns, not a new number. */}
            <div className="pb-10">
              <p className="max-w-md text-sm leading-relaxed text-muted">
                The things that stay true between trips. We apply these to every plan so the wizard
                only has to ask what actually changes.
              </p>
            </div>

            <Section
              title="Who you usually travel with"
              hint="A default only — the planner still asks who's coming on each trip, since that changes."
            >
              <GroupTypePicker selected={profile.group} onSelect={(v: GroupType) => set("group", v)} />
            </Section>

            {/* Two sections, because "Explorer style" was two questions. A stored profile has
                neither field, so `travelStyleOf` reads the legacy one; each picker writes its
                own half and the legacy field both halves derive to, so a profile saved here
                stays readable by anything that only knows `explorerStyle`. */}
            <Section title="How full a day">
              <PacePicker
                selected={travelStyleOf(profile).pace}
                onSelect={(v: PacePreference) => setStyle({ pace: v })}
              />
            </Section>

            <Section title="What to see">
              <DiscoveryPicker
                selected={travelStyleOf(profile).discovery}
                onSelect={(v: DiscoveryPreference) => setStyle({ discovery: v })}
              />
            </Section>

            <Section title="How much walking suits you">
              <ChoicePicker
                name="energy"
                options={[...ENERGY_LEVELS]}
                selected={profile.energy}
                onSelect={(v: EnergyLevel) => set("energy", v)}
              />
            </Section>

            <Section title="Crowds">
              <ChoicePicker
                name="crowds"
                options={[...CROWD_PREFERENCES]}
                selected={profile.crowds}
                onSelect={(v: CrowdPreference) => set("crowds", v)}
              />
            </Section>

            <Section title="What matters most" hint="Star up to three — the starred ones drive the plan.">
              <InterestPicker
                selected={profile.priorities}
                starred={profile.topPriorities}
                onToggle={toggleInterest}
                onToggleStar={toggleStar}
              />
            </Section>

            <Section
              title="Dietary needs"
              hint="Applied to every food stop on every trip. Leave empty if nothing applies."
            >
              <DietaryPicker value={profile.dietary} onChange={(v) => set("dietary", v)} />
            </Section>

            <Section
              title="Home city"
              hint="Where you usually set off from. It helps with travel times and the best months to go."
            >
              {/* A null is the search reporting that the text moved off the picked city. It must not
                  clear the saved one: only a real pick changes it. */}
              <HomeCitySearch value={profile.homeCity ?? null} onPick={(home) => { if (home) set("homeCity", home); }} />
            </Section>

            <div className="space-y-3 pt-5">
              {error && <ErrorNote>{error}</ErrorNote>}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save profile"}
                </button>
                {saved && <span className="text-sm text-muted">Saved.</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Cancels this `<main>`'s horizontal and bottom padding, the same technique ScrollStory
            and `/trips`' hero already use: the footer is a full-bleed band with its own gutters
            and its own `pb-8`, so it has to reach all three edges rather than sit inside the
            column the form occupies.

            `mt-14 sm:mt-16` matches `/trips` and is measured off the landing — see the longer note
            at that call site. The short version: `SiteFooter`'s hairline needs the closing interval
            a `.scene-band` would have given it, and the form grid above has no bottom padding of
            its own, so the rule was landing flush on the last field. */}
        <div className="mt-14 -mx-5 -mb-16 sm:mt-16 sm:-mx-6 sm:-mb-24">
          <SiteFooter />
        </div>
      </div>
    </main>
  );
}
