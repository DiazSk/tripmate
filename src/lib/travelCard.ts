/**
 * The welcome's decisions, as pure functions both clients draw from: which stamps land on the travel
 * card, what the closing sentence says, what the character says, and how the answers become a
 * traveller profile. Spec: `docs/superpowers/specs/2026-10-12-profile-photos-and-onboarding-design.md`.
 *
 * On screen the character is "your TripMate". Nothing here, or anywhere a traveller can read it,
 * says "Meri".
 */
import type { CrowdPreference, GroupType, PacePreference } from "./types";
import { NO_ACCESSIBILITY_NEEDS, type HomeCity, type TravelerProfile } from "./travelerProfile";
import { legacyExplorerStyle } from "./userAnswers";

export const WELCOME_STEPS = ["welcome", "you", "who", "rhythm", "matters", "home", "ready"] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];

export interface WelcomeAnswers {
  name: string;
  group: GroupType | null;
  pace: PacePreference | null;
  crowds: CrowdPreference | null;
  /** In the order picked; the first leads. At most `MAX_LOVES`. */
  loves: string[];
  diet: string[];
  home: HomeCity | null;
}

export const MAX_LOVES = 3;

export const GROUP_CHOICES: { id: GroupType; title: string; hint: string; stamp: string; line: string }[] = [
  { id: "solo", title: "Just me", hint: "Your pace, your table", stamp: "SOLO", line: "Just you. I'll keep the days flexible." },
  { id: "couple", title: "The two of us", hint: "Tables for two", stamp: "FOR TWO", line: "The two of you. I'll look for tables for two." },
  { id: "family_with_kids", title: "Family", hint: "Room for little legs", stamp: "FAMILY", line: "Family it is. I'll leave room for little legs and naps." },
  { id: "other", title: "Friends & groups", hint: "Long dinners, big days", stamp: "WITH FRIENDS", line: "Friends. Long dinners and big days, then." },
];

export const PACE_CHOICES: { id: PacePreference; label: string; stamp: string; times: string[]; line: string }[] = [
  { id: "relaxed", label: "Slow mornings", stamp: "SLOW MORNINGS", times: ["10:30", "14:00", "19:30"], line: "Slow mornings. Nothing before ten, I promise." },
  { id: "balanced", label: "Balanced", stamp: "BALANCED DAYS", times: ["09:30", "12:30", "15:30", "19:30"], line: "Balanced. Room to wander between the big things." },
  { id: "packed", label: "Make the most", stamp: "FULL DAYS", times: ["08:30", "10:30", "12:30", "15:00", "17:30", "20:00"], line: "Full days. I'll make every hour count." },
];

export const CROWD_CHOICES: { id: CrowdPreference; label: string; line: string }[] = [
  { id: "love", label: "Love the buzz", line: "Right where it's happening, then." },
  { id: "mixed", label: "Either way", line: "Fair enough. I'll mix it up." },
  { id: "avoid", label: "Quiet corners", line: "Quiet corners. I'll time the busy places for early or late." },
];

export const STAMP_INK = { group: "#26407e", pace: "#7a2236", loves: "#21583f", home: "#4a367a" } as const;
export type StampKey = keyof typeof STAMP_INK;
export interface Stamp {
  key: StampKey;
  shape: "circle" | "rect" | "oval" | "hex";
  ink: string;
  label: string;
  date: string;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_TITLE = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "11 OCT 26" — an entry stamp's own date. UTC, so it never rolls back a day west of Greenwich. */
export function stampDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** "11 Oct 2026", for the card's footer. */
export function issuedDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_TITLE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const shortLove = (tag: string) => tag.split(/[\s&-]+/)[0].toUpperCase();

/** One stamp per answered step, in the order the steps come. */
export function stampsFor(answers: WelcomeAnswers, issued: Date): Stamp[] {
  const date = stampDate(issued);
  const stamps: Stamp[] = [];
  const group = GROUP_CHOICES.find((g) => g.id === answers.group);
  if (group) stamps.push({ key: "group", shape: "circle", ink: STAMP_INK.group, label: group.stamp, date });
  const pace = PACE_CHOICES.find((p) => p.id === answers.pace);
  if (pace) stamps.push({ key: "pace", shape: "rect", ink: STAMP_INK.pace, label: pace.stamp, date });
  if (answers.loves[0]) stamps.push({ key: "loves", shape: "oval", ink: STAMP_INK.loves, label: `${shortLove(answers.loves[0])} FIRST`, date });
  if (answers.home) stamps.push({ key: "home", shape: "hex", ink: STAMP_INK.home, label: answers.home.name.toUpperCase(), date });
  return stamps;
}

export function answersFromProfile(profile: TravelerProfile | null, name: string): WelcomeAnswers {
  return {
    name,
    group: profile?.group ?? null,
    pace: profile?.pace ?? null,
    crowds: profile?.crowds ?? null,
    loves: profile ? profile.topPriorities.slice(0, MAX_LOVES) : [],
    diet: profile ? [...profile.dietary.tags] : [],
    home: profile?.homeCity ?? null,
  };
}

/**
 * The answers as a full profile. What the welcome does not ask about — energy, accessibility,
 * discovery, the dietary note — comes from the existing profile untouched, so a claimed profile's
 * access needs survive the welcome.
 */
export function welcomeToProfile(answers: WelcomeAnswers, existing: TravelerProfile | null): TravelerProfile {
  const base: TravelerProfile = existing ?? {
    group: "solo",
    explorerStyle: "mixed",
    pace: "balanced",
    discovery: "mix",
    energy: "moderate",
    crowds: "mixed",
    priorities: [],
    topPriorities: [],
    dietary: { tags: [], note: "" },
    accessibility: NO_ACCESSIBILITY_NEEDS,
  };
  const pace = answers.pace ?? base.pace ?? "balanced";
  const discovery = base.discovery ?? "mix";
  const home = answers.home ?? base.homeCity;
  return {
    ...base,
    group: answers.group ?? base.group,
    pace,
    discovery,
    explorerStyle: legacyExplorerStyle({ pace, discovery }),
    crowds: answers.crowds ?? base.crowds,
    priorities: answers.loves.length ? [...answers.loves] : base.priorities,
    topPriorities: answers.loves.slice(0, MAX_LOVES),
    dietary: { tags: [...answers.diet], note: base.dietary.note },
    ...(home ? { homeCity: home } : {}),
  };
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function welcomeSummary(answers: WelcomeAnswers): string {
  const parts: string[] = [];
  const pace = PACE_CHOICES.find((p) => p.id === answers.pace);
  if (pace) parts.push(pace.label.toLowerCase());
  if (answers.crowds === "avoid") parts.push("quiet corners");
  if (answers.crowds === "love") parts.push("right in the buzz");
  if (answers.loves[0]) parts.push(`${answers.loves[0].toLowerCase()} first`);
  if (answers.diet.length) parts.push(`${answers.diet.join(" and ").toLowerCase()} tables`);
  if (!parts.length) return "Every plan I write starts with what you've told me, and you can tell me more any time on your Profile.";
  const who = { solo: "for you", couple: "for the two of you", family_with_kids: "for the whole family", other: "for you and your friends" }[
    answers.group ?? "solo"
  ];
  return `${cap(parts.join(", "))}. Every plan I write ${who} starts there.`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

export const STEP_LINES = {
  you: "First things first. What should I call you?",
  who: "Who usually comes along?",
  rhythm: "Now, how do you like your days to feel?",
  matters: "What would you cross a city for?",
  home: "Last one. Where do you usually set off from?",
} as const;

export function loveLine(loves: string[], added: string): string {
  if (loves.length >= MAX_LOVES) return "That's your three. I know what to look for.";
  if (loves.length === 1) return `${added} first. Good choice.`;
  return `${added} too. One more if you like.`;
}
export const dietLine = (tag: string) => `${tag}. Every restaurant I suggest will fit.`;
export const homeLine = (city: string) => `${city}. I'll keep that in mind for flights and time zones.`;
export const photoLine = (name: string) => `There you are, ${firstName(name)}. Lovely.`;
export const readyLine = (name: string) => `Your card is done, ${firstName(name)}. I've got you now.`;
