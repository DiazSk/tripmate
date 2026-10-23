/**
 * Whether a trip is still ahead, under way or done, for `trip_opened`. Calendar dates are ISO
 * `YYYY-MM-DD` and compared as strings, which orders them correctly and never touches a `Date`,
 * so no timezone can roll a date back a day (the CLAUDE.md "UTC midnight" gotcha).
 */
export function tripPhase(startDate: string, endDate: string, todayInTripZone: string): "before" | "during" | "after" {
  if (todayInTripZone < startDate) return "before";
  if (todayInTripZone > endDate) return "after";
  return "during";
}

/**
 * Today's date in the trip's own timezone (the day a traveller there is living), as the phone's
 * `todayInZone` does. An unknown or missing zone is the viewer's own day: a trip with no zone on
 * file should still get a phase, and being a day off at the edges costs one event a wrong label.
 */
export function todayInZone(timezone: string | null | undefined, at: Date = new Date()): string {
  try {
    // `en-CA` formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", timezone ? { timeZone: timezone } : undefined).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA").format(at);
  }
}
