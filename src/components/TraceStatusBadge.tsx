/**
 * Tinted-on-dark, not tinted-on-light. These were `-50` fills with `-700` text — a light-mode
 * badge set, correct when the trace panel was a white card and illegible once it became part of
 * the app's dark surface. The pattern here is the app's own: a low-alpha wash of the hue for the
 * fill, a `-300`-weight text so it clears contrast on `--surface-deep`, and the border carrying
 * the same hue at a middling alpha.
 */
const STYLES: Record<string, string> = {
  ok: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30",
  error: "bg-red-400/15 text-red-300 border-red-400/30",
  timeout: "bg-amber-400/15 text-amber-300 border-amber-400/30",
  pending: "bg-tile text-muted border-card-border",
};

export default function TraceStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${STYLES[status] ?? STYLES.pending}`}
    >
      {status}
    </span>
  );
}
