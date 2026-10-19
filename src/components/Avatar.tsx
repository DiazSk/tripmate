"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import InlineNote from "@/components/InlineNote";
import { AVATAR_EVENT, avatarTint, initialsFor } from "@/lib/avatar";
import { squareJpeg } from "@/lib/avatarImage";
import { failureFromResponse, failureFromThrown, type Failure } from "@/lib/failure";

type Note = { text: string; signIn?: boolean };

/** Copy rows F-05, F-10, F-11 (and the server's own sentence for a photo it refused, F-07 to F-09). */
function uploadNote(f: Failure): Note {
  if (f.kind === "invalid") return { text: f.message };
  if (f.kind === "signed_out") return { text: "Photos are kept with an account, so sign in to add one.", signIn: true };
  if (f.kind === "offline") return { text: "You’re offline, so your photo didn’t save. Try again once you’re back online." };
  return { text: "Your photo didn’t save: TripMate’s server had a problem. Try again." };
}

/** Copy rows F-06, F-13, F-14. */
function removeNote(f: Failure): Note {
  if (f.kind === "signed_out") return { text: "You’ve been signed out, so your photo can’t be changed. Sign in and try again.", signIn: true };
  if (f.kind === "offline") return { text: "You’re offline, so your photo wasn’t removed. Try again once you’re back online." };
  return { text: "Your photo wasn’t removed: TripMate’s server had a problem. Try again." };
}

/**
 * A traveller's face: their photo, else their initials on a disc tinted from their account id (the
 * same colour on every device), else a glyph when nobody is signed in. Editable means a tap opens a
 * file picker and, when there is a photo, offers Remove.
 */
export default function Avatar({
  userId,
  name,
  image,
  size = 80,
  editable = false,
  onChange,
}: {
  userId: string | null;
  name: string | null;
  image: string | null;
  size?: number;
  editable?: boolean;
  onChange?: (image: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Note | null>(null);
  const [menu, setMenu] = useState(false);
  const router = useRouter();
  const noteId = useId();

  function changed(next: string | null) {
    onChange?.(next);
    window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: next }));
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    let body: Awaited<ReturnType<typeof squareJpeg>>;
    try {
      body = await squareJpeg(file);
    } catch {
      // Copy row F-12: the browser could not decode or re-encode it. Nothing was sent.
      setError({ text: "This browser couldn’t prepare that photo. Try a JPEG or PNG." });
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/avatar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        setError(uploadNote(await failureFromResponse(res, "edit")));
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { image?: string };
      if (!json.image) setError(uploadNote({ kind: "server" }));
      else changed(json.image);
    } catch (e) {
      setError(uploadNote(failureFromThrown(e)));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setMenu(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/avatar", { method: "DELETE" });
      if (!res.ok) setError(removeNote(await failureFromResponse(res, "edit")));
      else changed(null);
    } catch (e) {
      setError(removeNote(failureFromThrown(e)));
    } finally {
      setBusy(false);
    }
  }

  const face = image ? (
    // eslint-disable-next-line @next/next/no-img-element -- a same-origin, versioned, already-small image; next/image adds nothing here
    <img src={image} alt="" className="h-full w-full object-cover" />
  ) : userId ? (
    <span className="font-semibold text-white" style={{ fontSize: size * 0.36 }}>{initialsFor(name)}</span>
  ) : (
    <svg viewBox="0 0 24 24" width={size * 0.42} height={size * 0.42} fill="none" stroke="currentColor" strokeWidth="1.6" className="text-muted" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" />
    </svg>
  );

  const disc = (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-card-border transition-opacity ${busy ? "opacity-60" : ""}`}
      style={{ width: size, height: size, background: image ? undefined : userId ? avatarTint(userId) : "rgb(247 245 242 / 0.08)" }}
    >
      {face}
      {busy && <span className="absolute inset-1 animate-spin rounded-full border-2 border-white/25 border-t-accent" aria-hidden="true" />}
    </span>
  );

  if (!editable || !userId) return disc;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (image ? setMenu((m) => !m) : input.current?.click())}
        aria-label={image ? "Change or remove your photo" : "Add a photo"}
        aria-describedby={noteId}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        {disc}
      </button>
      {menu && (
        <div role="menu" className="glass-control absolute top-full left-0 z-20 mt-2 grid min-w-44 rounded-xl p-1 text-sm">
          <button role="menuitem" type="button" className="rounded-lg px-3 py-2 text-left hover:bg-white/10" onClick={() => { setMenu(false); input.current?.click(); }}>Choose a new photo</button>
          <button role="menuitem" type="button" className="rounded-lg px-3 py-2 text-left text-alert hover:bg-white/10" onClick={remove}>Remove photo</button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }}
      />
      {/* Kept mounted, empty, so the words are read when they arrive. Under the photo, and out of the
          layout (absolute), so a failure never moves the page. */}
      <div className="absolute top-full left-0 z-10 mt-2 w-64">
        <InlineNote
          id={noteId}
          size="field"
          tone="error"
          action={error?.signIn ? { label: "Sign in", onClick: () => router.push(`/signin?next=${encodeURIComponent(window.location.pathname)}`) } : undefined}
        >
          {error?.text ?? ""}
        </InlineNote>
      </div>
    </div>
  );
}
