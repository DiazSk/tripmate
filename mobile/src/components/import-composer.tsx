import * as Clipboard from 'expo-clipboard';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { SymbolView } from '@/components/symbol';
import type { ImportItem } from '@/api/types';
import { PillButton } from '@/components/form';
import { ThemedText, Text, TextInput } from '@/components/themed-text';
import { SettingsColors } from '@/components/settings-list';
import { Polar } from '@/constants/polar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { hasImportContent } from '@/lib/formGap';
import { importItemsFrom, type PickedImage } from '@/lib/importItems';
import { summariseUnread } from '@/lib/unreadSummary';

/**
 * The long edge every screenshot is shrunk to before upload — the size Anthropic's vision API
 * downsamples to, so anything larger is bytes and tokens spent on detail the model discards.
 */
const LONG_EDGE = 1568;

/**
 * The import box: text, screenshots, one action, and what could not be read.
 *
 * Moved out of `plan/basics` so the plan import uses the same box rather than a second one that
 * drifts — same resize, same request shape (`importItemsFrom`), same unread summary. What the
 * action *does* is the caller's: basics finds places, `plan/own` reads a whole plan.
 */
export function ImportComposer({
  busy,
  unread,
  actionTitle,
  placeholder,
  initialText = '',
  onSubmit,
  below,
  light = false,
  docked = false,
}: {
  busy: boolean;
  unread: string[];
  actionTitle: string;
  placeholder: string;
  initialText?: string;
  /** Resolve true to clear the box: the import was taken. */
  onSubmit: (items: ImportItem[], text: string) => Promise<boolean>;
  /** Drawn under the box, above the unread lines. */
  below?: (text: string) => React.ReactNode;
  /** Drawn for the grouped light the planner uses: a white box, black ink, the action as a tinted
   *  capsule — the night's slate capsule reads as a hole in white. Behaviour is identical. */
  light?: boolean;
  /**
   * The action as the screen's full-width button at the thumb (canvas design ownplan-1B), rather
   * than a capsule in the box's footer, where it read as disabled and sat in the top half. Drawn
   * last with `marginTop: 'auto'`, so a caller whose scroll content has `flexGrow: 1` gets it at
   * the foot; the box grows to a notebook's height to meet it. Faded until there is something to
   * read, and still pressable then — it puts the cursor in the box, as the capsule did.
   */
  docked?: boolean;
}) {
  const [text, setText] = useState(initialText);
  const [images, setImages] = useState<PickedImage[]>([]);

  /**
   * Pick screenshots, and **shrink them before they are ever encoded**.
   *
   * The picker used to be asked for `base64` at full camera resolution. Base64 inflates bytes by
   * about a third, so five to seven phone photos cleared `/api/import`'s 10MB body cap and the
   * traveller got "That's a lot at once — try fewer screenshots." The `selectionLimit: 20` this
   * advertises had never actually been reachable.
   *
   * **1568px is not a guess**: it is the long edge Anthropic's vision API downsamples to, so
   * every pixel above it was bytes uploaded and tokens billed for detail the model never saw.
   * Resized and re-encoded, twenty screenshots land around 5MB — inside the cap, with the
   * extraction reading exactly what it read before.
   *
   * So the picker is no longer asked for `base64` or `quality`: it hands back the original file
   * and the manipulator does the one encode, instead of the picker building a full-resolution
   * base64 in memory for every image and this throwing most of it away.
   */
  async function pickScreenshots() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 20,
    });
    if (result.canceled) return;

    const picked = await Promise.all(
      result.assets.map(async (asset) => {
        const context = ImageManipulator.manipulate(asset.uri);
        // Resize on the longer side so the ratio is kept — passing one dimension lets the
        // manipulator work the other out. A `0` dimension means the system did not report one,
        // and `0 > LONG_EDGE` is false, so those pass through unresized rather than crash.
        if (Math.max(asset.width, asset.height) > LONG_EDGE) {
          context.resize(asset.width >= asset.height ? { width: LONG_EDGE } : { height: LONG_EDGE });
        }
        const image = await context.renderAsync();
        const saved = await image.saveAsync({
          format: SaveFormat.JPEG,
          compress: 0.6,
          base64: true,
        });
        return saved.base64 ? { mediaType: 'image/jpeg' as const, data: saved.base64 } : null;
      }),
    );
    setImages((prev) => [...prev, ...picked.filter((image) => image !== null)]);
  }

  const box = useRef<TextInput>(null);
  /** The pasted text goes after whatever is already in the box, on its own line. */
  const paste = (pasted: string) => {
    if (pasted.trim()) setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${pasted}` : pasted));
  };
  const hasContent = hasImportContent(text, images.length);

  async function submit() {
    if (!hasContent) {
      box.current?.focus();
      return;
    }
    const items = importItemsFrom(text, images);
    if (items.length === 0) return;
    if (await onSubmit(items, text)) {
      setText('');
      setImages([]);
    }
  }

  return (
    <>
      {/* **One object, not three.** The box is an input with two things that feed it and one
          action that consumes it — `Add screenshots` is a second way to put content *in*, not a
          sibling of the action. As peers below the box the two were the same capsule at the
          same width and read as twins; in the footer they are an affordance and an action. It
          also resolves a count: with the screen's primary permanently jade, a jade-filled
          action here would be the screen's second fill, which the Primary Action Surface rule
          allows one of. */}
      <View style={[styles.composer, light && styles.composerLight]}>
        <TextInput
          ref={box}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={light ? SettingsColors.faint : Colors.muted}
          selectionColor={light ? Polar.ember : Colors.accent}
          keyboardAppearance={light ? 'light' : 'dark'}
          multiline
          maxFontSizeMultiplier={1.6}
          style={[styles.composerInput, light && styles.inkLight, docked && styles.inputDocked]}
        />
        <View style={[styles.composerFooter, light && styles.footerLight]}>
          <View style={styles.feeds}>
            <Pressable
              onPress={() => void pickScreenshots()}
              accessibilityRole="button"
              accessibilityLabel={
                images.length > 0 ? `Screenshots, ${images.length} added` : 'Add screenshots'
              }
              style={styles.attach}>
              <SymbolView
                // Object form, never a bare SF string — the Android path renders nothing at all
                // given one, silently.
                name={{ ios: 'photo.on.rectangle', android: 'image' }}
                tintColor={light ? Polar.ember : images.length > 0 ? Colors.foreground : Colors.muted}
                size={16}
                fallback={
                  <ThemedText type="detail" themeColor="muted">
                    +
                  </ThemedText>
                }
              />
              <ThemedText
                type="detail"
                themeColor={images.length > 0 ? 'foreground' : 'muted'}
                style={light ? styles.attachLight : undefined}>
                {images.length > 0 ? `Screenshots (${images.length})` : 'Screenshots'}
              </ThemedText>
            </Pressable>
            {/* **Apple's own Paste control on iOS, not a button that reads the clipboard.** Reading
                it from code asks "Allow Paste?" every time; `UIPasteControl` is the system's proof
                that the person pressed it, so it never asks. Text only: screenshots come through
                the picker beside it, which shrinks them. Android has no such control and no prompt. */}
            {Clipboard.isPasteButtonAvailable ? (
              <Clipboard.ClipboardPasteButton
                onPress={(data) => data.type === 'text' && paste(data.text)}
                acceptedContentTypes={['plain-text']}
                displayMode="iconAndLabel"
                cornerStyle="capsule"
                foregroundColor={light ? Polar.ember : Colors.foreground}
                // Opaque: the control drops a colour's alpha, so the action capsule's 12% grey came
                // out a heavy grey. #EFEFF0 is that grey composited over the white box. Night
                // keeps the system's own fill.
                backgroundColor={light ? '#EFEFF0' : undefined}
                style={styles.paste}
              />
            ) : (
              <Pressable onPress={() => void Clipboard.getStringAsync().then(paste)} accessibilityRole="button" style={styles.attach}>
                <ThemedText type="detail" themeColor="muted" style={light ? styles.attachLight : undefined}>
                  Paste
                </ThemedText>
              </Pressable>
            )}
          </View>
          {/* No `disabled`: an empty box is incomplete, not unavailable. Pressing it puts the
              cursor in the box and says nothing — the gap is two centimetres away and a cursor
              arriving explains itself, where a field three rows up does not. */}
          {docked ? null : light ? (
            <Pressable onPress={() => void submit()} accessibilityRole="button" style={styles.actionLight}>
              {busy ? <ActivityIndicator color={Polar.ember} /> : <Text style={styles.actionLightText}>{actionTitle}</Text>}
            </Pressable>
          ) : (
            <PillButton compact title={actionTitle} busy={busy} onPress={() => void submit()} />
          )}
        </View>
      </View>

      {below?.(text)}

      {unread.length > 0 ? (
        <View accessibilityLiveRegion="polite" style={styles.importUnread}>
          {/* One line per *reason*, not per file — four unreadable screenshots said the same
              sentence four times. See `summariseUnread`. */}
          {summariseUnread(unread).map((reason) => (
            <ThemedText key={reason} type="detail" themeColor="muted">
              {reason}
            </ThemedText>
          ))}
        </View>
      ) : null}

      {docked ? (
        <Pressable
          onPress={() => void submit()}
          accessibilityRole="button"
          accessibilityState={{ busy }}
          accessibilityHint={hasContent ? undefined : 'Paste your plan or add screenshots first'}
          style={({ pressed }) => [styles.dockAction, !hasContent && styles.dockActionEmpty, pressed && hasContent && styles.dockActionPressed]}>
          {busy ? <ActivityIndicator color={Polar.ink} /> : <Text style={styles.dockActionText}>{actionTitle}</Text>}
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  composer: {
    backgroundColor: Colors.panel,
    borderColor: Colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.surface,
    // So the footer's rule meets the box's sides instead of floating inside its corners.
    overflow: 'hidden',
  },
  composerInput: {
    minHeight: 72,
    color: Colors.foreground,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
    textAlignVertical: 'top',
  },
  composerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // **`wrap`, because the box clips and the action is on the right.** React Native defaults
    // `flexShrink` to 0 rather than CSS's 1, so without this the row simply overflows at large
    // type — and `composer`'s `overflow: 'hidden'` cuts off whichever end runs past, which is
    // the capsule. `Screenshots (12)` beside the capsule needs roughly 400pt of a ~340pt row at
    // AX3. `form.tsx`'s `timeRow` carries the same fix with the same note.
    flexWrap: 'wrap',
    rowGap: Spacing.hair,
    minHeight: 44,
    paddingHorizontal: Spacing.tight,
    // 8, not 4: the capsule is itself 44pt inside a 44pt-minimum row, so at `hair` its bottom
    // edge all but touched the box's own border.
    paddingVertical: Spacing.tight,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.cardBorder,
  },
  // 44 is the floor, and the row is the target rather than the words in it. `flexShrink` so a
  // long count gives way to the action rather than pushing it out of the box.
  attach: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: Spacing.tight,
    minHeight: 44,
    paddingHorizontal: Spacing.tight,
  },
  feeds: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: Spacing.hair },
  // UIPasteControl draws nothing without a size; 34pt tall like the action capsule beside it.
  paste: { width: 96, height: 34 },
  importUnread: { gap: Spacing.hair },
  composerLight: { backgroundColor: '#fff', borderColor: 'transparent', borderRadius: 12 },
  inkLight: { color: '#000', fontSize: 17, lineHeight: 22 },
  footerLight: { borderTopColor: SettingsColors.separator },
  attachLight: { color: Polar.ember },
  actionLight: {
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(118,118,128,0.12)',
  },
  actionLightText: { fontSize: 15, fontWeight: '600', color: Polar.ember },
  inputDocked: { minHeight: 220 },
  // The review's "Build my trip" (`plan/own.tsx`), so the two steps end on the same button.
  dockAction: { marginTop: 'auto', paddingVertical: 6, minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.signal },
  dockActionEmpty: { opacity: 0.45 },
  dockActionPressed: { backgroundColor: Polar.signalPressed },
  dockActionText: { fontSize: 17, fontWeight: '600', color: Polar.ink },
});
