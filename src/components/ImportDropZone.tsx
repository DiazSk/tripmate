"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { anchorKey } from "@/lib/anchors";
import type { Anchor } from "@/lib/types";

/** Long edge the model reads at full fidelity; anything larger only costs upload time. */
const LONG_EDGE_PX = 1568;

type Pending =
  | { kind: "image"; mediaType: "image/jpeg"; data: string; preview: string }
  | { kind: "url"; url: string }
  | { kind: "text"; text: string };

async function downscale(file: File): Promise<Pending> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL("image/jpeg", 0.85);
  return { kind: "image", mediaType: "image/jpeg", data: preview.split(",")[1], preview };
}

/** One pasted blob of text → a link per URL line, and the rest as one note. */
function splitText(text: string): Pending[] {
  const lines = text.split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean);
  const urls = lines.filter((l) => /^https?:\/\/\S+$/.test(l));
  const rest = lines.filter((l) => !urls.includes(l)).join("\n");
  return [...urls.map((url) => ({ kind: "url" as const, url })), ...(rest ? [{ kind: "text" as const, text: rest }] : [])];
}

export default function ImportDropZone({
  destination,
  anchors,
  onAnchorsChange,
  onDestinationGuess,
}: {
  destination: string;
  anchors: Anchor[];
  onAnchorsChange: (update: (prev: Anchor[]) => Anchor[]) => void;
  onDestinationGuess: (guess: string) => void;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [unread, setUnread] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function take(files: File[], text: string) {
    const images = await Promise.all(files.filter((f) => f.type.startsWith("image/")).map(downscale));
    setPending((prev) => [...prev, ...images, ...(text.trim() ? splitText(text) : [])]);
  }

  async function findPlaces() {
    if (pending.length === 0) return;
    setBusy(true);
    setUnread([]);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          destination,
          items: pending.map((p) => (p.kind === "image" ? { kind: "image", mediaType: p.mediaType, data: p.data } : p)),
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        destinationGuess?: string | null;
        places?: Anchor[];
        unread?: { index: number; reason: string }[];
      };
      if (!res.ok) {
        setUnread([json.error ?? "Couldn't read these right now."]);
        return;
      }
      const incoming = json.places ?? [];
      onAnchorsChange((prev) => {
        const byKey = new Map(prev.map((a) => [anchorKey(a.name), a] as const));
        for (const place of incoming) {
          const key = anchorKey(place.name);
          const existing = byKey.get(key);
          if (!existing) {
            byKey.set(key, place);
          } else if (existing.lat === null && place.lat !== null) {
            byKey.set(key, { ...existing, lat: place.lat, lng: place.lng });
          }
        }
        return Array.from(byKey.values());
      });
      if (json.destinationGuess && !destination.trim()) onDestinationGuess(json.destinationGuess);
      setUnread((json.unread ?? []).map((u) => u.reason));
      setPending([]);
    } catch {
      setUnread(["Couldn't read these right now."]);
    } finally {
      setBusy(false);
    }
  }

  const toggleMust = (name: string) =>
    onAnchorsChange((prev) => prev.map((a) => (a.name === name ? { ...a, priority: a.priority === "must" ? "want" : "must" } : a)));
  const remove = (name: string) => onAnchorsChange((prev) => prev.filter((a) => a.name !== name));

  return (
    <div className="mt-4">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(Array.from(e.dataTransfer.files), e.dataTransfer.getData("text/plain"));
        }}
        onPaste={(e) => void take(Array.from(e.clipboardData.files), e.clipboardData.getData("text/plain"))}
        tabIndex={0}
        className={`block cursor-pointer rounded-xl border border-dashed px-4 py-3 text-sm text-muted ${dragging ? "border-accent" : "border-white/20"}`}
      >
        Drop what you&apos;ve saved: screenshots, links, notes.
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => void take(Array.from(e.target.files ?? []), "")}
        />
      </label>

      {pending.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {pending.map((p, i) =>
            p.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local data URL, not an optimisable asset
              <img key={i} src={p.preview} alt="" className="h-12 w-12 rounded-md object-cover" />
            ) : (
              <span key={i} className="max-w-48 truncate rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-medium text-muted">
                {p.kind === "url" ? p.url : p.text}
              </span>
            )
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void findPlaces()}
            className="rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
          >
            {busy ? "Reading…" : "Find the places"}
          </button>
        </div>
      )}

      {unread.length > 0 && (
        <ul className="mt-2 text-xs text-muted" aria-live="polite">
          {unread.map((u, i) => <li key={i}>{u}</li>)}
        </ul>
      )}

      {anchors.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Your places">
          {anchors.map((a) => (
            <li
              key={a.name}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-medium text-muted"
            >
              <button type="button" aria-pressed={a.priority === "must"} aria-label={`Must-see: ${a.name}`} onClick={() => toggleMust(a.name)}>
                {a.priority === "must" ? "★" : "☆"}
              </button>
              <span>{a.name}</span>
              {a.lat === null && <span className="text-xs">· couldn&apos;t place it, type it or skip</span>}
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => remove(a.name)} className="rounded-full p-0.5 hover:bg-white/15">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
