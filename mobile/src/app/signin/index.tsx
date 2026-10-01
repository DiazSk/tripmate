import { Redirect } from 'expo-router';

// Placeholder — Task 5 replaces this with the chooser. Until then `/signin` behaves as it did.
export default function AuthChooserScreen() {
  return <Redirect href="/signin/form?mode=login" />;
}
