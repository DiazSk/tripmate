import { ActionSheetIOS, Alert, Platform } from 'react-native';

import type { TripSummary } from '@/api/types';

/**
 * Asks before a trip or a draft is deleted, with the platform's destructive sheet: an action sheet
 * on iOS, an alert on Android. One place, because the Trips long-press menu and the trip screen's
 * Discard ask the same question about the same row, and a plan costs minutes of generation.
 */
export function confirmDelete(trip: Pick<TripSummary, 'status' | 'destination'>, run: () => void) {
  const draft = trip.status === 'draft';
  const title = draft ? 'Discard this draft?' : 'Delete this trip?';
  const message = `Your ${trip.destination} itinerary will be permanently deleted. This can't be undone.`;
  const action = draft ? 'Discard Draft' : 'Delete Trip';
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, message, options: [action, 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => i === 0 && run(),
    );
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: action, style: 'destructive', onPress: run },
    ]);
  }
}
