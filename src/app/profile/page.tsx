"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BackButton from "@/components/BackButton";
import ChoicePicker, { CROWD_PREFERENCES, ENERGY_LEVELS } from "@/components/ChoicePicker";
import ExplorerStylePicker from "@/components/ExplorerStylePicker";
import GroupTypePicker from "@/components/GroupTypePicker";
import InterestPicker from "@/components/InterestPicker";
import TierPicker from "@/components/TierPicker";
import DietaryPicker from "@/components/DietaryPicker";
import ErrorNote from "@/components/ErrorNote";
import type { TravelerProfile } from "@/lib/travelerProfile";
import type { CrowdPreference, EnergyLevel, ExplorerStyle, GroupType } from "@/lib/types";
import type { TierId } from "@/lib/tiers";

const DEFAULTS: TravelerProfile = {
  group: "solo",
  explorerStyle: "mixed",
  energy: "moderate",
  crowds: "mixed",
  tier: "midrange",
  priorities: [],
  topPriorities: [],
  dietary: { tags: [], note: "" },
};

const MAX_STARRED = 3;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 py-5 first:pt-0 last:pb-0">
      <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="pt-1">{children}</div>
    </section>
  );
}

/**
 * Where the durable traveler traits are actually owned. The plan wizard asks only what
 * changes per trip, so without this page explorer style, energy, crowds, tier, priorities
 * and dietary needs would be set once and never changeable.
 */
export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<TravelerProfile>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.profile) setProfile(data.profile as TravelerProfile);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  if (loading) {
    return (
      <main className="dashboard-page map-chrome-hidden flex min-h-full items-center justify-center">
        <p className="text-sm text-muted">Loading your profile…</p>
      </main>
    );
  }

  return (
    <main className="map-chrome-hidden min-h-full p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)]">
      {/* `pointer-events-auto`: this page's content sits inside AppShell's own
          `pointer-events-none` scroll container (what keeps the Cesium globe underneath
          draggable) — without opting back in here, every click passes through to the
          globe canvas instead of reaching any picker or the Save button. Same pattern
          trips/page.tsx and TripView.tsx already use on their own outermost box.
          `profile-glass rounded-2xl`: the cobalt/teal frosted-glass panel so every section
          and button sits on a distinct, legible surface instead of directly on the globe. */}
      <div className="profile-glass pointer-events-auto mx-auto w-full max-w-2xl divide-y divide-card-border rounded-2xl p-5 sm:p-6">
        <header className="space-y-1 pb-5">
          {/* `/profile` is reachable from both the home page and a trip detail, so a fixed
              destination would be wrong from one of them — this pops history instead. The
              fallback covers a direct link or a refresh, where there is no entry to pop and
              `back()` would silently do nothing. */}
          <BackButton
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
            className="mb-2"
          >
            Back
          </BackButton>
          <h1 className="font-display text-2xl font-semibold text-foreground">Your travel profile</h1>
          <p className="text-sm text-muted">
            The things that stay true between trips. We apply these to every plan so the wizard
            only has to ask what actually changes.
          </p>
        </header>

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

        <Section title="Spending style">
          <TierPicker
            days={null}
            budget={0}
            selected={profile.tier}
            onSelect={(v: TierId) => set("tier", v)}
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
    </main>
  );
}
