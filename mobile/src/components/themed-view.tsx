import { View, type ViewProps } from 'react-native';

import { Colors, type ThemeColor } from '@/constants/theme';

export type ThemedViewProps = ViewProps & {
  type?: ThemeColor;
};

export function ThemedView({ style, type = 'canvas', ...otherProps }: ThemedViewProps) {
  return <View style={[{ backgroundColor: Colors[type] }, style]} {...otherProps} />;
}
