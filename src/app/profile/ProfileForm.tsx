"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { CROWD_PREFERENCES, ENERGY_LEVELS } from "@/components/ChoicePicker";
import { DISCOVERIES, PACES } from "@/components/ExplorerStylePicker";
import { GROUP_TYPES } from "@/components/GroupTypePicker";
import { INTEREST_TAGS } from "@/components/InterestPicker";
import { DIETARY_TAGS } from "@/components/DietaryPicker";
import HomeCitySearch from "@/components/welcome/HomeCitySearch";
import AccountReceipt from "@/components/AccountReceipt";
import { legacyExplorerStyle, MAX_STARRED_PRIORITIES as MAX_STARRED, priorityHint, starLabel, travelStyleOf } from "@/lib/userAnswers";
import { formatDateRange, formatMoney } from "@/lib/format";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { monumentEms } from "@/lib/monumentFit";
import { city } from "@/lib/memories";
import { profileSentence } from "@/lib/profileSentence";
import { useSignOut } from "@/lib/useSignOut";
import InlineNote from "@/components/InlineNote";
import { failureFromResponse, failureFromThrown, type Failure } from "@/lib/failure";
import { NO_ACCESSIBILITY_NEEDS } from "@/lib/travelerProfile";
import type { TravelerProfile } from "@/lib/travelerProfile";
import type { ProfileStats } from "@/lib/profileStats";
import type { DiscoveryPreference, PacePreference, TripSummary } from "@/lib/types";
import { useScrollContainer } from "@/lib/scrollContainer";
import { buildHeroOnly, useSmoothScroll } from "@/components/polar/motion";

import "@/components/polar/PolarLanding.css";
import "@/components/polar/FieldNotes.css";

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

/** The masthead's ground when there is no kept trip to photograph. */
const FALLBACK_PHOTO = "/scenes/graubunden-autumn-valley.webp";

type SectionKey = "group" | "pace" | "discovery" | "energy" | "crowds" | "interests" | "dietary" | "home";
const SECTIONS: { key: SectionKey; title: string; hint?: string }[] = [
  { key: "group", title: "Who you usually travel with", hint: "A default only. The planner still asks who's coming on each trip, since that changes." },
  { key: "pace", title: "How full a day" },
  { key: "discovery", title: "What to see" },
  { key: "energy", title: "How much walking suits you" },
  { key: "crowds", title: "Crowds" },
  { key: "interests", title: "What matters most", hint: "Star up to three. The starred ones drive the plan." },
  { key: "dietary", title: "Dietary needs", hint: "Applied to every food stop on every trip. Leave empty if nothing applies." },
  { key: "home", title: "Home city", hint: "Where you usually set off from. It helps with travel times and the best months to go." },
];

const labelOf = (list: readonly { id: string; label: string }[], id: string) => list.find((o) => o.id === id)?.label ?? "";

/** What each answer says now, for the index beside the fields. */
function answerOf(p: TravelerProfile, key: SectionKey): string {
  const style = travelStyleOf(p);
  switch (key) {
    case "group":
      return labelOf(GROUP_TYPES, p.group);
    case "pace":
      return labelOf(PACES, style.pace);
    case "discovery":
      return labelOf(DISCOVERIES, style.discovery);
    case "energy":
      return labelOf(ENERGY_LEVELS, p.energy);
    case "crowds":
      return labelOf(CROWD_PREFERENCES, p.crowds);
    case "interests":
      return p.topPriorities.length ? `★ ${p.topPriorities.join(", ")}` : p.priorities.join(", ") || "None yet";
    case "dietary":
      return [...p.dietary.tags, p.dietary.note.trim()].filter(Boolean).join(", ") || "Nothing applies";
    case "home":
      return p.homeCity?.name ?? "Not set";
  }
}

/** One answer from a short list, as a radio group: label, and a line under it where there is one. */
function Choices<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: readonly { id: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  const lined = options.some((o) => o.hint);
  return (
    <div className={`pf-choices${lined ? " is-lined" : ""}`} role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className="pf-choice" onClick={() => onChange(o.id)}>
          <span className="pf-choice-label">{o.label}</span>
          {o.hint && <span className="pf-choice-line">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The page's masthead: the latest kept trip's photograph, the traveller's first name as the
 * monument, and the three figures. Sign out lives here, beside the account it names; signed out,
 * the same place asks for an account by naming what one is for.
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
  const router = useRouter();
  const found = usePlacePhoto(lead?.destination ?? "", "full");
  // Undefined while the lookup runs, so the night ground holds rather than flashing the fallback.
  const photo = !lead || found === null ? FALLBACK_PHOTO : found;
  const first = name?.trim().split(/\s+/)[0] || "Traveller";
  return (
    <section className="pb-mast" aria-labelledby="pb-name" data-hero>
      {/* The landing's hero motion (`heroParallax`): the media holds still as the form rises over it. */}
      <div className="tm-hero-media" aria-hidden="true">
        {photo && <Image key={photo} src={photo} alt="" fill priority sizes="100vw" className="pb-mast-img" />}
        <div className="pb-mast-scrim" />
        <div className="tm-hero-veil" />
      </div>
      <div className="pb-mast-foot">
        <div className="pb-who" data-hero-copy>
          {/* Signed in: the traveller's own face, editable. `router.refresh()` re-reads the session
              so the server-rendered page carries the new `user.image` too. */}
          <Avatar userId={id} name={name} image={image} size={88} editable={!!id} onChange={() => router.refresh()} />
          <div className="pb-who-text">
            <p className="tm-eyebrow tm-on-dark">Travel profile</p>
            <h1 id="pb-name" className="pb-fullname">
              {name ?? "Your travel profile"}
            </h1>
            <p className="tm-caption tm-on-dark-2">
              {email ?? "Not signed in. Sign in to add a photo and keep this profile on every device."}
              {email ? (
                <SignOutButton />
              ) : (
                <Link href="/signin?next=/profile" className="pb-out">
                  Sign in
                </Link>
              )}
            </p>
          </div>
          {/* Tabular, because these three are read against their own past values every visit. */}
          <dl className="pb-figures">
            <div>
              <dt>Trips kept</dt>
              <dd>{stats.trips}</dd>
            </div>
            <div>
              <dt>Places seen</dt>
              <dd>{stats.places}</dd>
            </div>
            <div>
              <dt>Spent</dt>
              <dd>{formatMoney(stats.spend)}</dd>
            </div>
          </dl>
        </div>
        {/* Sized in the font-size itself, where an em is still the parent's; the gutter is the
            foot's padding, not this element's, whose own em is the word's size. */}
        <div className="tm-monument-wrap">
          <p
            className="tm-monument tm-on-dark pb-monument"
            style={{ fontSize: `min(calc((100cqw - 2 * var(--wd-pad)) / ${monumentEms(first).toFixed(3)}), 28vh)` }}
            aria-hidden="true"
          >
            {first}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Its own component so `useClerk()` (inside `useSignOut`) only runs where an account exists: the hook
 * throws without a `ClerkProvider`, and the layout mounts one only when Clerk is configured. A
 * signed-in traveller implies it is; the signed-out branch never renders this.
 */
function SignOutButton() {
  const { signOut, busy, note, noteId } = useSignOut();
  return (
    <>
      <button type="button" disabled={busy} className="pb-out" aria-describedby={noteId} onClick={signOut}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {/* Copy rows F-15, F-16. Kept mounted, empty, so the note is read when its words arrive. */}
      <InlineNote id={noteId} size="item" tone="error">
        {note}
      </InlineNote>
    </>
  );
}

function StripTrip({ trip }: { trip: TripSummary }) {
  const photo = usePlacePhoto(trip.destination, "full");
  const word = city(trip);
  return (
    <li>
      <Link href={`/trip/${trip.id}`}>
        <span className="pb-strip-photo">
          <span aria-hidden="true">{word.slice(0, 1)}</span>
          {photo && <Image key={photo} src={photo} alt="" fill sizes="(max-width: 640px) 33vw, 12vw" />}
        </span>
        <b>{word}</b>
        <span>{formatDateRange(trip.startDate, trip.endDate)}</span>
      </Link>
    </li>
  );
}

/** Copy rows F-01 to F-03: why the profile didn't save, and that the answers are still on screen. */
function saveFailureCopy(f: Failure): string {
  if (f.kind === "offline") return "You’re offline, so your profile didn’t save. Your changes are still here; save once you’re back online.";
  if (f.kind === "invalid") return "Your profile didn’t save: one answer didn’t reach TripMate in a form it could read. Reload the page and save again.";
  return "Your profile didn’t save: TripMate’s server had a problem. Your changes are still here. Press Save profile to try again.";
}

/**
 * Where the durable traveller traits are owned. The plan wizard asks only what changes per trip,
 * so without this page pace, energy, crowds, priorities and dietary needs would be set once and
 * never changeable.
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
  /** The signed-in account's email, or `null` when this is an anonymous browser. */
  accountEmail: string | null;
  /** The account's display name. Never empty for a real account, so only signed out needs a case. */
  accountName: string | null;
  accountId: string | null;
  accountImage: string | null;
  /** Most-recent saved trips, newest first. Empty is a real state, not a loading one. */
  recentTrips: TripSummary[];
  /** Every kept trip, not just the ones shown, so "See all n" tells the truth. */
  tripCount: number;
  stats: ProfileStats;
  savedPlaces: { id: string; name: string; city: string | null }[];
  savedPlaceCount: number;
}) {
  // The landing's smooth scroll and hero. Only the hero is scrubbed: the rest is a form somebody is
  // editing, where fields sliding into place would be in the way.
  const rootRef = useRef<HTMLElement>(null);
  useSmoothScroll(rootRef, useScrollContainer(), buildHeroOnly);
  // Seeded from the server read; `DEFAULTS` is the right answer for a profile never saved.
  const [baseline, setBaseline] = useState<TravelerProfile>(initialProfile ?? DEFAULTS);
  const [profile, setProfile] = useState<TravelerProfile>(baseline);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SectionKey>("group");
  const dirty = JSON.stringify(profile) !== JSON.stringify(baseline);

  const edit = (next: (p: TravelerProfile) => TravelerProfile) => {
    setProfile(next);
    setSaved(false);
  };
  const set = <K extends keyof TravelerProfile>(key: K, value: TravelerProfile[K]) => edit((p) => ({ ...p, [key]: value }));

  /**
   * One half of the travel style, plus the legacy field both halves derive to. Written together:
   * `explorerStyle` is still what a stored row and the frozen Swift app read, so a profile that
   * changed its pace without updating it would answer two different things to two readers.
   */
  const setStyle = (change: { pace?: PacePreference; discovery?: DiscoveryPreference }) =>
    edit((p) => {
      const next = { ...travelStyleOf(p), ...change };
      return { ...p, ...change, explorerStyle: legacyExplorerStyle(next) };
    });

  // Unstarring follows deselection: a starred tag no longer selected would keep driving the plan
  // while showing as unselected.
  const toggleInterest = (tag: string) =>
    edit((p) => {
      const on = p.priorities.includes(tag);
      return {
        ...p,
        priorities: on ? p.priorities.filter((t) => t !== tag) : [...p.priorities, tag],
        topPriorities: on ? p.topPriorities.filter((t) => t !== tag) : p.topPriorities,
      };
    });
  // And starring selects, so a star can never sit on a tag the plan ignores.
  const toggleStar = (tag: string) =>
    edit((p) => {
      if (p.topPriorities.includes(tag)) return { ...p, topPriorities: p.topPriorities.filter((t) => t !== tag) };
      if (p.topPriorities.length >= MAX_STARRED) return p;
      return {
        ...p,
        topPriorities: [...p.topPriorities, tag],
        priorities: p.priorities.includes(tag) ? p.priorities : [...p.priorities, tag],
      };
    });
  const toggleDiet = (tag: string) =>
    edit((p) => {
      const tags = p.dietary.tags.includes(tag) ? p.dietary.tags.filter((t) => t !== tag) : [...p.dietary.tags, tag];
      return { ...p, dietary: { ...p.dietary, tags } };
    });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      if (!res.ok) {
        setError(saveFailureCopy(await failureFromResponse(res, "edit")));
        return;
      }
      setBaseline(profile);
      setSaved(true);
    } catch (e) {
      // This form's whole purpose is saving; staying silent about a failure here would be a lie.
      setError(saveFailureCopy(failureFromThrown(e)));
    } finally {
      setSaving(false);
    }
  }

  // Which answer is in view, for the index.
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(`pb-${s.key}`)).filter((el): el is HTMLElement => !!el);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.replace("pb-", "") as SectionKey);
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const style = travelStyleOf(profile);
  const fullStars = profile.topPriorities.length >= MAX_STARRED;

  function field(key: SectionKey) {
    switch (key) {
      case "group":
        return <Choices name="Who you usually travel with" value={profile.group} options={GROUP_TYPES} onChange={(v) => set("group", v)} />;
      case "pace":
        return <Choices name="How full a day" value={style.pace} options={PACES} onChange={(v) => setStyle({ pace: v })} />;
      case "discovery":
        return <Choices name="What to see" value={style.discovery} options={DISCOVERIES} onChange={(v) => setStyle({ discovery: v })} />;
      case "energy":
        return <Choices name="How much walking suits you" value={profile.energy} options={ENERGY_LEVELS} onChange={(v) => set("energy", v)} />;
      case "crowds":
        return <Choices name="Crowds" value={profile.crowds} options={CROWD_PREFERENCES} onChange={(v) => set("crowds", v)} />;
      case "interests":
        return (
          <div className="pf-chips">
            {INTEREST_TAGS.map((tag) => {
              const on = profile.priorities.includes(tag);
              const rank = profile.topPriorities.indexOf(tag) + 1;
              return (
                <span key={tag} className={`pf-chip${on ? " is-on" : ""}${rank ? " is-star" : ""}`}>
                  <button type="button" aria-pressed={on} onClick={() => toggleInterest(tag)} className="pf-chip-main">
                    {tag}
                  </button>
                  <button
                    type="button"
                    aria-pressed={rank > 0}
                    aria-label={starLabel(tag, profile.topPriorities)}
                    aria-disabled={!rank && fullStars}
                    onClick={() => toggleStar(tag)}
                    className="pf-chip-star"
                  >
                    {rank || "☆"}
                  </button>
                </span>
              );
            })}
            <p className="pf-hint pf-stars-left">
              {priorityHint(profile.topPriorities)}
            </p>
          </div>
        );
      case "dietary":
        return (
          <div className="pf-diet">
            <div className="pf-chips">
              {DIETARY_TAGS.map((tag) => {
                const on = profile.dietary.tags.includes(tag);
                return (
                  <button key={tag} type="button" aria-pressed={on} className={`pf-chip pf-chip-plain${on ? " is-on" : ""}`} onClick={() => toggleDiet(tag)}>
                    {tag}
                  </button>
                );
              })}
            </div>
            <label className="pf-note">
              <span>Anything else</span>
              <input
                type="text"
                value={profile.dietary.note}
                placeholder="An allergy, a dislike, a rule you keep"
                onChange={(e) => set("dietary", { ...profile.dietary, note: e.target.value })}
              />
            </label>
          </div>
        );
      case "home":
        return (
          <div className="pf-home">
            {profile.homeCity && (
              <p className="pf-home-now">
                <span className="pf-pin" aria-hidden="true" />
                {profile.homeCity.name}
              </p>
            )}
            {/* A null is the search reporting that the text moved off the picked city. It must not
                clear the saved one: only a real pick changes it. */}
            <HomeCitySearch value={profile.homeCity ?? null} onPick={(home) => { if (home) set("homeCity", home); }} />
          </div>
        );
    }
  }

  const saveLine = saving
    ? "Saving…"
    : saved
        ? "Saved. Every new plan starts from this."
        : dirty
          ? "You have changes that aren't saved yet."
          : "Every new plan starts from these answers.";

  // `map-chrome-hidden`: a settings page, not a map being read.
  return (
    <main ref={rootRef} className="tm pb map-chrome-hidden">
      <Masthead id={accountId} name={accountName} email={accountEmail} image={accountImage} lead={recentTrips[0]} stats={stats} />

      <section className="pb-sentence" aria-labelledby="pb-sentence-title">
        {/* The one render after sign-up, above the profile it carried across. */}
        <div className="pb-receipt">
          <AccountReceipt />
        </div>
        <p id="pb-sentence-title" className="tm-eyebrow">
          What the planner reads
        </p>
        <p className="pb-line" aria-live="polite">
          {profileSentence(profile)}
        </p>
      </section>

      <div className="pb-body">
        <nav className="pb-index" aria-label="Your answers">
          <ol>
            {SECTIONS.map((s, i) => (
              <li key={s.key}>
                <a href={`#pb-${s.key}`} className={active === s.key ? "is-on" : ""} aria-current={active === s.key ? "true" : undefined}>
                  <span className="pb-index-n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="pb-index-t">{s.title}</span>
                  <span className="pb-index-a">{answerOf(profile, s.key)}</span>
                </a>
              </li>
            ))}
          </ol>
          {/* Light: the bar is paper, so the note takes the light alert colour. */}
          <div className={`pf-save pb-save${dirty || error ? " is-up" : ""}`} role="region" aria-label="Save your profile" data-appearance="light">
            <div className="pf-save-state" role="status">
              {error && (
                <InlineNote size="section" tone="error">
                  {error}
                </InlineNote>
              )}
              <p>{saveLine}</p>
            </div>
            <div className="pf-save-actions">
              {dirty && !saving && (
                <button type="button" className="tm-quiet" onClick={() => { setProfile(baseline); setError(null); }}>
                  Undo changes
                </button>
              )}
              <button type="button" className="tm-signal" disabled={!dirty || saving} onClick={save}>
                {saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>
        </nav>

        <div className="pb-fields">
          {SECTIONS.map((s) => (
            <section key={s.key} id={`pb-${s.key}`} className="pb-field" aria-labelledby={`pb-${s.key}-t`}>
              <h2 id={`pb-${s.key}-t`} className="pb-field-title">
                {s.title}
              </h2>
              {s.hint && <p className="pf-hint">{s.hint}</p>}
              <div className="pb-field-control">{field(s.key)}</div>
            </section>
          ))}

          <section className="pb-kept" aria-label="Kept from your trips">
            <div>
              <header className="pb-kept-head">
                <h2 className="tm-eyebrow">Recent memories</h2>
                {recentTrips.length > 0 && (
                  <Link href="/trips">{tripCount > recentTrips.length ? `See all ${tripCount} in My memories` : "See all in My memories"}</Link>
                )}
              </header>
              {recentTrips.length > 0 ? (
                <ul className="pb-strip">
                  {recentTrips.map((t) => (
                    <StripTrip key={t.id} trip={t} />
                  ))}
                </ul>
              ) : (
                <p className="pf-hint">Plan and keep a trip and it shows up here, with the places you chose.</p>
              )}
            </div>
            {/* Absent with none: an empty list would explain a feature rather than record anything.
                The invitation for these belongs in the wizard that collects them. */}
            {savedPlaces.length > 0 && (
              <div>
                <header className="pb-kept-head">
                  <h2 className="tm-eyebrow">Saved places</h2>
                  <span>
                    {savedPlaces.length} of {savedPlaceCount}
                  </span>
                </header>
                <ul className="pb-places">
                  {savedPlaces.map((p) => (
                    <li key={p.id}>
                      <b>{p.name}</b>
                      {p.city && <span>{p.city}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>

      <footer className="pb-foot">
        <p className="tm-caption tm-muted">Your answers stay on this browser, or on your account when you are signed in.</p>
      </footer>
    </main>
  );
}
