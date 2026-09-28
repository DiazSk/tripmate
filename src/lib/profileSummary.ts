import type {
  CrowdPreference,
  DiscoveryPreference,
  EnergyLevel,
  ExplorerStyle,
  PacePreference,
} from "./types";
import { travelStyleOf } from "./userAnswers";

export interface DurableSummaryInput {
  /** Legacy; still read when the pair below is absent, which is every stored row. */
  explorerStyle: ExplorerStyle;
  pace?: PacePreference;
  discovery?: DiscoveryPreference;
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
/** Two segments where there was one, because there were always two answers in there. */
const PACE_LABEL: Record<PacePreference, string> = {
  packed: "Packed pace",
  balanced: "Balanced pace",
  relaxed: "Relaxed pace",
};

const DISCOVERY_LABEL: Record<DiscoveryPreference, string> = {
  iconic: "Iconic highlights",
  local: "Mostly local",
  mix: "Iconic and local",
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

  const style = travelStyleOf(values);

  return [
    PACE_LABEL[style.pace],
    DISCOVERY_LABEL[style.discovery],
    ENERGY_LABEL[values.energy],
    CROWDS_LABEL[values.crowds],
    priorities,
  ].join(" · ");
}
