import NativeDatePicker, { type DateTimePickerProps } from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

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
  return Platform.OS === 'android' ? <AndroidField {...props} /> : <NativeDatePicker {...props} />;
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
});
