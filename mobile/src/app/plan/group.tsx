import { Stack, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import type { GroupType } from '@/api/types';
import {
  CountRow,
  FieldTrough,
  PrimaryButton,
  Question,
  ChoiceRow,
  TextField,
} from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { usePlanDraft } from '@/lib/planDraft';

const GROUPS: { value: GroupType; label: string }[] = [
  { value: 'solo', label: 'Solo' },
  { value: 'couple', label: 'Couple' },
  { value: 'family_with_kids', label: 'Family with kids' },
  { value: 'other', label: 'Something else' },
];

export default function GroupStep() {
  const router = useRouter();
  const { draft, patch } = usePlanDraft();
  const { party, logistics } = draft;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: "Who's going" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="display" style={styles.headline}>
          {draft.destination ? `Who's going to ${draft.destination.split(',')[0]}?` : "Who's going?"}
        </ThemedText>

        <Question title="Who's travelling">
          <ChoiceRow
            options={GROUPS}
            value={draft.group}
            onChange={(group) => patch({ group })}
          />
        </Question>

        {draft.group === 'other' ? (
          <FieldTrough>
            <TextField
              label="Who"
              value={draft.groupOther}
              onChangeText={(groupOther) => patch({ groupOther })}
              placeholder="five college friends"
              autoCapitalize="none"
            />
          </FieldTrough>
        ) : null}

        {/* Age bands rather than exact ages: the bands are what map onto a planning rule —
            strollers, nap windows, what counts as a late night. */}
        <Question title="Party" caption="Children are 2–11; infants are under 2.">
          <FieldTrough>
            <CountRow
              label="Adults"
              value={party.adults}
              min={1}
              max={12}
              onChange={(adults) => patch({ party: { ...party, adults } })}
            />
            <CountRow
              label="Children"
              value={party.children}
              max={12}
              onChange={(children) => patch({ party: { ...party, children } })}
            />
            <CountRow
              label="Infants"
              value={party.infants}
              max={6}
              onChange={(infants) => patch({ party: { ...party, infants } })}
            />
          </FieldTrough>
        </Question>

        {/* The planning rules say an already-booked thing beats anything the model would
            recommend, and nothing else in the app collects one. */}
        <Question title="Already booked" caption="Optional — anything fixed already.">
          <FieldTrough>
            <TextField
              label="Staying"
              value={logistics.stayBooked ?? ''}
              onChangeText={(stayBooked) => patch({ logistics: { ...logistics, stayBooked } })}
              placeholder="Hotel name, or a neighbourhood"
            />
            <TextField
              label="Arrive"
              value={logistics.arrivalTime ?? ''}
              onChangeText={(arrivalTime) => patch({ logistics: { ...logistics, arrivalTime } })}
              placeholder="14:00"
            />
            <TextField
              label="At"
              value={logistics.arrivalPoint ?? ''}
              onChangeText={(arrivalPoint) => patch({ logistics: { ...logistics, arrivalPoint } })}
              placeholder="Airport, station"
            />
            <TextField
              label="Leave"
              value={logistics.departureTime ?? ''}
              onChangeText={(departureTime) =>
                patch({ logistics: { ...logistics, departureTime } })
              }
              placeholder="18:30"
            />
            <TextField
              label="From"
              value={logistics.departurePoint ?? ''}
              onChangeText={(departurePoint) =>
                patch({ logistics: { ...logistics, departurePoint } })
              }
              placeholder="Airport, station"
            />
          </FieldTrough>
        </Question>

        <View style={styles.action}>
          <PrimaryButton title="Next" onPress={() => router.push('/plan/preferences')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  content: { padding: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.regular },
  headline: { marginBottom: Spacing.tight },
  action: { marginTop: Spacing.tight },
});
