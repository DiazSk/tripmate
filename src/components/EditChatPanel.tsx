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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Present on assistant turns that actually changed something — rendered as the change
   *  summary beneath the reply. The full updated itinerary is never shown here. */
  changes?: string[];
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
            {m.role === "assistant" && m.changes && m.changes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {m.changes.map((c, ci) => (
                  <li key={ci} className="text-xs text-muted">
                    · {c}
                  </li>
                ))}
              </ul>
            )}
            {m.role === "assistant" && m.knockOn && (
              <p className="mt-1 text-xs text-amber-300/80">Also: {m.knockOn}</p>
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
