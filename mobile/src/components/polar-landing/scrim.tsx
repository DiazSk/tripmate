import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/**
 * A vertical gradient over a photograph, drawn with react-native-svg.
 *
 * **Not `expo-linear-gradient`, and that is a build decision.** It is a native module this app does
 * not have, so adding it means a new development build before anyone can open the screen;
 * react-native-svg is already compiled in for the stop discs and Meri. Stops take a colour and an
 * opacity separately because `stopColor` does not reliably honour an rgba alpha on every platform.
 */
export function Scrim({ stops, style }: { stops: [offset: number, color: string, opacity: number][]; style?: StyleProp<ViewStyle> }) {
  const id = `scrim${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {stops.map(([offset, color, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
