import type { ImportItem } from '@/api/types';

/**
 * What a share from another app becomes, before anything is read off disk.
 *
 * Instagram URLs cannot be read by any app (Meta's oEmbed carries no caption and its terms forbid
 * non-display use), so they become reminders rather than import items — see the share spec.
 * Videos become frame times: the frames are pulled on the phone and read like screenshots.
 * ponytail: fixed frame times, not scene detection — upgrade if reels with late text get missed.
 */
export const FRAME_TIMES_S = [1, 3, 6, 10, 15, 20];
export const MAX_MEDIA = 20;

export interface SharePayload {
  text?: string | null;
  webUrl?: string | null;
  files?: { path: string; mimeType: string; duration?: number | null }[] | null;
}

const URL_RE = /https?:\/\/\S+/g;
const isInstagram = (u: string) => {
  try {
    const h = new URL(u).hostname.replace(/^www\./, '');
    return h === 'instagram.com' || h.endsWith('.instagram.com');
  } catch {
    return false;
  }
};

export function planShare(p: SharePayload) {
  const urls = [...(p.webUrl ? [p.webUrl] : []), ...((p.text ?? '').match(URL_RE) ?? [])];
  const rest = (p.text ?? '').replace(URL_RE, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const unique = [...new Set(urls)];
  const instagramUrls = unique.filter(isInstagram);
  const linkItems: ImportItem[] = [
    ...unique.filter((u) => !isInstagram(u)).map((url) => ({ kind: 'url' as const, url })),
    ...(rest ? [{ kind: 'text' as const, text: rest }] : []),
  ];

  let budget = MAX_MEDIA;
  let truncated = false;
  const imagePaths: string[] = [];
  const videoFrames: { path: string; times: number[] }[] = [];
  for (const f of p.files ?? []) {
    if (f.mimeType.startsWith('image/')) {
      if (budget > 0) {
        imagePaths.push(f.path);
        budget--;
      } else truncated = true;
    } else if (f.mimeType.startsWith('video/')) {
      const all = f.duration ? FRAME_TIMES_S.filter((t) => t * 1000 < (f.duration as number)) : FRAME_TIMES_S;
      const times = all.slice(0, Math.min(6, budget));
      if (times.length < all.length) truncated = true;
      if (times.length) videoFrames.push({ path: f.path, times });
      budget -= times.length;
    }
  }
  return { linkItems, imagePaths, videoFrames, instagramUrls, truncated };
}
