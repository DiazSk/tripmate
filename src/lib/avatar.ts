/**
 * Profile photos, the parts both clients and the server agree on. Spec:
 * `docs/superpowers/specs/2026-10-12-profile-photos-and-onboarding-design.md`.
 *
 * **No `Buffer`.** Expo imports this through `@shared/avatar` for the initials and the tint, and
 * Hermes has no Node globals; `atob` and `Uint8Array` exist in both runtimes.
 */

/** Web: fired on `window` with the new image url (or null) when the traveller changes their photo, so the navbar's avatar follows. */
export const AVATAR_EVENT = "tripmate:avatar";

export const AVATAR_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarMime = (typeof AVATAR_MIMES)[number];

/** A 256px JPEG at 0.8 is 20–40 KB; this is a ceiling for honest uploads, not a target. */
export const AVATAR_MAX_BYTES = 200 * 1024;

export type AvatarUpload = { ok: true; bytes: Uint8Array; mime: AvatarMime } | { ok: false; error: string };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The first bytes each format must start with — the stated type is a claim, these are the file. */
function matchesMagic(bytes: Uint8Array, mime: AvatarMime): boolean {
  const at = (i: number, ...want: number[]) => want.every((b, k) => bytes[i + k] === b);
  if (mime === "image/jpeg") return at(0, 0xff, 0xd8, 0xff);
  if (mime === "image/png") return at(0, 0x89, 0x50, 0x4e, 0x47);
  return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
}

export function parseAvatarUpload(body: unknown): AvatarUpload {
  const fail = (error: string): AvatarUpload => ({ ok: false, error });
  if (!body || typeof body !== "object") return fail("That photo couldn't be read. Try another.");
  const { mediaType, data } = body as Record<string, unknown>;
  if (!AVATAR_MIMES.includes(mediaType as AvatarMime)) return fail("Photos need to be JPEG, PNG or WebP.");
  if (typeof data !== "string" || data.length === 0 || data.length % 4 !== 0 || !BASE64.test(data)) {
    return fail("That photo couldn't be read. Try another.");
  }
  // Checked on the encoded length first so a huge body is refused before it is decoded.
  if (Math.floor((data.length * 3) / 4) > AVATAR_MAX_BYTES + 2) return fail("That photo is too large. Try a smaller one.");
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  if (bytes.length > AVATAR_MAX_BYTES) return fail("That photo is too large. Try a smaller one.");
  if (!matchesMagic(bytes, mediaType as AvatarMime)) return fail("That photo couldn't be read. Try another.");
  return { ok: true, bytes, mime: mediaType as AvatarMime };
}

/** Up to two initials from the name's words; "?" when there is nothing letter-like to show. */
export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const letters = words.slice(0, 2).map((w) => (w.match(/\p{L}/u) as RegExpMatchArray)[0].toUpperCase());
  return letters.join("") || "?";
}

/** Versioned by the update time, so a client may cache the bytes forever. */
export function avatarUrl(userId: string, updatedAt: string): string {
  return `/api/avatar/${encodeURIComponent(userId)}?v=${Date.parse(updatedAt)}`;
}

const TINTS = ["#4e8c99", "#a46e93", "#c4784b", "#7e9c5e", "#7b77ae"];

/** The initials disc's colour: one of the day-route colours, the same on every device. */
export function avatarTint(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}
