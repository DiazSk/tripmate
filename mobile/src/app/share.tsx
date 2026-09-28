import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { readAsStringAsync } from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { importPlaces, saveSavedPlaces } from '@/api/tripMateApi';
import type { ImportItem, ImportResult, SavedSource } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { planShare } from '@/lib/shareItems';

type State =
  | { kind: 'reading' }
  | { kind: 'done'; names: string[]; reminders: number; truncated: boolean; unread: string[] }
  | { kind: 'importFailed' }
  | { kind: 'saveFailed'; names: string[] };

const INSTAGRAM_NOTE = "Instagram doesn't let apps read posts. Share a screenshot or the downloaded reel instead.";

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

export default function ShareScreen() {
  const { shareIntent, hasShareIntent, resetShareIntent } = useShareIntentContext();
  const [state, setState] = useState<State>({ kind: 'reading' });
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
    setState({ kind: 'reading' });
    for (const url of meta.instagramUrls) await saveSavedPlaces({ places: [], source: 'instagram', url });
    if (items.length === 0) {
      setState({ kind: 'done', names: [], reminders: meta.instagramUrls.length, truncated: meta.truncated, unread: [] });
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
      ? { kind: 'done', names, reminders: meta.instagramUrls.length, truncated: meta.truncated, unread: result.unread.map((u) => u.reason) }
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
    // The guard is the house idiom (`signin.tsx`, `plan/_layout.tsx`) and keeps this correct if the
    // anchor ever goes away.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {state.kind === 'reading' && <ThemedText>Reading what you shared…</ThemedText>}
        {state.kind === 'done' && (
          <>
            {state.names.length > 0 && (
              <ThemedText type="heading">
                Found {state.names.length} {state.names.length === 1 ? 'place' : 'places'}: {state.names.join(', ')}. Saved for your next trip.
              </ThemedText>
            )}
            {state.names.length === 0 && meta.hasVideo && <ThemedText>Couldn&apos;t find places in this video.</ThemedText>}
            {state.reminders > 0 && <ThemedText>{INSTAGRAM_NOTE}</ThemedText>}
            {state.truncated && <ThemedText themeColor="muted">Used the first 20</ThemedText>}
            {state.unread.map((u, i) => (
              <ThemedText key={i} themeColor="muted">{u}</ThemedText>
            ))}
          </>
        )}
        {state.kind === 'importFailed' && <ThemedText>Couldn&apos;t read these right now.</ThemedText>}
        {state.kind === 'saveFailed' && (
          <>
            <ThemedText>Found: {state.names.join(', ')}</ThemedText>
            <ThemedText>Couldn&apos;t save them. Try again.</ThemedText>
          </>
        )}
        {(state.kind === 'importFailed' || state.kind === 'saveFailed') && (
          <Pressable accessibilityRole="button" onPress={run} style={styles.button}>
            <ThemedText type="label" themeColor="accentForeground">Retry</ThemedText>
          </Pressable>
        )}
        {state.kind !== 'reading' && (
          <Pressable accessibilityRole="button" onPress={close} style={[styles.button, styles.buttonSecondary]}>
            <ThemedText type="label">Done</ThemedText>
          </Pressable>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.read, paddingTop: 80, gap: Spacing.read },
  button: {
    minHeight: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.rows,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  buttonSecondary: { backgroundColor: Colors.control },
});
