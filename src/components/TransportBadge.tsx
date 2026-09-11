/** Tinted-on-dark, matching `TraceStatusBadge` — see the note there on why the `-50`/`-700`
 *  light-mode pair had to go. */
const STYLES: Record<string, string> = {
  cli: "bg-sky-400/15 text-sky-300 border-sky-400/30",
  api: "bg-violet-400/15 text-violet-300 border-violet-400/30",
  unknown: "bg-tile text-muted border-card-border",
};

const LABELS: Record<string, string> = {
  cli: "CLI",
  api: "API",
  unknown: "?",
};

/** Which of the two permanent transports served a call — see `RunStepUsage.transport`.
 *  Developer-side only (trace viewer), never shown in the traveler-facing UI. */
export default function TransportBadge({ transport }: { transport: string }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${STYLES[transport] ?? STYLES.unknown}`}
    >
      {LABELS[transport] ?? transport}
    </span>
  );
}
