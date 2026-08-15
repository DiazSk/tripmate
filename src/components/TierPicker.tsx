"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { TIERS, TierId, estimateTierTotal } from "@/lib/tiers";
import { devLabel } from "@/lib/devInspector";
import { formatMoney } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/gsap";

// Above this multiple of the entered budget, a tier's real price is treated
// as an aspirational stretch rather than a genuine option worth the same
// visual weight as the others (e.g. luxury at 8x a $1,000 budget) — chosen so
// the typical mid-range upsell (~3x budget) still reads as a normal option.
const OVER_BUDGET_MULTIPLIER = 3;

export default function TierPicker({
  days,
  budget,
  selected,
  onSelect,
}: {
  /** Null until both trip dates are set. `tripDays` floors at 1, so computing a total from
   *  a half-filled form would show a plausible-but-wrong number ($70 / $150 / $350); the
   *  cards fall back to each tier's per-day rate, which is true whatever the dates are. */
  days: number | null;
  budget: number;
  selected: TierId;
  onSelect: (tier: TierId) => void;
}) {
  // Read once on mount rather than live: a tilt that could switch on mid-session from a
  // media-query change is not a case worth the extra listener, and matches how Hero's own
  // cursor parallax gates itself. No cursor to track on touch, and reduced motion means the
  // resting (flat) card is the finished composition, not a state waiting to animate away from.
  const tiltEnabled = useRef(false);
  const tiltLayers = useRef(new Map<TierId, HTMLDivElement>());
  useEffect(() => {
    tiltEnabled.current =
      window.matchMedia("(pointer: fine)").matches && !prefersReducedMotion();
  }, []);

  function onTierPointerMove(tier: TierId, e: React.MouseEvent<HTMLButtonElement>) {
    if (!tiltEnabled.current) return;
    const layer = tiltLayers.current.get(tier);
    if (!layer) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    // Small angles only: this is a hint that the card is a physical plane, not a showpiece —
    // the illustration and copy still have to stay legible mid-tilt.
    layer.style.transform = `perspective(800px) rotateX(${-y * 8}deg) rotateY(${x * 8}deg)`;
  }

  function onTierPointerLeave(tier: TierId) {
    const layer = tiltLayers.current.get(tier);
    if (layer) layer.style.transform = "";
  }

  return (
    // A radiogroup, not three toggle buttons. `aria-pressed` on each card announced
    // three independent on/off controls where there is one choice between three.
    // Named with `aria-label` rather than `aria-labelledby`: the only element carrying
    // `id="style-heading"` lives in the Blue Hour TripFormConsole, which this app's home
    // page doesn't render, so a reference would dangle at the call site that does.
    <div
      role="radiogroup"
      aria-label="Style and budget"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      {...devLabel("TierPicker")}
    >
      {TIERS.map((tier, i) => {
        const isSelected = selected === tier.id;
        const total = days === null ? null : estimateTierTotal(tier, days);
        const ratio = total !== null && budget > 0 ? total / budget : 0;
        // A per-day rate can't be over a whole-trip budget, so this stays false until the
        // dates land and `total` becomes a real number.
        const overBudget = ratio > OVER_BUDGET_MULTIPLIER;
        const priceLabel =
          total === null ? `${formatMoney(tier.dailyRate)}/day` : `~${formatMoney(total)}`;
        return (
          <button
            key={tier.id}
            type="button"
            onClick={() => onSelect(tier.id)}
            onMouseMove={(e) => onTierPointerMove(tier.id, e)}
            onMouseLeave={() => onTierPointerLeave(tier.id)}
            role="radio"
            aria-checked={isSelected}
            // The name is built here rather than left to concatenate: the tier's own
            // name led with the illustration's alt text ("Private yacht at night on
            // calm water…") because a decorative background image sits inside the button.
            aria-label={`${tier.name} — ${priceLabel}${overBudget ? `, about ${ratio.toFixed(1)} times your budget` : ""}. ${tier.description}.`}
            // Fans in after the console's cells and the section heading, continuing the same
            // stagger rather than starting a second one.
            style={{ animationDelay: `${360 + i * 70}ms` }}
            className="value-in group relative isolate flex h-[200px] flex-col justify-end overflow-hidden rounded-2xl text-left transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] [perspective:800px] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none"
          >
            {/* Everything that reads as the card's face lives on one tilted plane — the
                perspective belongs on the button (the ancestor), the rotation on this
                layer, so nothing here fights the button's own transition-all. Reset via
                CSS transition on mouse-leave rather than a second JS-driven tween: this
                is the only writer of this element's transform, so there's nothing for
                the Transform-Ownership Rule to protect against here. */}
            <div
              ref={(el) => {
                if (el) tiltLayers.current.set(tier.id, el);
                else tiltLayers.current.delete(tier.id);
              }}
              className="absolute inset-0 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            >
              {/* Selection holds the same scale hover reaches, so picking a card lands where
                  pointing at it was already going — one movement, not two competing ones. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={tier.imageSrc}
                alt=""
                className={`absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105 ${
                  isSelected ? "scale-105" : ""
                }`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
              <div
                className={`absolute inset-0 rounded-2xl ring-2 ring-inset transition-colors duration-300 ${
                  isSelected ? "ring-accent" : "ring-white/0 group-hover:ring-white/40"
                }`}
              />
              {/* The over-budget mute is weight and text alpha only — the badge keeps its slate
                  backing either way. Dropping to bg-white/10 put the price, which is data, near
                  2:1 over the card's bright illustration, and live repricing as the budget field
                  changes means this state is now reachable mid-keystroke. */}
              <div className="absolute top-3 right-3 flex flex-col items-end gap-0.5 rounded-2xl bg-surface-deep/85 px-3 py-1 backdrop-blur-sm">
                {/* Keyed on the text so a re-price remounts the span and replays `value-in`.
                    React would otherwise reuse the node and the figure would swap with no
                    acknowledgement at all — and this figure now changes mid-keystroke. */}
                <span
                  key={priceLabel}
                  className={`value-in text-sm tabular-nums ${overBudget ? "font-normal text-white/80" : "font-semibold text-white"}`}
                >
                  {priceLabel}
                </span>
                {overBudget && (
                  // text-xs, not the 10px this used to be: 10px is off the type ramp entirely
                  // and this line is the explanation for a muted price, so it has to be read.
                  <span className="text-xs leading-none tabular-nums text-white/70">
                    ~{ratio.toFixed(1)}x your budget
                  </span>
                )}
              </div>
              {isSelected && (
                <div className="pop-in absolute top-3 left-3 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                </div>
              )}
              {/* aria-hidden on the whole visible block: the button carries its own
                  composed label above, and the tier's name — which lives only in
                  `tier.name` — now appears on the card rather than only in the prompt. */}
              <div aria-hidden="true" className="relative z-10 p-3">
                <div className="font-display text-base font-semibold text-white">{tier.headline}</div>
                {/* The tier's name joins its description rather than sitting above the
                    headline as a kicker, which the system bans outright. Same shape the
                    itinerary card's header uses, so the style is named identically in both
                    places — until now `tier.name` existed only inside the prompt. */}
                <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/80">
                  <span className="font-semibold text-white">{tier.name}</span> · {tier.description}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
