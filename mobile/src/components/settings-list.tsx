import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { SymbolView, type SymbolViewProps } from '@/components/symbol';
import { Polar } from '@/constants/polar';

/**
 * iOS Settings, as React Native: inset grouped lists for the Profile tab (canvas design "Phone
 * profile · 4 Settings with a passport"). Groups at 12pt corners on the system's grouped grey,
 * rows with a 29pt tinted SF Symbol square, 13pt grey headers and footers.
 *
 * **A single answer is a native menu, not a sheet.** `ChoiceRow` puts SwiftUI's `Picker` in menu
 * style in the row's value, so a tap opens the system's pull-down with a check against the answer
 * where the value is. Its `Host` is pinned to the light scheme: the app runs in dark appearance,
 * and this page is light. Android has no SwiftUI, so there the value opens a plain list instead.
 *
 * **The value is grey, with the menu's up-down chevron, as in iOS Settings.** It was ember, which
 * made a value look like the actions and links that colour means everywhere else (DESIGN.md's One
 * Meaning Rule). The menu style draws its own chevron in the picker's tint.
 */

export const SettingsColors = {
  ground: '#F2F2F7',
  /** Secondary text on this light ground — the one token, see `Polar.secondary`. */
  grey: Polar.secondary,
  faint: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.22)',
  pressed: '#E5E5EA',
  destructive: '#FF3B30',
} as const;

type SymbolName = SymbolViewProps['name'];

export function Group({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

export function Header({ children }: { children: string }) {
  return (
    <Text style={styles.header} accessibilityRole="header">
      {children.toUpperCase()}
    </Text>
  );
}

export function Footer({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return <Text style={[styles.footer, center && styles.center]}>{children}</Text>;
}

/** A row's leading icon: an SF Symbol, white, in a tinted rounded square. */
export function RowIcon({ name, tint: color }: { name: SymbolName; tint: string }) {
  return (
    <View style={[styles.icon, { backgroundColor: color }]}>
      <SymbolView name={name} size={16} tintColor="#fff" weight="semibold" />
    </View>
  );
}

/** The 0.5pt line between rows, inset to the text when the row has an icon. */
export function Separator({ inset = 57 }: { inset?: number }) {
  return <View style={[styles.separator, { marginLeft: inset }]} />;
}

/** A row that pushes a screen: icon, label, the current value, a chevron. */
export function NavRow({ icon, tint: color, label, value, onPress }: { icon: SymbolName; tint: string; label: string; value?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <RowIcon name={icon} tint={color} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <SymbolView name="chevron.right" size={13} tintColor={SettingsColors.faint} weight="semibold" />
    </Pressable>
  );
}

/** One answer from a short list, chosen from a native pull-down in the row's value. */
export function ChoiceRow<T extends string>({
  icon,
  tint: color,
  label,
  value,
  options,
  onChange,
}: {
  /** Optional: the planner's rows carry no icon. */
  icon?: SymbolName;
  tint?: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.row}>
      {icon && color ? <RowIcon name={icon} tint={color} /> : null}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {Platform.OS === 'ios' ? (
        <Host matchContents colorScheme="light">
          <Picker selection={value} onSelectionChange={(v) => { void Haptics.selectionAsync(); onChange(v as T); }} label={label} modifiers={[pickerStyle('menu'), tint(SettingsColors.grey)]}>
            {options.map((o) => (
              <SwiftText key={o.value} modifiers={[tag(o.value)]}>
                {o.label}
              </SwiftText>
            ))}
          </Picker>
        </Host>
      ) : (
        <ListPicker label={label} value={value} options={options} onChange={onChange} />
      )}
    </View>
  );
}

/** Android's stand-in for the menu: the value, and a plain list in a modal when it is pressed. */
function ListPicker<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}, ${current}`} hitSlop={8} style={styles.choiceRow}>
        <Text style={styles.choice}>{current}</Text>
        <SymbolView name={{ ios: 'chevron.up.chevron.down', android: 'unfold_more' }} size={13} tintColor={SettingsColors.grey} weight="semibold" />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* The backdrop is the sheet's sibling, not its parent: a pressable parent is one element to
            a screen reader, and it swallowed the options inside it. */}
        <View style={styles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label}</Text>
            {options.map((o) => (
              <Pressable
                key={o.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: o.value === value }}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}>
                <Text style={styles.sheetText}>{o.label}</Text>
                {o.value === value ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

/** A row in a pushed checklist: a check on the left when it is on, anything trailing on the right. */
export function CheckRow({ label, on, onPress, trailing }: { label: string; on: boolean; onPress: () => void; trailing?: ReactNode }) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={styles.checkMain}>
        <View style={styles.tick}>{on ? <SymbolView name="checkmark" size={16} tintColor={Polar.ember} weight="semibold" /> : null}</View>
        <Text style={styles.label}>{label}</Text>
      </Pressable>
      {trailing}
    </View>
  );
}

/** A plain row: a label and a value, nothing to press. */
export function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    // One element to VoiceOver and TalkBack, so the label and its value are read together.
    <View style={styles.row} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, styles.valueWide]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** A centred red action: Sign Out. */
export function DestructiveRow({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, styles.centerRow, pressed && styles.pressed]}>
      <Text style={styles.destructive}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { marginHorizontal: 16, marginBottom: 22, overflow: 'hidden', borderRadius: 12, backgroundColor: '#fff' },
  header: { marginHorizontal: 32, marginBottom: 7, fontSize: 13, color: SettingsColors.grey },
  footer: { marginHorizontal: 32, marginTop: -15, marginBottom: 22, fontSize: 13, lineHeight: 18, color: SettingsColors.grey },
  center: { textAlign: 'center', marginTop: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingLeft: 16, paddingRight: 14, backgroundColor: '#fff' },
  centerRow: { justifyContent: 'center' },
  pressed: { backgroundColor: SettingsColors.pressed },
  icon: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: SettingsColors.separator },
  label: { flex: 1, fontSize: 17, color: '#000' },
  value: { maxWidth: '55%', fontSize: 17, color: SettingsColors.grey },
  valueWide: { maxWidth: '68%' },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  choice: { fontSize: 17, color: SettingsColors.grey },
  check: { fontSize: 17, color: Polar.ember },
  checkMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  tick: { width: 22, alignItems: 'center' },
  destructive: { fontSize: 17, color: SettingsColors.destructive },
  scrim: { flex: 1, justifyContent: 'center', padding: 32, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { overflow: 'hidden', borderRadius: 14, backgroundColor: '#fff' },
  sheetTitle: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, fontSize: 13, color: SettingsColors.grey },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 16 },
  sheetText: { fontSize: 17, color: '#000' },
});
