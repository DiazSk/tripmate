"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import BackButton from "@/components/BackButton";
import SiteFooter from "@/components/SiteFooter";
import SectionOpener from "@/components/blue-hour/SectionOpener";
import ChoicePicker, { CROWD_PREFERENCES, ENERGY_LEVELS } from "@/components/ChoicePicker";
import ExplorerStylePicker from "@/components/ExplorerStylePicker";
import GroupTypePicker from "@/components/GroupTypePicker";
import InterestPicker from "@/components/InterestPicker";
import DietaryPicker from "@/components/DietaryPicker";
import ErrorNote from "@/components/ErrorNote";
import { formatDateRange, formatMoney } from "@/lib/format";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import type { TravelerProfile } from "@/lib/travelerProfile";
import type {
  CrowdPreference,
  EnergyLevel,
  ExplorerStyle,
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
 * app's existing answer to a beat with no photograph to collage (`HeroPoster`, `/trips`' own empty
 * state) — rather than an empty grey box pretending a picture failed to load.
 */
function Memories({ trips }: { trips: TripSummary[] }) {
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
        See all in My memories
        <ArrowRight
          className="h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5"
          strokeWidth={2}
        />
      </Link>
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
}: {
  initialProfile: TravelerProfile | null;
  /** Up to three most-recent saved trips, newest first, for the memories column. Empty is a real
   *  state (nothing saved yet), not a loading one — the server read is synchronous. */
  recentTrips: TripSummary[];
}) {
  const router = useRouter();
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
        {/* `/profile` is reachable from both the home page and a trip detail, so a fixed
            destination would be wrong from one of them — this pops history instead. The
            fallback covers a direct link or a refresh, where there is no entry to pop and
            `back()` would silently do nothing. */}
        <BackButton
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="mb-6"
        >
          Back
        </BackButton>

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
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-0 lg:border-y lg:border-white/10">
          <div className="lg:pr-10 lg:pt-16 lg:pb-16">
            <div className="lg:sticky lg:top-[calc(var(--nav-h)+2rem)]">
              <Memories trips={recentTrips} />
            </div>
          </div>

          <div className="min-w-0 divide-y divide-card-border lg:border-l lg:border-white/10 lg:pt-16 lg:pb-16 lg:pl-10">
            {/* `SectionOpener` rather than a hand-rolled label: the label sits *beside* the
                heading in its own column, which is the one exception DESIGN.md's No-Kicker Rule was
                amended to allow. An eyebrow stacked *above* the heading — which is literally what
                the reference's contact page does here — is still banned, and this is the
                established way the rest of the app takes the same move. Kept beside rather than
                stacked even inside this narrower cell: 11rem of label leaves the heading ~583px at
                1440, which the `clamp(2rem,5vw,3.75rem)` step fits.
                `rule={false}` because the grid above owns the top hairline now — see there. */}
            {/* `pb-10`, and the number is the one asymmetry on this column that is deliberate.
                Every `Section` is `py-5`, so each hairline sits in a symmetric 20px well; this
                block had **no bottom padding at all**, which left the subline 1px off the rule
                below it against 20px everywhere else — the paragraph read as if it had fallen
                through the divider. It gets 40px rather than a matching 20 because it is the page's
                header, not a peer field row: the boundary under it separates *groups*, and giving
                it the same well as the gap between "Crowds" and "Budget" would flatten the header
                into the eighth row of a list. 40px is `gap-10`, the step this grid already uses
                between its columns, not a new number.
                On the wrapper rather than inside `SectionOpener`, which the landing also renders —
                the spacing belongs to this arrangement, not to the component. */}
            <div className="pb-10">
            <SectionOpener label="Profile" rule={false}>
            {/* `.font-display-xl` — the display serif at a size this page picks. **Not**
                `.font-scene-display`: the scene classes carry the landing's own fluid clamp and are
                scoped to the Persuade surface, and this is an Operate one. **Not** `.font-display`
                either, which since the Melodrama split is the *sans* heading step for panels and
                cards, two registers below a page masthead. `/trips` sets its masthead the same way,
                and these two account pages sitting in different faces was the tell.

                Same reason the subline below does not take `.scene-prose`: that class reserves its
                open leading for the landing and costs a screenful of scanning on a dense panel.

                Three classes with overlapping names is a real trap, so: if you change this line,
                change this note. The last two people who touched it did not, and both times the
                comment above ended up describing something the code was not doing. */}
            <h1 className="font-display-xl text-[clamp(2rem,4vw,3rem)] text-foreground">
              Your travel profile
            </h1>
            <p className="max-w-md pt-4 text-sm leading-relaxed text-muted">
              The things that stay true between trips. We apply these to every plan so the wizard
              only has to ask what actually changes.
            </p>
            </SectionOpener>
            </div>

            <Section
              title="Who you usually travel with"
              hint="A default only — the planner still asks who's coming on each trip, since that changes."
            >
              <GroupTypePicker selected={profile.group} onSelect={(v: GroupType) => set("group", v)} />
            </Section>

            <Section title="Explorer style">
              <ExplorerStylePicker
                selected={profile.explorerStyle}
                onSelect={(v: ExplorerStyle) => set("explorerStyle", v)}
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
            column the form occupies. */}
        <div className="-mx-5 -mb-16 sm:-mx-6 sm:-mb-24">
          <SiteFooter />
        </div>
      </div>
    </main>
  );
}
