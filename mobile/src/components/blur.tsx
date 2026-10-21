import { BlurView as ExpoBlurView, type BlurViewProps } from 'expo-blur';
import { Platform, View } from 'react-native';

/**
 * `expo-blur`'s `BlurView` on iOS; on Android, the same material as a near-opaque fill.
 *
 * **Android has no blur here.** Without `experimentalBlurMethod`, which is documented as
 * experimental, `expo-blur` draws a lightly tinted see-through view on Android, so whatever scrolls
 * under the chrome shows straight through it: measured on a OnePlus 9R, the stop names read through
 * the trip toolbar's Map and Ask. A blur's job under chrome is to keep the words on top legible, and
 * without the blur only opacity does that, so Android gets the material's colour at 94%.
 */
export function BlurView({ tint, intensity, style, children, ...rest }: BlurViewProps) {
  if (Platform.OS !== 'android') {
    return (
      <ExpoBlurView tint={tint} intensity={intensity} style={style} {...rest}>
        {children}
      </ExpoBlurView>
    );
  }
  const light = tint === 'light' || tint === 'extraLight' || (typeof tint === 'string' && tint.endsWith('Light'));
  return (
    <View style={[{ backgroundColor: light ? 'rgba(249,249,250,0.94)' : 'rgba(22,24,30,0.94)' }, style]} {...rest}>
      {children}
    </View>
  );
}
