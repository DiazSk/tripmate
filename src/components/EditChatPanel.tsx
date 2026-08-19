"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Itinerary, TripSummary, UserAnswers } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";

const SUGGESTIONS = [
  "Is this day too packed?",
  "Less walking, more sitting",
  "Swap in more local food",
  "Make the morning start later",
];

/** "day 2", "days 1 and 3", "days 1, 2 and 4" — the scope confirmation reads as a sentence
 *  rather than an array, so a one-day edit doesn't say "days 2". */
function formatDays(days: number[]): string {
  const label = days.length === 1 ? "day" : "days";
  const list =
    days.length <= 1
      ? days.join("")
      : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
  return `${label} ${list}`;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Present on assistant turns that actually changed something — rendered as the change
   *  summary beneath the reply. The full updated itinerary is never shown here. */
  changes?: string[];
  /** Guardrail alerts (skill §12): a leg that no longer fits, a venue's hours, a day pushed past
   *  8-9 active hours, a budget overshoot. Shown, not suppressed — the change was still made. */
  warnings?: string[];
  /** 1-based day numbers this turn actually changed, computed route-side from the applied ops.
   *  Every turn that edits anything says which days moved, so the scope is never implied. */
  daysModified?: number[];
  /** Ops the applier refused (a stale index, a day out of range). Rare, but silence here reads
   *  as "done" for a turn that partly wasn't. */
  rejected?: string[];
  knockOn?: string | null;
  /** Tappable answers the model offered with a question. Cleared once one is used, so an old
   *  turn's options can't be answered after the conversation has moved on. */
  options?: string[];
}

/**
 * Mode A — the conversational edit surface, scoped to the whole trip or a single day.
 *
 * Multi-turn on purpose: the transcript goes back with every request so the model can build on
 * what was already discussed rather than treating each message as a fresh command. Each turn
 * applies a patch and shows only what moved — never the regenerated plan.
 */
export default function EditChatPanel({
  trip,
  userAnswers,
  itinerary,
  dayIndex,
  tripId,
  onItineraryChange,
  onBusyChange,
}: {
  trip: TripSummary;
  userAnswers?: UserAnswers | null;
  itinerary: Itinerary;
  /** Undefined = whole trip. Set = that day only. */
  dayIndex?: number;
  tripId?: string | null;
  onItineraryChange: (next: Itinerary) => void;
  /** Lets the host dim the live preview while a turn is in flight. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || busy) return;

    const nextMessages: ChatMessage[] = [
      ...messages.map((m) => ({ ...m, options: undefined })),
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    onBusyChange?.(true);
    setError(null);

    try {
      const res = await fetch("/api/trip-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          trip,
          itinerary,
          userAnswers,
          dayIndex,
          tripId,
          // Only role/content go back — the change metadata is display-side and would just be
          // noise in the transcript the model reads.
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Edit failed");

      if (data.itinerary) onItineraryChange(data.itinerary);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "Done.",
          changes: data.changes ?? [],
          warnings: data.warnings ?? [],
          daysModified: data.daysModified ?? [],
          rejected: data.rejected ?? [],
          knockOn: data.knockOn ?? null,
          options: data.options ?? [],
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    // Fills whatever pane it is placed in — Focus Mode owns the framing, header and dimensions
    // now, so this component no longer positions itself.
    <div className="flex h-full min-h-0 flex-col" {...devLabel("EditChatPanel")}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Ask for changes, or just think out loud. Everything you don&apos;t mention stays as
              it is.
            </p>
            {/* Suggestions carry most of the discovery load: people rarely guess that an editor
                like this will answer questions as well as take orders. */}
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => send(sug)}
                  className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-muted transition-colors hover:bg-white/20 hover:text-foreground"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-accent text-accent-foreground"
                  : "bg-white/10 text-foreground"
              }`}
            >
              {m.content}
            </div>
            {/* The shown delta — the persisted itinerary is updated silently behind this. */}
            {m.role === "assistant" && m.daysModified && m.daysModified.length > 0 && (
              <p className="mt-1.5 text-xs font-medium text-foreground/70">
                Updated {formatDays(m.daysModified)}
              </p>
            )}
            {m.role === "assistant" && m.changes && m.changes.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {m.changes.map((c, ci) => (
                  <li key={ci} className="text-xs text-muted">
                    · {c}
                  </li>
                ))}
              </ul>
            )}
            {/* Guardrails read louder than the change list they qualify: the point of the alert is
                that the plan is now something the traveler might not have intended. */}
            {m.role === "assistant" && m.warnings && m.warnings.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {m.warnings.map((w, wi) => (
                  <li
                    key={wi}
                    className="flex gap-1.5 rounded-lg bg-amber-400/10 px-2 py-1.5 text-xs text-amber-200"
                  >
                    <span aria-hidden="true">⚠️</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
            {m.role === "assistant" && m.knockOn && (
              <p className="mt-1 text-xs text-amber-300/80">Also: {m.knockOn}</p>
            )}
            {m.role === "assistant" && m.rejected && m.rejected.length > 0 && (
              <p className="mt-1 text-xs text-red-400/80">
                {m.rejected.length === 1 ? "1 change" : `${m.rejected.length} changes`} couldn&rsquo;t
                be applied ({m.rejected.join("; ")}) — ask again to retry.
              </p>
            )}
            {/* Tap-to-answer. The model is told to supply these whenever it asks something, so
                a question costs a tap rather than a sentence. Typing still works. */}
            {m.role === "assistant" && m.options && m.options.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => send(opt)}
                    disabled={busy}
                    className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent/20 disabled:opacity-40"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && <p className="text-xs text-muted">Thinking…</p>}
        {error && (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-card-border p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="What would you like to change?"
          className="flex-1 resize-none rounded-xl border border-card-border bg-white/10 p-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <button
          type="button"
          onClick={() => send()}
          disabled={!input.trim() || busy}
          aria-label="Send"
          className="rounded-full bg-accent p-2.5 text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
