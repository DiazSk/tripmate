"use client";

import { useState } from "react";
import DietaryPicker from "@/components/DietaryPicker";
import type { DietaryNeeds, TravelerProfile } from "@/lib/travelerProfile";

/**
 * Offered once, on the result screen, after the traveler has seen a real itinerary — not in
 * front of the first trip. There is no profile to skip screens from on a first run either
 * way, so putting this first would only move friction to the moment someone has seen no
 * value yet.
 *
 * Pre-filled with the answers they just gave, plus the one question the wizard never asks.
 * Saving is one click; dismissing costs nothing and leaves the app exactly as it was.
 */
export default function OnboardingCard({
  answers,
  onSaved,
  onDismiss,
}: {
  answers: Omit<TravelerProfile, "dietary">;
  onSaved: () => void;
  onDismiss: () => void;
}) {
  const [dietary, setDietary] = useState<DietaryNeeds>({ tags: [], note: "" });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: { ...answers, dietary } }),
      });
      if (!res.ok) throw new Error("save failed");
      onSaved();
    } catch {
      // Swallowed on purpose. This fires seconds after a two-minute generation the traveler
      // is already happy with; turning that into an error banner over an optional
      // convenience would be the wrong trade. /profile reports its own failures.
      onDismiss();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-itinerary space-y-4 rounded-2xl p-4">
      <div className="space-y-1">
        <h3 className="font-display text-base font-semibold text-foreground">
          Save these for next time?
        </h3>
        <p className="text-sm text-muted">
          We&apos;ll remember how you travel and ask three fewer questions on your next trip.
          You can change any of it later on your profile.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted">
          Any dietary needs? We&apos;ll apply them to every food stop.
        </label>
        <DietaryPicker value={dietary} onChange={setDietary} />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save my profile"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-sm text-muted underline-offset-4 hover:underline"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
