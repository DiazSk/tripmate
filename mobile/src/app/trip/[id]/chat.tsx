import { useLocalSearchParams, useRouter } from 'expo-router';

import { ChatSheet } from '@/components/chat-sheet';
import { useTripSheets } from '@/lib/tripSheets';

/** The whole conversation, as a form sheet over the trip; the Ask bar's "N messages" opens it. */
export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const sheets = useTripSheets(id);
  if (!sheets) return null;
  return (
    <ChatSheet
      onClose={router.back}
      turns={sheets.turns}
      replying={sheets.replying}
      failure={sheets.failure}
      days={sheets.days}
    />
  );
}
