import { SymbolView as ExpoSymbolView, type AndroidSymbol, type SFSymbol, type SymbolViewProps as ExpoSymbolViewProps } from 'expo-symbols';

/**
 * Every SF Symbol the app draws, with the Material Symbol Android draws in its place.
 *
 * **A bare SF name renders nothing at all on Android, silently.** `expo-symbols` looks the
 * `android` half of the name up in the Material Symbols font; a plain string has no `android`
 * half, so Android draws the `fallback` (usually none): measured on a OnePlus 9R, Home's widget
 * icons, the Trips +, every Profile row and every chevron were empty. The object form worked where
 * it was used, and a comment asked for it, but nothing enforced it.
 *
 * Now the type does. `name` takes only a key of this table (or the object form), so an icon with
 * no Android counterpart is a compile error at the call site, not a blank square on a phone.
 * Add the pair here; `symbol.test.ts` checks every value exists in the font.
 */
export const ANDROID_SYMBOL = {
  'arrow.left.arrow.right': 'swap_horiz',
  'binoculars.fill': 'travel_explore',
  'bubble.left': 'chat_bubble',
  checkmark: 'check',
  'chevron.left': 'chevron_left',
  'chevron.right': 'chevron_right',
  'chevron.up': 'expand_less',
  'doc.text': 'description',
  ellipsis: 'more_horiz',
  'ellipsis.circle': 'more_horiz',
  envelope: 'mail',
  'exclamationmark.triangle.fill': 'warning',
  eye: 'visibility',
  'eye.slash': 'visibility_off',
  'figure.walk': 'directions_walk',
  'fork.knife': 'restaurant',
  'heart.fill': 'favorite',
  'house.fill': 'home',
  'location.north.fill': 'navigation',
  lock: 'lock',
  magnifyingglass: 'search',
  map: 'map',
  mappin: 'location_on',
  'mappin.and.ellipse': 'location_on',
  'moon.fill': 'dark_mode',
  person: 'person',
  'person.2.fill': 'group',
  'person.3.fill': 'groups',
  plus: 'add',
  sparkles: 'auto_awesome',
  'square.and.arrow.up': 'ios_share',
  star: 'star',
  'star.fill': 'star',
  'sun.max.fill': 'sunny',
  tram: 'tram',
  trash: 'delete',
  xmark: 'close',
} as const satisfies Partial<Record<SFSymbol, AndroidSymbol>>;

/** An SF Symbol this app can draw on both platforms. */
export type Glyph = keyof typeof ANDROID_SYMBOL;

export type SymbolViewProps = Omit<ExpoSymbolViewProps, 'name'> & {
  name: Glyph | { ios: SFSymbol; android: AndroidSymbol };
};

/** `expo-symbols`' `SymbolView`, taking a `Glyph` and supplying its Android half. */
export function SymbolView({ name, ...rest }: SymbolViewProps) {
  return <ExpoSymbolView name={typeof name === 'string' ? { ios: name, android: ANDROID_SYMBOL[name] } : name} {...rest} />;
}
