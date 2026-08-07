const STYLES: Record<string, string> = {
  ok: "bg-green-50 text-green-700 border-green-200",
  error: "bg-red-50 text-red-700 border-red-200",
  timeout: "bg-amber-50 text-amber-700 border-amber-200",
  pending: "bg-stone-100 text-stone-600 border-stone-200",
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
