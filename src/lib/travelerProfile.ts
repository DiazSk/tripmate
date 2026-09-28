import type {
  AccessibilityNeeds,
  CrowdPreference,
  EnergyLevel,
  DiscoveryPreference,
  ExplorerStyle,
  PacePreference,
  GroupType,
} from "./types";
import { DISCOVERIES, PACES } from "./userAnswers";

/** The single implicit local user. Replaced by a real auth subject id if and when
 *  authentication lands — see FUTURE-INTEGRATION.md. */
export const LOCAL_OWNER = "local";

/** Dietary restrictions that hold across every trip. `tags` are the fixed chips the
 *  traveler picked; `note` is whatever the chips don't cover. Both empty is normal and
 *  means "no restrictions" — it is not a missing value. */
export interface DietaryNeeds {
  tags: string[];
  note: string;
}

/**
 * What stays true between trips. Purpose, dates, budget amount and POIs are
 * deliberately absent: a business trip and an anniversary are the same person,
 * and the budget is a function of the trip, not of the traveler.
 *
 * `tier` used to live here too, on the reasoning that spending *style* is a preference even
 * though the amount is not. It was removed with the picker that set it: tier is now derived from
 * the trip's own budget by `closestTier`, so a stored style could only ever contradict the number
 * the traveler just typed. Old rows keep the key; nothing reads it.
 */
export interface TravelerProfile {
  group: GroupType;
  /** Legacy, still required so a stored row and the frozen Swift app stay valid. New clients
   *  write it beside the pair, derived by `legacyExplorerStyle`. */
  explorerStyle: ExplorerStyle;
  /** Optional: no stored profile has them. Absence means "read `explorerStyle`", which is what
   *  `travelStyleOf` does. */
  pace?: PacePreference;
  discovery?: DiscoveryPreference;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  priorities: string[];
  topPriorities: string[];
  dietary: DietaryNeeds;
  /**
   * Stated access needs, here for the same reason `dietary` is: they are a fact about the
   * traveler, not about the trip, and re-asking a wheelchair user on every trip is how a hard
   * constraint gets skipped on the one trip they forget. §9e treats a step-free requirement as
   * outranking pace and priority, so an unstated one is the expensive kind of missing.
   */
  accessibility: AccessibilityNeeds;
}

/** "Nothing stated", which is a real answer and not a missing value — same contract as an
 *  empty `dietary`. Shared so the parser, the profile form and the wizard cannot drift. */
export const NO_ACCESSIBILITY_NEEDS: AccessibilityNeeds = {
  stepFreeRequired: false,
  limitStairs: false,
  note: "",
};

const GROUPS: GroupType[] = ["solo", "couple", "family_with_kids", "other"];
const STYLES: ExplorerStyle[] = ["packed", "relaxed", "offbeat", "mixed"];
const ENERGIES: EnergyLevel[] = ["high", "moderate", "low"];
const CROWDS: CrowdPreference[] = ["love", "mixed", "avoid"];

/**
 * Returns the default for an absent `dietary` rather than rejecting the profile: rows
 * written before this field existed are valid profiles, and failing them would silently
 * wipe a traveler's saved preferences the first time they loaded the page. A *malformed*
 * dietary is still rejected — that's a contract failure, not an old row.
 */
function parseDietary(value: unknown): DietaryNeeds | null {
  if (value === undefined || value === null) return { tags: [], note: "" };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const d = value as Record<string, unknown>;

  const tags =
    d.tags === undefined
      ? []
      : Array.isArray(d.tags) && d.tags.every((t) => typeof t === "string")
        ? (d.tags as string[])
        : null;
  const note = d.note === undefined ? "" : typeof d.note === "string" ? d.note : null;
  if (tags === null || note === null) return null;
  return { tags, note };
}

/** Same absent-is-default, malformed-is-rejected contract as `parseDietary`, and for the same
 *  reason: a profile written before this field existed is valid, and failing it would wipe the
 *  traveler's saved preferences on first load. */
function parseAccessibility(value: unknown): AccessibilityNeeds | null {
  if (value === undefined || value === null) return NO_ACCESSIBILITY_NEEDS;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const a = value as Record<string, unknown>;

  const flag = (x: unknown): boolean | null =>
    x === undefined ? false : typeof x === "boolean" ? x : null;
  const stepFreeRequired = flag(a.stepFreeRequired);
  const limitStairs = flag(a.limitStairs);
  const note = a.note === undefined ? "" : typeof a.note === "string" ? a.note : null;
  if (stepFreeRequired === null || limitStairs === null || note === null) return null;
  return { stepFreeRequired, limitStairs, note };
}

/**
 * The trust boundary. Rejects anything that isn't a known enum value and returns
 * only known fields, so a bad enum value can never reach storage — from there it
 * would propagate silently into every future trip's prompt, which is far harder
 * to notice than a 400 at the point of writing it. That guarantee is specific to
 * the five enum fields: `priorities`/`topPriorities` are only checked for being
 * string arrays, not for content or length, so an unbounded or malicious string
 * there still reaches storage and the prompt — the same pre-existing gap as
 * `preferences.tags` elsewhere in this codebase, not closed here.
 */
export function parseProfile(value: unknown): TravelerProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  const stringList = (x: unknown): string[] | null =>
    Array.isArray(x) && x.every((s) => typeof s === "string") ? (x as string[]) : null;

  const dietary = parseDietary(v.dietary);
  const accessibility = parseAccessibility(v.accessibility);
  const priorities = stringList(v.priorities);
  const topPriorities = stringList(v.topPriorities);
  if (
    dietary === null ||
    accessibility === null ||
    !GROUPS.includes(v.group as GroupType) ||
    !STYLES.includes(v.explorerStyle as ExplorerStyle) ||
    !ENERGIES.includes(v.energy as EnergyLevel) ||
    !CROWDS.includes(v.crowds as CrowdPreference) ||
    priorities === null ||
    topPriorities === null
  ) {
    return null;
  }

  return {
    group: v.group as GroupType,
    explorerStyle: v.explorerStyle as ExplorerStyle,
    // Validated by inclusion rather than rejected when absent or junk — an old row has neither,
    // and `travelStyleOf` reads the legacy field for exactly that case.
    ...(PACES.includes(v.pace as PacePreference) ? { pace: v.pace as PacePreference } : {}),
    ...(DISCOVERIES.includes(v.discovery as DiscoveryPreference)
      ? { discovery: v.discovery as DiscoveryPreference }
      : {}),
    energy: v.energy as EnergyLevel,
    crowds: v.crowds as CrowdPreference,
    priorities,
    topPriorities,
    dietary,
    accessibility,
  };
}
