import Constants from 'expo-constants';
import { forwardRef, useImperativeHandle } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import RNMapView, { type MapViewProps } from 'react-native-maps';

import { Polar } from '@/constants/polar';

/**
 * Whether this build can draw a map at all.
 *
 * **On Android a map without a Google Maps key kills the app.** `react-native-maps` draws with the
 * Google Maps SDK there, and the SDK throws `IllegalStateException: API key not found` on a
 * background thread the moment a `MapView` mounts, which no JS error boundary can catch: measured
 * on a OnePlus 9R, the landing's "Open this day" and the writing screen each ended in "TripMate
 * keeps stopping". iOS draws Apple Maps and needs no key. The key is native config
 * (`android.config.googleMaps.apiKey`), so the manifest the app was built with is what says.
 */
export const MAPS_AVAILABLE =
  Platform.OS !== 'android' || Boolean(Constants.expoConfig?.android?.config?.googleMaps?.apiKey);

/**
 * The map's place on screen without the map: the same box on the night it would have drawn under,
 * and the camera calls callers make through a ref, as no-ops. Its children (markers, lines) are
 * never rendered, so no native map component is ever created. `getCamera` resolves to nothing,
 * which every caller already treats as "no camera yet".
 */
const NoMap = forwardRef<RNMapView, MapViewProps>(function NoMap({ style }, ref) {
  useImperativeHandle(
    ref,
    () =>
      ({
        animateCamera() {},
        animateToRegion() {},
        fitToCoordinates() {},
        setCamera() {},
        getCamera: async () => undefined,
      }) as unknown as RNMapView,
  );
  return <View style={[styles.noMap, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
});

/** `react-native-maps`' `MapView` where a map can be drawn, and `NoMap` where it would crash. */
const MapView = (MAPS_AVAILABLE ? RNMapView : NoMap) as unknown as typeof RNMapView;
export default MapView;
/** What a `ref` on `MapView` holds. */
export type MapViewRef = RNMapView;

const styles = StyleSheet.create({
  noMap: { backgroundColor: Polar.night },
});
