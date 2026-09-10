/**
 * Tinted-on-dark, not tinted-on-light. These were `-50` fills with `-700` text — a light-mode
 * badge set, correct when the trace panel was a white card and illegible once it became part of
 * the app's dark surface. The pattern here is the app's own: a low-alpha wash of the hue for the
 * fill, a `-300`-weight text so it clears contrast on `--surface-deep`, and the border carrying
 * the same hue at a middling alpha.
 */
const STYLES: Record<string, string> = {
  ok: "bg-accent/15 text-accent border-accent/30",
  error: "bg-alert-soft text-alert border-alert/30",
  timeout: "bg-alert-soft text-alert/75 border-alert/30",
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
