/* One date format and one currency format for the whole app.

   Before this there were three date formats on screen at once — an ambiguous
   un-localized "09-01-26", a raw ISO "2026-09-01", and whatever the native date
   picker renders — and money was localized in exactly one component, so "$1200"
   and "~$1,200" could appear in the same session. */

/** "2026-09-10" → "Sep 10". The year is dropped: every date on screen sits inside
 *  a trip whose year is established by the range beside it. */
export function formatDate(iso: string): string {
  const d = parseISO(iso);
  if (!d) return iso ?? "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "2026-09-10" → "Thu, Sep 10". For a day heading, where the weekday is what a
 *  traveller actually plans around. */
export function formatDateWithWeekday(iso: string): string {
  const d = parseISO(iso);
  if (!d) return iso ?? "";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "2026-09-01", "2026-09-08" → "Sep 1 – 8" when the month matches, "Sep 28 – Oct 3"
 *  when it doesn't. */
export function formatDateRange(startISO: string, endISO: string): string {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  if (!start || !end) return `${startISO} – ${endISO}`;
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  return sameMonth
    ? `${formatDate(startISO)} – ${end.getDate()}`
    : `${formatDate(startISO)} – ${formatDate(endISO)}`;
}

/** Whole dollars with thousands separators: 1200 → "$1,200". Trips are planned in
 *  round figures and cents would only add noise to a tile the width of "Transit". */
export function formatMoney(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Date-only ISO strings parse as UTC midnight, which renders as the previous day
 *  anywhere west of Greenwich. Build the date in local time instead. */
function parseISO(iso: string): Date | null {
  const parts = (iso ?? "").split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "20:15" → "8:15 PM". The two cases worth naming: midnight's hour is 0, which must read as 12
 *  rather than 0, and noon is 12 PM rather than 12 AM — `h % 12` alone gets both wrong.
 *
 *  Deliberately not `toLocaleTimeString`: that needs a Date, and building one from a bare clock
 *  time means inventing a date for it, which is how a time-only value picks up a timezone it
 *  never had. */
export function formatClockLabel(hhmm: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((hhmm ?? "").trim());
  if (!m) return hhmm ?? "";
  const hour = Number(m[1]);
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${m[2]} ${period}`;
}
