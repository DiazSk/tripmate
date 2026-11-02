import NativeDatePicker, { type DateTimePickerProps } from '@expo/ui/community/datetime-picker';
import { DatePicker as SwiftDatePicker, Host } from '@expo/ui/swift-ui';
import { datePickerStyle, environment, opacity, tint } from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Polar } from '@/constants/polar';
import { fromUtcDay, toUtcDay } from '@/lib/utcDay';
import { Text } from '@/components/themed-text';

/**
 * The date and time picker, as a field on both platforms.
 *
 * **On Android the picker is a dialog, and mounting it opens it.** That is the picker's contract
 * (`presentation: 'dialog'`, the Android default: "opens on mount … the caller should unmount it"),
 * and every field here mounted it unconditionally the way iOS wants its inline one: measured on a
 * OnePlus 9R, the planner opened on a calendar for the Leave date nobody had tapped. So Android
 * draws the value as a pill like iOS's compact field, and mounts the dialog only while it is open:
 * a choice reports through the same `onChange` as iOS, a cancel just closes it.
 */
export function DatePicker(props: DateTimePickerProps) {
  return Platform.OS === 'android' ? <AndroidField {...props} /> : <IosField {...props} />;
}

/**
 * iOS's compact field, with **the date drawn by us** and the native picker over it, all but invisible.
 *
 * iOS's compact `DatePicker` chooses its own label, "Dec 7, 2026" or "12/7/26", and the choice is
 * not ours to make: on the planner the same two fields read spelled-out and numeric, then traded
 * places after one was changed. A fixed box, `fixedSize()`, no range and a fresh instance per value
 * were each tried and each still flipped. So the label is ours, in the format Android's pill uses,
 * and the native picker sits on top at SwiftUI opacity 0.011 to take the tap and open its calendar,
 * which iOS presents on its own and is untouched by the opacity. Times keep the native label: they
 * never flip.
 */
function IosField({ value, onChange, mode = 'date', minimumDate, maximumDate, style, accentColor, themeVariant, testID }: DateTimePickerProps) {
  const ownLabel = mode === 'date';
  const modifiers = [datePickerStyle('compact'), ...(accentColor ? [tint(accentColor)] : []), ...(themeVariant ? [environment('colorScheme', themeVariant)] : []), ...(ownLabel ? [opacity(0.011)] : [])];
  const picker = (
    <Host matchContents={{ vertical: true }} style={ownLabel ? StyleSheet.absoluteFill : style} ignoreSafeArea="all">
      <SwiftDatePicker
        selection={value}
        displayedComponents={mode === 'time' ? ['hourAndMinute'] : mode === 'datetime' ? ['date', 'hourAndMinute'] : ['date']}
        range={minimumDate || maximumDate ? { start: minimumDate, end: maximumDate } : undefined}
        onDateChange={(date) => onChange?.({ type: 'set', nativeEvent: { timestamp: date.getTime(), utcOffset: -date.getTimezoneOffset() } }, date)}
        modifiers={modifiers}
        testID={testID}
      />
    </Host>
  );
  if (!ownLabel) return picker;
  const dark = themeVariant === 'dark';
  return (
    <View style={[style, styles.iosBox]}>
      <View pointerEvents="none" style={[styles.pill, dark && styles.pillDark]}>
        <Text style={[styles.value, dark && styles.valueDark]}>{value.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
      </View>
      {picker}
    </View>
  );
}

function AndroidField({ value, mode = 'date', onChange, style, ...rest }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const shown =
    mode === 'time'
      ? value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : value.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityHint="Opens a picker" style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
        <Text style={styles.value}>{shown}</Text>
      </Pressable>
      {open ? (
        <NativeDatePicker
          {...rest}
          // Only the value: the native side already turns `minimumDate`/`maximumDate` from local time
          // into UTC days itself (`toUtcDayMillis` in DatePickerView.kt); converting them here as
          // well opened the range a day early (the 19th selectable for a trip arriving the 20th).
          value={mode === 'date' ? toUtcDay(value) : value}
          mode={mode}
          onValueChange={(event, date) => {
            setOpen(false);
            onChange?.({ type: 'set', nativeEvent: event.nativeEvent }, mode === 'date' ? fromUtcDay(date) : date);
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // iOS's compact date field: a soft grey capsule with the value in ink.
  pill: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: 'rgba(118,118,128,0.12)' },
  pressed: { opacity: 0.6 },
  value: { fontSize: 17, color: Polar.ink },
  // iOS's own dark compact field, for the fields on night ground.
  pillDark: { backgroundColor: 'rgba(118,118,128,0.24)' },
  valueDark: { color: '#FFFFFF' },
  // Where the native picker lays out its own pill: 16pt in from the box's right edge, measured.
  iosBox: { alignItems: 'flex-end', justifyContent: 'center', paddingRight: 16 },
});
