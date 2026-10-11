import type { ImportItem } from '@/api/types';

export type PickedImage = { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };

/**
 * What a composer's text and screenshots become as an import request: a link on its own line is a
 * link, everything else is one block of text, and screenshots go first. Moved out of
 * `plan/basics` so the plan import builds exactly the same request.
 */
export function importItemsFrom(text: string, images: PickedImage[]): ImportItem[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const urls = lines.filter((l) => /^https?:\/\/\S+$/.test(l));
  const rest = lines.filter((l) => !urls.includes(l)).join('\n');
  return [
    ...images.map((img) => ({ kind: 'image' as const, mediaType: img.mediaType, data: img.data })),
    ...urls.map((url) => ({ kind: 'url' as const, url })),
    ...(rest ? [{ kind: 'text' as const, text: rest }] : []),
  ];
}

const DAY_HEADING = /^\s*(day\s*\d+|d\d+\b|(mon|tues|wednes|thurs|fri|satur|sun)day\b)/i;

/**
 * Whether pasted text reads as a day-by-day plan: two or more lines that open like a day heading.
 * Text only — the phone can't see a screenshot's structure, so screenshots are never offered the
 * switch.
 */
export function looksLikeDayPlan(text: string): boolean {
  return text.split(/\r?\n/).filter((line) => DAY_HEADING.test(line)).length >= 2;
}
