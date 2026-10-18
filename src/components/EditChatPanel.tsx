"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Itinerary, TripSummary, UserAnswers } from "@/lib/types";
import { devLabel } from "@/lib/devInspector";
import { meriForChat } from "@/lib/meri";
import { formatWait, useHold } from "@/lib/actionHolds";
import { failureFromResponse, failureFromThrown, formatResumeTime, holdFromFailure, isAbort, type Failure } from "@/lib/failure";
import Meridian from "./Meridian";
import InlineNote, { HeldNote } from "./InlineNote";

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

/** A turn that didn't land (copy rows T-45..T-50). `retry` offers Try again; `held` counts `{mm:ss}` down. */
type ChatFailure = { text: string; retry?: boolean; held?: boolean };

function chatFailure(f: Failure): ChatFailure {
  switch (f.kind) {
    case "offline":
      return { text: "You’re offline, so your message wasn’t sent. Send it again when you’re back online.", retry: true };
    case "timeout":
      return { text: "TripMate took too long to answer, so it stopped. Your plan is unchanged. Try again, or ask for one change at a time.", retry: true };
    case "rate_limited":
      return {
        text: "You’ve asked TripMate for 6 changes in the last 10 minutes, which is the limit. You can send another in {mm:ss}. Editing stops by hand still works.",
        held: true,
      };
    case "daily_cap":
      return {
        text: `Changes by TripMate are paused for everyone until ${formatResumeTime(f.resumesAt)}. It has reached its limit for the day; it isn’t anything you did. You can still drag stops, edit times and log costs by hand.`,
      };
    case "invalid":
      return { text: "TripMate couldn’t read that request. Reload the trip and try again." };
    default:
      return { text: "TripMate hit a problem answering that. Your plan is unchanged.", retry: true };
  }
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
  sessionId,
  onItineraryChange,
  onDaysModified,
  onBusyChange,
  initialMessage,
  polar = false,
}: {
  /** Drawn in Polar on ice, inside FocusEditMode's Polar look. */
  polar?: boolean;
  trip: TripSummary;
  userAnswers?: UserAnswers | null;
  itinerary: Itinerary;
  /** Undefined = whole trip. Set = that day only. */
  dayIndex?: number;
  tripId?: string | null;
  /** Pre-fills the input on open — e.g. "Fit it anyway" from AnchorReceipt. Never auto-sent; the
   *  traveler still presses send. */
  initialMessage?: string;
  /** The CLI session the itinerary was generated in, so this chat continues that same
   *  conversation. Undefined on a trip generated before sessions existed — the route then falls
   *  back to a fully-rebuilt prompt, so this is optional rather than required. */
  sessionId?: string | null;
  onItineraryChange: (next: Itinerary) => void;
  /** 1-based day numbers a turn actually changed, so the host can mark the day tabs the traveler
   *  is *not* looking at. A trip-scoped chat routinely moves things on days that are nowhere on
   *  screen, and without this the only record is a line of text that scrolls away. */
  onDaysModified?: (days: number[]) => void;
  /** Lets the host dim the live preview while a turn is in flight. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** True while the saved transcript is still on its way, so the empty state does not flash the
   *  "start a conversation" copy at someone who already has one. */
  const [loadingHistory, setLoadingHistory] = useState(!!tripId);
  const [input, setInput] = useState(initialMessage ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChatFailure | null>(null);
  /** Copy rows T-65/T-66: the saved transcript didn't load. The chat itself still works. */
  const [historyFailure, setHistoryFailure] = useState<"offline" | "server" | null>(null);
  /** Bumped by the history note's Try again, to re-run the load. */
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const { secondsLeft: held } = useHold("edit");
  /** True for one lift (420ms) after a reply lands, so Meri marks the arrival once. */
  const [justReplied, setJustReplied] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialMessage) textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The live session id, which can differ from the prop: if the generation session has expired,
  // the route opens a new one and returns it, and every later turn must continue from THAT.
  const [chatSession, setChatSession] = useState<string | null>(sessionId ?? null);
  // The plan fingerprint the session was last told about. Null forces a resync on the next turn
  // — which is exactly what we want after a rejected op, and on the very first turn.
  const [syncedHash, setSyncedHash] = useState<string | null>(null);

  // A different trip is a different conversation. Without this the panel would carry a stale
  // session across a remount and resume someone else's trip.
  //
  // Adjusted during render rather than in an effect, which is React's documented pattern for
  // "reset state when a prop changes": an effect would commit one render in which the session id
  // and the trip disagree, and a message sent in that window resumes the previous trip's chat.
  const conversation = `${tripId ?? ""}:${sessionId ?? ""}`;
  const [lastConversation, setLastConversation] = useState(conversation);
  if (lastConversation !== conversation) {
    setLastConversation(conversation);
    setChatSession(sessionId ?? null);
    setSyncedHash(null);
    // A different trip is a different transcript, and the one on screen belongs to the old one.
    // Cleared here rather than in the loading effect for the same reason the session id is:
    // an effect would commit one render showing the previous trip's conversation.
    setMessages([]);
    setLoadingHistory(!!tripId);
  }

  /**
   * Restore the saved conversation when the panel opens on a trip that has one.
   *
   * Only the display is restored — the transcript sent *to the model* is still whatever this
   * component has in `messages`, which after this effect is the same thing. The CLI session
   * handle (`chat_session_id`) is what actually carries the model's memory; this carries the
   * traveler's, which is the half that was missing: reopening the panel used to show an empty
   * box with no record of what had been asked or what changed.
   *
   * Skipped without a `tripId` — the pre-save result view has no row to have saved anything to.
   * Fail-soft: a transcript that will not load says so at the top (T-65/T-66) and the chat that
   * still works carries on below it.
   */
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    fetch(`/api/trip-chat?tripId=${encodeURIComponent(tripId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { turns?: ChatMessage[] }) => {
        if (cancelled) return;
        setHistoryFailure(null);
        // Options are deliberately dropped on restore: they are tappable answers to a question
        // the model asked in a session that has since moved on, and answering one now would
        // reply to a turn nobody is waiting on. A retry's answer already holds any turn sent since.
        setMessages((data.turns ?? []).map((t) => ({ ...t, options: undefined })));
      })
      .catch((e) => {
        if (!cancelled && !isAbort(e)) setHistoryFailure(failureFromThrown(e).kind === "offline" ? "offline" : "server");
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
    // `historyAttempt` is bumped by the note's Try again, to run this again.
  }, [tripId, historyAttempt]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!justReplied) return;
    const id = setTimeout(() => setJustReplied(false), 420);
    return () => clearTimeout(id);
  }, [justReplied]);

  async function send(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || busy || held !== null) return;

    const nextMessages: ChatMessage[] = [
      ...messages.map((m) => ({ ...m, options: undefined })),
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    setInput("");
    await ask(nextMessages);
  }

  /** One turn: the transcript ending in the traveler's message. Try again re-asks the same one. */
  async function ask(nextMessages: ChatMessage[]) {
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
          sessionId: chatSession,
          syncedHash,
          // Only role/content go back — the change metadata is display-side and would just be
          // noise in the transcript the model reads.
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) throw await failureFromResponse(res, "edit");
      const data = await res.json();

      if (data.itinerary) onItineraryChange(data.itinerary);
      // Reported even when the list is empty — a turn that only answered a question changed no
      // days, and the host needs to hear that rather than infer it from silence.
      onDaysModified?.(data.daysModified ?? []);
      // Track whatever actually served this turn, not what we asked for.
      if (data.sessionId) setChatSession(data.sessionId);
      setSyncedHash(data.syncedHash ?? null);
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
      setJustReplied(true);
    } catch (e) {
      if (isAbort(e)) return;
      // A `Failure` thrown above, or whatever the fetch or the JSON threw.
      const f: Failure = e && typeof e === "object" && "kind" in e ? (e as Failure) : failureFromThrown(e);
      holdFromFailure(f);
      setError(chatFailure(f));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  /** The glass classes, or the Polar drawer's. */
  const k = (glass: string, polarClass: string) => (polar ? polarClass : glass);

  return (
    // Fills whatever pane it is placed in — Focus Mode owns the framing, header and dimensions
    // now, so this component no longer positions itself.
    <div className={k("flex h-full min-h-0 flex-col", "td-chat")} {...devLabel("EditChatPanel")}>
      {/* Who is replying, and whether they are. This replaces the "Thinking…" line that used to sit
          at the foot of the transcript. */}
      <div className={k("flex shrink-0 items-center gap-3 border-b border-card-border px-4 py-3", "td-chat-who")}>
        <Meridian size={polar ? 22 : 28} state={meriForChat({ replying: busy, failure: error?.text ?? null, justReplied })} />
        <div className={k("min-w-0", "td-chat-who-text")}>
          <p className={k("text-sm font-medium text-foreground", "")}>TripMate</p>
          {busy ? (
            <p className={k("text-xs text-foreground/80", "")}>
              <span aria-hidden="true" className="text-accent">
                ●
              </span>{" "}
              Replying
            </p>
          ) : (
            <p className={k("text-xs text-muted", "")}>Ask for a change</p>
          )}
        </div>
        {/* The only announcement: that a reply is coming. The visible header would re-read "TripMate"
            and the idle prompt after every turn, behind any error alert. */}
        <p className="sr-only" role="status">
          {busy ? "TripMate is replying" : ""}
        </p>
      </div>
      <div className={k("min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3", "td-chat-log")}>
        {/* Copy rows T-65/T-66, at the top of the transcript, announced by the region around it. */}
        <div aria-live="polite" className="td-note-slot">
          {historyFailure && (
            <InlineNote
              size="section"
              tone="error"
              // A reload replaces the transcript, so not while a turn is in flight or an unsent one awaits its retry.
              action={{ label: "Try again", onClick: () => setHistoryAttempt((n) => n + 1), busy: busy || !!error?.retry }}
            >
              {historyFailure === "offline"
                ? "You’re offline, so your earlier messages didn’t load. They’ll show when you’re back online."
                : "Your earlier messages didn’t load, so they aren’t shown here. Your plan is unaffected, and you can keep chatting."}
            </InlineNote>
          )}
        </div>
        {loadingHistory && messages.length === 0 && (
          <p className={k("text-sm text-muted", "td-muted")}>Loading your conversation…</p>
        )}

        {!loadingHistory && messages.length === 0 && (
          <div className={k("space-y-3", "td-chat-empty")}>
            <p className={k("text-sm text-muted", "")}>
              Ask for changes, or just think out loud. Everything you don&apos;t mention stays as
              it is.
            </p>
            {/* Suggestions carry most of the discovery load: people rarely guess that an editor
                like this will answer questions as well as take orders. */}
            <div className={k("flex flex-wrap gap-1.5", "td-chips")}>
              {SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => send(sug)}
                  disabled={held !== null}
                  className={k("rounded-full bg-white/10 px-2.5 py-1 text-xs text-muted transition-colors hover:bg-white/20 hover:text-foreground", "")}
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={k(m.role === "user" ? "text-right" : "", `td-turn is-${m.role}`)}>
            <div
              className={k(
                `inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-accent text-accent-foreground" : "bg-white/10 text-foreground"
                }`,
                "td-bubble"
              )}
            >
              {m.content}
            </div>
            {/* The shown delta — the persisted itinerary is updated silently behind this. */}
            {m.role === "assistant" && m.daysModified && m.daysModified.length > 0 && (
              <p className={k("mt-1.5 text-xs font-medium text-foreground/70", "td-turn-head")}>
                Updated {formatDays(m.daysModified)}
              </p>
            )}
            {m.role === "assistant" && m.changes && m.changes.length > 0 && (
              <ul className={k("mt-1 space-y-0.5", "td-changes")}>
                {m.changes.map((c, ci) => (
                  <li key={ci} className={k("text-xs text-muted", "")}>
                    · {c}
                  </li>
                ))}
              </ul>
            )}
            {/* Guardrails read louder than the change list they qualify: the point of the alert is
                that the plan is now something the traveler might not have intended. */}
            {m.role === "assistant" && m.warnings && m.warnings.length > 0 && (
              <ul className={k("mt-1.5 space-y-1", "td-findings")}>
                {m.warnings.map((w, wi) => (
                  <li
                    key={wi}
                    className={k("flex gap-1.5 rounded-lg bg-alert-soft px-2 py-1.5 text-xs text-alert/75", "")}
                  >
                    {!polar && <span aria-hidden="true">⚠️</span>}
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
            {m.role === "assistant" && m.knockOn && (
              <p className={k("mt-1 text-xs text-alert/75", "td-alert-line")}>Also: {m.knockOn}</p>
            )}
            {/* Copy row T-51; the reasons are T-52..T-62, worded by the applier. */}
            {m.role === "assistant" && m.rejected && m.rejected.length > 0 && (
              <p className={k("mt-1 text-xs text-alert/80", "td-alert-line")}>
                {m.rejected.length} of the changes TripMate suggested weren&rsquo;t made: {m.rejected.join("; ")}. The rest went
                through. Ask again in other words to try once more.
              </p>
            )}
            {/* Tap-to-answer. The model is told to supply these whenever it asks something, so
                a question costs a tap rather than a sentence. Typing still works. */}
            {m.role === "assistant" && m.options && m.options.length > 0 && (
              <div className={k("mt-2 flex flex-wrap gap-1.5", "td-chips is-options")}>
                {m.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => send(opt)}
                    disabled={busy || held !== null}
                    className={k("rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent/20 disabled:opacity-40", "")}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Copy rows T-45..T-50. Kept mounted so the words are announced when they arrive; the region
            is this wrapper, because the notes inside swap (a held one for a plain one) and a
            node that arrives with its own live region is not reliably announced. */}
        <div id="chat-send-note" className="td-note-slot" aria-live="polite">
          {error?.held ? (
            <HeldNote size="item" bucket="edit" resolved="You can ask for changes again." live={false}>
              {error.text}
            </HeldNote>
          ) : (
            <InlineNote size="item" tone="error" live={false} action={error?.retry ? { label: "Try again", onClick: () => ask(messages), busy } : undefined}>
              {error?.text ?? ""}
            </InlineNote>
          )}
        </div>
        {polar && busy && (
          <div className="td-bubble is-typing" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={k("flex items-end gap-2 border-t border-card-border p-3", "td-compose")}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={held !== null ? `You can send in ${formatWait(held)}` : "What would you like to change?"}
          aria-describedby="chat-send-note"
          className={k("flex-1 resize-none rounded-xl border border-card-border bg-white/10 p-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25", "")}
        />
        <button
          type="button"
          onClick={() => send()}
          disabled={!input.trim() || busy || held !== null}
          aria-label="Send"
          aria-describedby="chat-send-note"
          className={k("rounded-full bg-accent p-2.5 text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40", "td-send")}
        >
          {polar ? (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
