"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { devLabel } from "@/lib/devInspector";
import { CandidatePoi } from "@/lib/pois";

export default function PoiCandidatePicker({
  pois,
  loading,
  available,
  selected,
  onToggle,
  customPois,
  onAddCustom,
  onRemoveCustom,
}: {
  pois: CandidatePoi[];
  loading: boolean;
  available: boolean;
  selected: CandidatePoi[];
  onToggle: (poi: CandidatePoi) => void;
  customPois: string[];
  onAddCustom: (name: string) => void;
  onRemoveCustom: (name: string) => void;
}) {
  const [customInput, setCustomInput] = useState("");
  const isSelected = (poi: CandidatePoi) => selected.some((p) => p.name === poi.name);

  function submitCustom() {
    const name = customInput.trim();
    if (!name) return;
    onAddCustom(name);
    setCustomInput("");
  }

  return (
    <div className="space-y-3" {...devLabel("PoiCandidatePicker")}>
      {/* The flow's only loading state, and only because this is the one question that needs
          the Step 2a fetch. Everything before it is answerable offline, which is what buys the
          fetch enough time to land before anyone gets here. */}
      {loading && (
        <div aria-live="polite" aria-busy="true">
          <p className="text-xs text-muted">Finding notable spots…</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 w-24 animate-pulse rounded-full bg-white/10" />
            ))}
          </div>
        </div>
      )}

      {!loading && available && (
        <div className="flex flex-wrap gap-2">
          {pois.map((poi) => {
            const active = isSelected(poi);
            return (
              <button
                key={poi.name}
                type="button"
                onClick={() => onToggle(poi)}
                aria-pressed={active}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none ${
                  active ? "bg-accent text-accent-foreground" : "bg-white/10 text-muted hover:bg-white/15"
                }`}
              >
                {poi.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Was "No suggestions for this destination yet — add your own below." — an apology on
          the review screen, right before the traveler commits to a two-minute generation, from
          the one component whose entire job is proving the app knows the destination. Nothing
          about the missing suggestions is provisional or worth apologising for: OpenTripMap is
          either unconfigured or came back empty, and either way the plan still gets built. */}
      {!loading && !available && (
        <p className="text-xs text-muted">We&apos;ll pick every stop for you — add any must-sees below.</p>
      )}

      {customPois.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {customPois.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-medium text-muted"
            >
              {name}
              <button
                type="button"
                onClick={() => onRemoveCustom(name)}
                aria-label={`Remove ${name}`}
                className="rounded-full p-0.5 hover:bg-white/15"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitCustom();
            }
          }}
          placeholder="Add a spot you already know about"
          // The visible heading above sits outside this component, so without a name of its own
          // the field announced as an unlabelled edit box.
          aria-label="Add a spot you already know about"
          className="flex-1 rounded-full bg-white/10 px-3.5 py-1.5 text-sm text-foreground placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={submitCustom}
          aria-label="Add spot"
          // 32x32 before this — under the 44px floor the rest of the app holds to.
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-muted hover:bg-white/15"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
