import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { readAsStringAsync } from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { importPlaces, saveSavedPlaces } from '@/api/tripMateApi';
import type { ImportItem, ImportResult, SavedSource } from '@/api/types';
import { ShareSheet, type SharedThing, type ShareState } from '@/components/share-sheet';
import { planShare } from '@/lib/shareItems';

/** One source label for the whole share — the inbox groups by city, not by item. */
function sourceOf(items: ImportItem[], hasVideo: boolean): SavedSource {
  if (hasVideo) return 'video';
  if (items.some((i) => i.kind === 'image')) return 'screenshot';
  const url = items.find((i) => i.kind === 'url');
  if (url && url.kind === 'url') {
    if (/tiktok\.com/.test(url.url)) return 'tiktok';
    if (/youtu\.?be/.test(url.url)) return 'youtube';
    if (/google\.[^/]+\/maps|maps\.app\.goo\.gl/.test(url.url)) return 'gmaps';
    return 'url';
  }
  return 'text';
}

/** What came in, said the way a person would, for the sheet's header. */
function describe(items: ImportItem[], meta: { hasVideo: boolean; instagramUrls: string[] }): SharedThing {
  const images = items.filter((i) => i.kind === 'image').length;
  const source = sourceOf(items, meta.hasVideo);
  if (meta.hasVideo) return { label: 'A video', icon: { ios: 'play.rectangle', android: 'smart_display' } };
  if (images) return { label: images === 1 ? 'A screenshot' : `${images} screenshots`, icon: { ios: 'photo.on.rectangle', android: 'image' } };
  if (source === 'tiktok') return { label: 'A TikTok', icon: { ios: 'play.rectangle', android: 'smart_display' } };
  if (source === 'youtube') return { label: 'A YouTube video', icon: { ios: 'play.rectangle', android: 'smart_display' } };
  if (source === 'gmaps') return { label: 'A Maps link', icon: { ios: 'map', android: 'map' } };
  if (source === 'url') return { label: 'A link', icon: { ios: 'link', android: 'link' } };
  if (source === 'text' && items.length) return { label: 'A note', icon: { ios: 'text.alignleft', android: 'notes' } };
  if (meta.instagramUrls.length) return { label: 'An Instagram post', icon: { ios: 'camera', android: 'photo_camera' } };
  return { label: 'Something shared', icon: { ios: 'square.and.arrow.down', android: 'download' } };
}

/**
 * Share to TripMate: something shared in from another app is read for the places in it, and they
 * are saved for the next trip under the city they are in. This reads and saves; `ShareSheet` draws
 * it (the canvas design "Phone share in · 1 A sheet that saves"), presented as a form sheet by the
 * root layout.
 */
export default function ShareScreen() {
  const { shareIntent, hasShareIntent, resetShareIntent } = useShareIntentContext();
  const [state, setState] = useState<ShareState>({ kind: 'reading', found: [] });
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [meta, setMeta] = useState({ hasVideo: false, truncated: false, instagramUrls: [] as string[] });
  const lastResult = useRef<ImportResult | null>(null);

  // Build the import items once per share. Images and video frames are both read here.
  useEffect(() => {
    if (!hasShareIntent) return;
    const plan = planShare({ text: shareIntent.text, webUrl: shareIntent.webUrl, files: shareIntent.files });
    (async () => {
      const images: ImportItem[] = [];
      for (const path of plan.imagePaths) {
        try {
          images.push({ kind: 'image', mediaType: 'image/jpeg', data: await readAsStringAsync(path, { encoding: 'base64' }) });
        } catch {
          // An unreadable file is skipped; the result line says how many places were found.
        }
      }
      for (const v of plan.videoFrames) {
        for (const t of v.times) {
          try {
            const { uri } = await VideoThumbnails.getThumbnailAsync(v.path, { time: t * 1000, quality: 0.5 });
            images.push({ kind: 'image', mediaType: 'image/jpeg', data: await readAsStringAsync(uri, { encoding: 'base64' }) });
          } catch {
            // Past the end of an unknown-duration video, or an unreadable frame — skipped.
          }
        }
      }
      setMeta({ hasVideo: plan.videoFrames.length > 0, truncated: plan.truncated, instagramUrls: plan.instagramUrls });
      setItems([...plan.linkItems, ...images]);
    })();
  }, [hasShareIntent, shareIntent]);

  const run = useCallback(async () => {
    if (!items) return;
    setState({ kind: 'reading', found: [] });
    for (const url of meta.instagramUrls) await saveSavedPlaces({ places: [], source: 'instagram', url });
    if (items.length === 0) {
      setState({ kind: 'done', names: [], city: null, reminders: meta.instagramUrls.length, truncated: meta.truncated, unread: [] });
      return;
    }
    const result = lastResult.current ?? (await importPlaces(items));
    if (result === undefined || typeof result === 'string') {
      setState({ kind: 'importFailed' });
      return;
    }
    lastResult.current = result;
    const names = result.places.map((p) => p.name);
    const ok = await saveSavedPlaces({
      places: result.places.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
      city: result.destinationGuess,
      source: sourceOf(items, meta.hasVideo),
    });
    setState(ok
      ? { kind: 'done', names, city: result.destinationGuess?.split(',')[0].trim() || null, reminders: meta.instagramUrls.length, truncated: meta.truncated, unread: result.unread.map((u) => u.reason) }
      : { kind: 'saveFailed', names });
  }, [items, meta]);

  useEffect(() => {
    // Kicks off the import the moment the items are built; run() itself is what sets state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (items) run();
  }, [items, run]);

  const close = () => {
    resetShareIntent();
    // `back()` now that the root layout anchors `(tabs)` — a cold-start share resolves to
    // `[(tabs), share]`, so replacing with `/` would push a second `(tabs)` entry onto a stack that
    // already had one underneath. `back()` is also simply the right verb for dismissing a modal.
    // The guard is the house idiom (`signin/index.tsx`, `plan/_layout.tsx`) and keeps this correct if
    // anchor ever goes away.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <ShareSheet
      shared={describe(items ?? [], meta)}
      state={state}
      onRetry={run}
      onDone={close}
      onPlan={(city) => {
        resetShareIntent();
        // The planner opens on the city; the places just saved are waiting on its Saved places sheet.
        router.replace({ pathname: '/plan/basics', params: { destination: city } });
      }}
    />
  );
}
