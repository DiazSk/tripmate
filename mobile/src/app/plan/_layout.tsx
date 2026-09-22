import { Stack } from 'expo-router';

import { PlanDraftProvider } from '@/lib/planDraft';

export default function PlanLayout() {
  return (
    <PlanDraftProvider>
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }} />
    </PlanDraftProvider>
  );
}
