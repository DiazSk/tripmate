import type { CrowdPreference, EnergyLevel, ExplorerStyle, GroupType } from "./types";
import type { TierId } from "./tiers";

/** The single implicit local user. Replaced by a real auth subject id if and when
 *  authentication lands — see FUTURE-INTEGRATION.md. */
export const LOCAL_OWNER = "local";

/**
 * What stays true between trips. Purpose, dates, budget amount and POIs are
 * deliberately absent: a business trip and an anniversary are the same person,
 * and the budget is a function of the trip, not of the traveler. `tier` is kept
 * because the spending *style* is a preference even though the amount is not.
 */
export interface TravelerProfile {
  group: GroupType;
  explorerStyle: ExplorerStyle;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  tier: TierId;
  priorities: string[];
  topPriorities: string[];
}

const GROUPS: GroupType[] = ["solo", "couple", "family_with_kids"];
const STYLES: ExplorerStyle[] = ["packed", "relaxed", "offbeat", "mixed"];
const ENERGIES: EnergyLevel[] = ["high", "moderate", "low"];
const CROWDS: CrowdPreference[] = ["love", "mixed", "avoid"];
const TIER_IDS: TierId[] = ["budget", "midrange", "luxury"];

/**
 * The trust boundary. Rejects anything that isn't a known enum value and returns
 * only known fields, so a bad value can never reach storage — from there it would
 * propagate silently into every future trip's prompt, which is far harder to
 * notice than a 400 at the point of writing it.
 */
export function parseProfile(value: unknown): TravelerProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  const stringList = (x: unknown): string[] | null =>
    Array.isArray(x) && x.every((s) => typeof s === "string") ? (x as string[]) : null;

  const priorities = stringList(v.priorities);
  const topPriorities = stringList(v.topPriorities);
  if (
    !GROUPS.includes(v.group as GroupType) ||
    !STYLES.includes(v.explorerStyle as ExplorerStyle) ||
    !ENERGIES.includes(v.energy as EnergyLevel) ||
    !CROWDS.includes(v.crowds as CrowdPreference) ||
    !TIER_IDS.includes(v.tier as TierId) ||
    priorities === null ||
    topPriorities === null
  ) {
    return null;
  }

  return {
    group: v.group as GroupType,
    explorerStyle: v.explorerStyle as ExplorerStyle,
    energy: v.energy as EnergyLevel,
    crowds: v.crowds as CrowdPreference,
    tier: v.tier as TierId,
    priorities,
    topPriorities,
  };
}
