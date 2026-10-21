/**
 * **The Android dialog counts days in UTC.** It is handed `value.toISOString()` and hands back
 * Compose's `selectedDateMillis`, the chosen day at UTC midnight, where iOS works in local time.
 * Measured in PDT: picking the 21st set the 20th; east of Greenwich it would also open on the day
 * before. So a date goes in as its local calendar day at UTC midnight and comes back read the same way.
 */
export const toUtcDay = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
export const fromUtcDay = (d: Date) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
