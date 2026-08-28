const STYLES: Record<string, string> = {
  cli: "bg-sky-50 text-sky-700 border-sky-200",
  api: "bg-violet-50 text-violet-700 border-violet-200",
  unknown: "bg-stone-100 text-stone-600 border-stone-200",
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
