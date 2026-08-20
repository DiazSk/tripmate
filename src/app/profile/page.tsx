import { readProfile } from "@/lib/db";
import ProfileForm from "./ProfileForm";

/**
 * Server half of `/profile`: reads the saved traveler profile and hands it to the form.
 *
 * Worth being precise about what this buys, because it is not streaming. `better-sqlite3` is a
 * synchronous driver, so `readProfile()` returns before this function does — there is nothing to
 * suspend on and a `<Suspense>` boundary or `loading.tsx` here would wrap something that never
 * pends. What it removes is the round trip: the form used to render defaults, mount, fetch
 * `/api/profile`, and re-render with the real values, which is both a wasted request and a
 * visible flip of every picker. Now the first paint is already correct.
 *
 * `/api/profile` stays — the form still PUTs through it to save, and it is the write path.
 */
export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return <ProfileForm initialProfile={readProfile()} />;
}
