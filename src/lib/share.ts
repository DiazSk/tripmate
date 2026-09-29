/**
 * Where a shared trip lives, said once.
 *
 * The path is duplicated the moment two places build it — the API that mints a token returns a
 * URL, the clients show and copy one, and the route that serves it has to agree with both. A
 * disagreement here is not a compile error, it is a link that 404s for the person it was sent to.
 *
 * `/s/` rather than `/shared/trip/` because this is the one URL in the app whose job is to be
 * pasted into a message, and every character of it is read aloud, retyped and wrapped by
 * somebody's chat client.
 */
export const SHARE_PATH = "/s";

/**
 * The same origin the metadata uses, and the same deliberate fallback.
 *
 * `layout.tsx` resolves `metadataBase` this way and the reasoning carries over verbatim: one
 * build serves localhost and the deploy, Open Graph needs absolute URLs, and falling back to
 * localhost is chosen because a *wrong* absolute origin in a link somebody has already sent is
 * far harder to notice than an obviously-unset one.
 */
export function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** The absolute link for a share token — what gets copied, texted and opened. */
export function shareUrl(token: string): string {
  return `${siteOrigin()}${SHARE_PATH}/${token}`;
}
