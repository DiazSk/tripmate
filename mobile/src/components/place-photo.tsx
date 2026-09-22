import { Image } from 'expo-image';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { usePlacePhoto } from '@/api/placePhotos';
import { Colors, Radius } from '@/constants/theme';

type Props = {
  /** The place to look up. Also the recycling key — see `recyclingKey` below. */
  name: string;
  /** Aspect ratio of the box, e.g. `4 / 5` for a memory tile, `16 / 10` for a card. */
  aspectRatio?: number;
  radius?: number;
  /**
   * Darkens the photograph so type can sit on it. The Photograph-Is-Not-A-Surface rule: measured
   * across eight cities, destination photography ranges to 0.947 mean luminance, where white body
   * text is 2.41:1 under a 60% scrim. Only large type and tracked caps belong above this.
   */
  scrim?: number | false;
  /** Drawn over the photograph — a dateline, a badge. Positioned by the caller. */
  children?: React.ReactNode;
  style?: ViewStyle;
};

/**
 * A place's photograph, with the slate standing in until (or instead of) one arriving.
 *
 * **The ground sizes the box and the picture paints into it**, rather than the image being a
 * sibling that grows the layout when it loads. A place with no photograph is a finished state,
 * not an error or a spinner: the slate panel simply stands, so a missing photo never reads as
 * breakage.
 *
 * The empty state deliberately draws no name. Every caller already labels the photograph beside
 * or over it — a tile's caption, a card's overlay, the nav title on a day masthead — so printing
 * it inside the box too just says the place twice.
 */
export function PlacePhoto({
  name,
  aspectRatio = 4 / 5,
  radius = Radius.read,
  scrim = false,
  children,
  style,
}: Props) {
  const photo = usePlacePhoto(name);
  const url = photo?.imageUrl ?? photo?.thumbnailUrl ?? undefined;

  return (
    <View style={[styles.ground, { aspectRatio, borderRadius: radius }, style]}>
      {url ? (
        <Image
          source={{ uri: url }}
          alt={`Photograph of ${name}`}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={350}
          cachePolicy="memory-disk"
          // Required. FlatList recycles row views, and without a key tied to the content the
          // recycled cell keeps painting the previous city until the new image decodes.
          recyclingKey={name}
          accessibilityIgnoresInvertColors
        />
      ) : null}

      {url && scrim !== false ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${scrim})` }]} />
      ) : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  ground: {
    backgroundColor: Colors.surfaceDeep,
    overflow: 'hidden',
  },
});
