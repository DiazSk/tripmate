import { useLocalSearchParams, useRouter } from 'expo-router';

import { BudgetSheet } from '@/components/budget-sheet';
import { useTripSheets } from '@/lib/tripSheets';

/** The trip's money as a form sheet over the trip (`?tab=day` opens on the day being read). */
export default function BudgetRoute() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const sheets = useTripSheets(id);
  // Opened without its trip behind it (a cold deep link): there is nothing to add up.
  if (!sheets) return null;
  return (
    <BudgetSheet
      initial={tab === 'day' ? 'day' : 'trip'}
      days={sheets.days}
      budget={sheets.budget}
      dayIndex={sheets.dayIndex}
      offline={sheets.offline}
      onDay={sheets.onDay}
      onSureness={sheets.onSureness}
      onClose={router.back}
    />
  );
}
