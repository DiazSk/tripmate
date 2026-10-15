import NativeDatePicker from '@expo/ui/community/datetime-picker';
import { SymbolView } from 'expo-symbols';
import { Stack, useRouter } from 'expo-router';
import { Children, Fragment, type ReactNode, type Ref } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Header, Separator, SettingsColors } from '@/components/settings-list';
import { nowTime, toClock, toDate, toIso, toTimeDate } from '@/components/form';
import { Polar } from '@/constants/polar';

/**
 * The planner's rows, drawn the way an iOS form draws them: white rows in a rounded group on the
 * system's grouped ground, a hairline between rows inset to the text, and every control the
 * platform's own — the compact date picker, a switch, a stepper.
 *
 * **A second set of fields, and the reason is the palette, not taste.** `form.tsx`'s fields are
 * drawn in `Colors`, the night, chosen once at module load; on this paper their ink is the page.
 * The planner moved to the grouped light that Profile already uses (`settings-list.tsx`), so its
 * rows come from that file's colours, and the date converters are imported from `form.tsx` rather
 * than copied — there is one idea of what `YYYY-MM-DD` means.
 */

/** A section: an optional header, the rows in one group with hairlines between, a footer. */
export function Section({ header, footer, children }: { header?: string; footer?: ReactNode; children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.section}>
      {header ? <Header>{header}</Header> : null}
      <View style={styles.group}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <Separator inset={16} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {/* Its own spacing, not settings-list's `Footer`: that one pulls up under a group with a
          bottom margin of its own, which these groups do not have. */}
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

export function TextRow({
  label,
  prefix,
  ref,
  ...input
}: TextInputProps & { label: string; prefix?: string; ref?: Ref<TextInput> }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {/* The prefix rides with the value at the trailing edge, so "$" sits beside the amount. */}
      <View style={styles.valueWrap}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={SettingsColors.faint}
          selectionColor={Polar.ember}
          maxFontSizeMultiplier={1.6}
          {...input}
          style={[styles.input, prefix ? styles.inputPrefixed : null, input.style]}
        />
      </View>
    </View>
  );
}

/** A date, by the platform's compact picker: the date in a tinted capsule that opens a calendar. */
export function DateRow({
  label,
  value,
  minimumDate,
  onChange,
}: {
  label: string;
  value: string;
  minimumDate?: string;
  onChange: (iso: string) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {/* In a right-aligned box with an explicit size, as `DateField` does: the native view reports
          no usable intrinsic width, and laid out without the box it picks the short numeric
          format on some passes and the spelled-out one on others. */}
      <View style={styles.dateWrap}>
        <NativeDatePicker
          style={styles.datePicker}
          value={toDate(value)}
          minimumDate={minimumDate ? toDate(minimumDate) : undefined}
          mode="date"
          accentColor={Polar.ember}
          themeVariant="light"
          onChange={(event, date) => onChange(toIso(date ?? new Date(event.nativeEvent.timestamp)))}
        />
      </View>
    </View>
  );
}

/**
 * A clock time. **Empty stays empty**, the rule `TimeField` records: a picker always draws *some*
 * time, so an unanswered arrival would read as midnight. Until tapped it is the placeholder, and
 * once set it carries a Clear back to unanswered.
 */
export function TimeRow({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (time: string) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {value ? (
        <>
          <Pressable onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel={`Clear ${label.toLowerCase()} time`} hitSlop={8}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
          <NativeDatePicker
            style={styles.timePicker}
            value={toTimeDate(value)}
            mode="time"
            accentColor={Polar.ember}
            themeVariant="light"
            onChange={(event, date) => onChange(toClock(date ?? new Date(event.nativeEvent.timestamp)))}
          />
        </>
      ) : (
        <Pressable onPress={() => onChange(nowTime())} accessibilityRole="button" accessibilityLabel={`Set ${label.toLowerCase()} time`} hitSlop={8}>
          <Text style={styles.placeholder}>{placeholder}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** A count, with the system's − | + stepper. */
export function StepperRow({
  label,
  caption,
  value,
  min = 0,
  max = 12,
  onChange,
}: {
  label: string;
  caption?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.grow}>
        <Text style={styles.label}>{label}</Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
      <Text style={styles.count} accessibilityLiveRegion="polite">
        {value}
      </Text>
      <View style={styles.stepper}>
        <Step sign="minus" label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onPress={() => onChange(value - 1)} />
        <View style={styles.stepRule} />
        <Step sign="plus" label={`More ${label.toLowerCase()}`} disabled={value >= max} onPress={() => onChange(value + 1)} />
      </View>
    </View>
  );
}

function Step({ sign, label, disabled, onPress }: { sign: 'minus' | 'plus'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} style={styles.step}>
      <SymbolView name={{ ios: sign, android: sign === 'plus' ? 'add' : 'remove' }} size={15} weight="semibold" tintColor={disabled ? SettingsColors.faint : '#000'} />
    </Pressable>
  );
}

export function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

/** Two short answers side by side — Total or Per person. */
export function SegmentRow<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={[styles.row, styles.segRow]}>
      <View style={styles.seg} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.segHalf, on && styles.segOn]}>
              <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Tags to pick, in a padded row of the group. Starring is the interests' second tap: picked, then
 * starred (counts most), then cleared — the rule is `cycleInterest`'s; this only draws it.
 */
export function ChipsRow({ tags, selected, starred, onPress }: { tags: string[]; selected: string[]; starred?: string[]; onPress: (tag: string) => void }) {
  return (
    <View style={styles.chipsRow}>
      {tags.map((tag) => {
        const on = selected.includes(tag);
        const star = starred?.includes(tag) ?? false;
        return (
          <Pressable
            key={tag}
            onPress={() => onPress(tag)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${tag}${star ? ', starred' : on ? ', picked' : ''}`}
            style={[styles.chip, on && styles.chipOn, star && styles.chipStar]}>
            {star ? <SymbolView name={{ ios: 'star.fill', android: 'star' }} size={12} tintColor={Polar.ink} /> : null}
            <Text style={[styles.chipText, on && !star && styles.chipTextOn]}>{tag}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A plain row that opens something, with the answer at its trailing end. */
export function LinkRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Text style={styles.label}>{label}</Text>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <SymbolView name="chevron.right" size={13} tintColor={SettingsColors.faint} weight="semibold" />
    </Pressable>
  );
}

/**
 * One of the planner's half sheets: a native form sheet (its detents are set on the route in
 * `plan/_layout.tsx`) with the question's name and Done, over the grouped ground.
 *
 * Done only closes. Every row writes the draft as it changes, the way the steps always did, so
 * there is nothing to save and nothing to lose by dragging the sheet away instead.
 */
export function SheetScreen({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
              <Text style={styles.done}>Done</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export const PlanColors = { ...SettingsColors, ink: '#000', tint: Polar.ember, signal: Polar.signal, fill: 'rgba(118,118,128,0.12)' } as const;

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: SettingsColors.ground },
  sheetContent: { paddingTop: 16, paddingBottom: 40 },
  done: { fontSize: 17, fontWeight: '600', color: Polar.ember },
  section: { marginBottom: 22 },
  footer: { marginHorizontal: 32, marginTop: 7, fontSize: 13, lineHeight: 18, color: SettingsColors.grey },
  group: { marginHorizontal: 16, overflow: 'hidden', borderRadius: 12, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#fff' },
  pressed: { backgroundColor: SettingsColors.pressed },
  grow: { flex: 1 },
  label: { fontSize: 17, color: '#000' },
  caption: { fontSize: 13, color: SettingsColors.grey },
  valueWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  prefix: { fontSize: 17, color: SettingsColors.grey },
  inputPrefixed: { flex: 0, minWidth: 64 },
  input: { flex: 1, minWidth: 0, fontSize: 17, color: '#000', textAlign: 'right', paddingVertical: 8 },
  value: { flex: 1, fontSize: 17, color: SettingsColors.grey, textAlign: 'right' },
  placeholder: { fontSize: 17, color: SettingsColors.faint },
  clear: { fontSize: 15, color: Polar.ember },
  // An explicit size: a native view reports no usable intrinsic width to yoga.
  dateWrap: { flex: 1, alignItems: 'flex-end' },
  datePicker: { width: 150, height: 36, marginRight: -6 },
  timePicker: { width: 96, height: 36, marginRight: -6 },
  count: { minWidth: 22, fontSize: 17, color: '#000', textAlign: 'center', fontVariant: ['tabular-nums'] },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 32, borderRadius: 8, backgroundColor: 'rgba(118,118,128,0.12)' },
  step: { width: 46, height: 32, alignItems: 'center', justifyContent: 'center' },
  stepRule: { width: StyleSheet.hairlineWidth, height: 18, backgroundColor: SettingsColors.separator },
  segRow: { minHeight: 44 },
  seg: { flex: 1, flexDirection: 'row', padding: 2, borderRadius: 9, backgroundColor: 'rgba(118,118,128,0.12)' },
  segHalf: { flex: 1, minHeight: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  segOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  segText: { fontSize: 14, fontWeight: '500', color: '#000' },
  segTextOn: { fontWeight: '600' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 14, backgroundColor: '#fff' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(118,118,128,0.12)' },
  chipOn: { backgroundColor: Polar.ink },
  chipStar: { backgroundColor: Polar.signal },
  chipText: { fontSize: 15, color: '#000' },
  chipTextOn: { color: '#fff' },
});
