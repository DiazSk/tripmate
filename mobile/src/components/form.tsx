// Renamed off the package's own exported name, which ESLint reads as a shadowing mistake.
import NativeDatePicker from '@expo/ui/community/datetime-picker';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  useWindowDimensions,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

/**
 * The app's first input controls. Built from Kiln tokens rather than pulled in, because the
 * whole set needed here is four components and a form library would be a dependency carrying
 * validation, schemas and a re-render model none of this needs.
 */

/**
 * A group of fields sharing one surface, separated by hairlines rather than boxed individually.
 * The system draws rules; it does not put a card around every question.
 */
export function FieldTrough({ children }: { children: React.ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <View style={styles.trough}>
      {rows.map((row, i) => (
        <View key={i} style={i > 0 ? styles.ruled : undefined}>
          {row}
        </View>
      ))}
    </View>
  );
}

/**
 * Where a label and its value stop sharing a line.
 *
 * Not a taste call, and the number is not a guess. The binding constraint is the date chip, the
 * one control here that keeps growing after everything else has stopped: `maxFontSizeMultiplier`
 * caps every `ThemedText` at 1.6x but reaches nothing inside a native view. Measured, the chip is
 * 125pt wide at scale 1 and 357pt at 3.1 — at the top end it is wider than the whole 334pt row
 * and draws straight over its own label.
 *
 * 1.2 is where it outgrows the fixed box that keeps it aligned at ordinary sizes: 148pt of the
 * 150pt it is given. Above that the row stacks and the chip takes a full line, so there is no
 * scale at which it is clipped. Deliberately a threshold rather than a formula scaling the box
 * with the text — a fitted growth curve would be one more thing measured on one device in one
 * locale, and when it was wrong it would fail the silent way, by shearing the year off again.
 *
 * The platform agrees: an iOS Form row stacks at large text rather than letting the two fight.
 */
const STACK_ABOVE_SCALE = 1.2;

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  // `fontScale` here rather than `PixelRatio.getFontScale()`: this one re-renders when the
  // reader changes the setting, instead of holding whatever it was at mount.
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > STACK_ABOVE_SCALE;
  return (
    <View style={[styles.row, stacked && styles.rowStacked]}>
      <ThemedText type="label" themeColor="muted" style={styles.rowLabel}>
        {label}
      </ThemedText>
      <View style={[styles.rowControl, stacked && styles.rowControlStacked]}>{children}</View>
    </View>
  );
}

export function TextField({
  label,
  prefix,
  ...input
}: TextInputProps & { label: string; prefix?: string }) {
  return (
    <FieldRow label={label}>
      <View style={styles.textWrap}>
        {prefix ? (
          <ThemedText type="bodyLarge" themeColor="muted">
            {prefix}
          </ThemedText>
        ) : null}
        <TextInput
          // The cap `ThemedText` gives every other string, which a bare TextInput does not
          // inherit. Without it the value grew to ~3x while its label stopped at 1.6x, and the
          // value simply took the label's half of the row.
          maxFontSizeMultiplier={1.6}
          placeholderTextColor={Colors.muted}
          selectionColor={Colors.accent}
          {...input}
          style={[styles.input, input.style]}
        />
      </View>
    </FieldRow>
  );
}

/**
 * A date, drawn by the platform.
 *
 * `@expo/ui/community/datetime-picker` is API-compatible with the community package rather than
 * dependent on it: SwiftUI on iOS, Jetpack Compose on Android, and it runs inside Expo Go, so it
 * costs neither a new dependency nor a development build. Two of these rather than a range
 * picker — the cross-platform wrapper is single-date only, and the range pickers exist solely as
 * platform-specific modules with different APIs.
 */
export function DateField({
  label,
  value,
  minimumDate,
  onChange,
}: {
  label: string;
  /** `YYYY-MM-DD`, or empty for unset. */
  value: string;
  minimumDate?: string;
  onChange: (iso: string) => void;
}) {
  // `maxFontSizeMultiplier` is a React Native Text prop and reaches nothing inside a SwiftUI or
  // Compose view, so this chip keeps growing after every label around it has stopped at 1.6x.
  // Measured: 125pt wide at scale 1, 357pt at 3.1. Past the stacking threshold it therefore gets
  // its own line and the trough's full width, where alignment with the text column is moot and
  // the only thing that matters is that the year still fits.
  const { fontScale } = useWindowDimensions();
  const wide = fontScale > STACK_ABOVE_SCALE;

  return (
    <FieldRow label={label}>
      <View style={[styles.dateWrap, wide && styles.dateWrapWide]}>
        {/* An explicit size, because a native view does not report a usable intrinsic one to
            yoga: left to size itself the chip overflows the row and the trough's `overflow:
            hidden` shears its right edge off mid-year. */}
        <NativeDatePicker
          style={wide ? [styles.datePickerWide, { height: Math.round(36 * fontScale) }] : styles.datePicker}
          value={toDate(value)}
          minimumDate={minimumDate ? toDate(minimumDate) : undefined}
          mode="date"
          accentColor={Colors.accent}
          themeVariant="dark"
          onChange={(event, date) =>
            onChange(toIso(date ?? new Date(event.nativeEvent.timestamp)))
          }
        />
      </View>
    </FieldRow>
  );
}

/**
 * Today, when nothing is set yet — a date field with no date has nowhere to open.
 *
 * Built at **local** midday, to pair with `toIso`'s local accessors. Mixing the two (building in
 * UTC, reading locally) silently shifts the day by one at large offsets: UTC midday is already
 * tomorrow in UTC+13. Midday rather than midnight so no offset can cross a date boundary.
 */
function toDate(iso: string): Date {
  const parts = iso.split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts.map(Number);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      return new Date(y, m - 1, d, 12);
    }
  }
  return new Date();
}

/**
 * Back to `YYYY-MM-DD`, read with **local** accessors.
 *
 * The picker reports the instant the traveller pointed at in their own timezone, so local getters
 * are the ones that name the day they chose. Reading it with UTC getters instead is what would
 * roll the date — the mirror of the bug the rest of this codebase guards against when going the
 * other way. `toDate` builds at midday for the same reason: neither direction can then cross a
 * date boundary on a timezone offset.
 */
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The primary action. Jade, which the One Meaning Rule reserves for exactly this and which
 * nothing in the app has legitimately needed until now — with dark ink on it, because
 * `accentForeground` means "text on jade" and is not interchangeable with the paper foreground.
 */
export function PrimaryButton({
  title,
  onPress,
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const inert = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inert }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        inert && styles.buttonInert,
        pressed && !inert && Platform.OS === 'ios' && styles.buttonPressed,
      ]}
      android_ripple={inert ? undefined : { color: Colors.accentForeground }}>
      {busy ? (
        <ActivityIndicator color={Colors.accentForeground} />
      ) : (
        <ThemedText type="heading" themeColor="accentForeground">
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trough: {
    backgroundColor: Colors.panel,
    borderRadius: Radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.rows,
    minHeight: 52,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
  },
  // Natural width rather than fixed: a fixed one wrapped "Infants (under 2)" mid-word. The date
  // picker no longer competes for the space — it carries an explicit size of its own.
  rowLabel: { flexShrink: 1 },
  rowControl: { flex: 1, alignItems: 'flex-end', minWidth: 0 },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.tight },
  // `flex: 1` would stretch the control down the column instead of across it.
  rowControlStacked: { flex: 0, alignSelf: 'stretch' },
  textWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  input: {
    color: Colors.foreground,
    fontSize: 16,
    lineHeight: 20,
    paddingVertical: Spacing.tight,
    textAlign: 'right',
    minWidth: 120,
  },
  // Wide enough for the longest rendering the compact picker produces ("Sep 22, 2026") plus its
  // own chip padding; without a floor it is handed the row's leftovers and truncates.
  //
  // The negative margin is what lines the chip up with the values above and below it, and it is
  // needed because the box is deliberately bigger than its contents. The native picker centres
  // its chip in whatever frame it is given: measured, the chip is 125pt inside this 150pt box,
  // so its right edge landed 11pt inside the column every text value is flush to. Pulling the
  // box right by that slack aligns the chip without shrinking the box — which matters, because
  // the chip grows with Dynamic Type and a box sized to fit today would truncate at larger text
  // instead of merely overhanging.
  dateWrap: { alignItems: 'flex-end' },
  // Out to the trough's own edge. The row's padding leaves 334pt and the chip wants 357pt at the
  // largest size, so those 36pt are the difference between a whole date and a missing year.
  dateWrapWide: { alignSelf: 'stretch', marginHorizontal: -Spacing.read },
  datePickerWide: { width: '100%' },
  datePicker: { width: 150, height: 36, marginRight: -11 },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.pill,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.regular,
    overflow: 'hidden',
  },
  buttonInert: { opacity: 0.4 },
  buttonPressed: { opacity: 0.85 },

  question: { gap: Spacing.hair },
  caption: { marginTop: -2 },
  questionBody: { marginTop: Spacing.tight },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
  },
  choiceSelected: { backgroundColor: Colors.accentWash },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.tight },
  chip: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    backgroundColor: Colors.panel,
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.tight,
    overflow: 'hidden',
  },
  chipOn: { backgroundColor: Colors.pressed, borderColor: Colors.foreground },
  chipStarred: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.rows },
  step: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceDeep,
    overflow: 'hidden',
  },
  stepInert: { opacity: 0.35 },
  stepperValue: { minWidth: 24, textAlign: 'center' },
  toggleLabel: { flex: 1, paddingRight: Spacing.rows },
});

/** A question's heading, above a group of controls. */
export function Question({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <View style={styles.question}>
      <ThemedText type="label" themeColor="muted">
        {title}
      </ThemedText>
      {caption ? (
        <ThemedText type="detail" themeColor="muted" style={styles.caption}>
          {caption}
        </ThemedText>
      ) : null}
      <View style={styles.questionBody}>{children}</View>
    </View>
  );
}

/**
 * Single-select, stacked rather than segmented.
 *
 * These options are sentences ("Happy to walk all day"), not words — a segmented control would
 * truncate every one of them on a phone.
 */
export function ChoiceRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.trough}>
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.choice, i > 0 && styles.ruled, selected && styles.choiceSelected]}
            android_ripple={{ color: Colors.pressed }}>
            <ThemedText type="bodyLarge" themeColor={selected ? 'foreground' : 'muted'}>
              {option.label}
            </ThemedText>
            {selected ? (
              <ThemedText type="heading" themeColor="accent">
                ✓
              </ThemedText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Chips. `starred` turns the grid into the two-state one interests need — tap to select, tap a
 * selected chip again to star it, which is what actually weights the plan.
 */
export function TagGrid({
  tags,
  selected,
  starred,
  onToggle,
  onStar,
}: {
  tags: string[];
  selected: string[];
  starred?: string[];
  onToggle: (tag: string) => void;
  onStar?: (tag: string) => void;
}) {
  return (
    <View style={styles.grid}>
      {tags.map((tag) => {
        const isOn = selected.includes(tag);
        const isStar = starred?.includes(tag) ?? false;
        return (
          <Pressable
            key={tag}
            accessibilityRole="button"
            accessibilityState={{ selected: isOn }}
            accessibilityLabel={isStar ? `${tag}, starred` : tag}
            onPress={() => (isOn && onStar ? onStar(tag) : onToggle(tag))}
            onLongPress={isOn && onStar ? () => onToggle(tag) : undefined}
            style={[styles.chip, isOn && styles.chipOn, isStar && styles.chipStarred]}
            android_ripple={{ color: Colors.pressed }}>
            <ThemedText
              type="detail"
              themeColor={isStar ? 'accentForeground' : isOn ? 'foreground' : 'muted'}>
              {isStar ? `★ ${tag}` : tag}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A count, with the bounds the planning rules actually care about. */
export function CountRow({
  label,
  value,
  min = 0,
  max = 12,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <FieldRow label={label}>
      <View style={styles.stepper}>
        <Step sign="−" disabled={value <= min} onPress={() => onChange(value - 1)} label={`Fewer ${label}`} />
        <ThemedText type="moneyLarge" style={styles.stepperValue}>
          {value}
        </ThemedText>
        <Step sign="+" disabled={value >= max} onPress={() => onChange(value + 1)} label={`More ${label}`} />
      </View>
    </FieldRow>
  );
}

function Step({ sign, disabled, onPress, label }: { sign: string; disabled: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.step, disabled && styles.stepInert]}
      android_ripple={{ color: Colors.pressed, radius: 18 }}>
      <ThemedText type="heading" themeColor={disabled ? 'muted' : 'foreground'}>
        {sign}
      </ThemedText>
    </Pressable>
  );
}

/** A switch, drawn by the platform. */
export function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <ThemedText type="bodyLarge" style={styles.toggleLabel}>
        {label}
      </ThemedText>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: Colors.accent, false: Colors.surfaceDeep }}
        thumbColor={Colors.foreground}
      />
    </View>
  );
}
