import type { CrowdPreference, EnergyLevel, ExplorerStyle } from "./types";

export interface DurableSummaryInput {
  explorerStyle: ExplorerStyle;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  topPriorities: string[];
}

/**
 * Deliberately its own short labels rather than the pickers' — this is a different register.
 * "High — walk all day" is a good radio-button label and a bad summary segment, and the
 * pickers' constants are value exports anyway, which would make this module unloadable from
 * a .test.mjs.
 */
const STYLE_LABEL: Record<ExplorerStyle, string> = {
  packed: "Packed pace",
  relaxed: "Relaxed pace",
  offbeat: "Offbeat",
  mixed: "Mixed pace",
};

const ENERGY_LABEL: Record<EnergyLevel, string> = {
  high: "High energy",
  moderate: "Moderate energy",
  low: "Low energy",
};

const CROWDS_LABEL: Record<CrowdPreference, string> = {
  love: "Likes crowds",
  mixed: "Crowds either way",
  avoid: "Avoids crowds",
};

/**
 * One line naming the remembered preferences being applied to this trip. It exists so the
 * expander is the explanation of something visible rather than a hidden control — a
 * traveler who cannot see these values has no way to tell the app remembered them.
 */
export function summarizeDurable(values: DurableSummaryInput): string {
  const priorities =
    values.topPriorities.length > 0
      ? values.topPriorities.join(", ")
      : "No starred interests";

  return [
    STYLE_LABEL[values.explorerStyle],
    ENERGY_LABEL[values.energy],
    CROWDS_LABEL[values.crowds],
    priorities,
  ].join(" · ");
}
