"use client";

import { useRef, useState } from "react";
import { avatarTint, initialsFor } from "@/lib/avatar";
import { squareJpeg } from "@/lib/avatarImage";

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
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = await squareJpeg(file);
      const res = await fetch("/api/avatar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { image?: string; error?: string };
      if (!res.ok || !json.image) throw new Error(json.error ?? "Couldn't save that photo. Try again.");
      onChange?.(json.image);
    } catch (e) {
      setError(e instanceof Error && e.message !== "encode" ? e.message : "Couldn't save that photo. Try again.");
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
      if (!res.ok) throw new Error();
      onChange?.(null);
    } catch {
      setError("Couldn't remove that photo. Try again.");
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
      {error && <p role="alert" className="absolute top-full left-0 mt-2 w-56 text-xs text-alert">{error}</p>}
    </div>
  );
}
