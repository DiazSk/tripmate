import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How TripMate learns from testers · TripMate" };

/**
 * What "Help improve TripMate?" actually means, in plain words (copy rows AN-05 to AN-12). Static:
 * it must read the same whether or not analytics is switched on in this build, so it is the one
 * page a tester can open before answering. The contact is a build-time value because the layout
 * is prerendered; without it the page points back to whoever sent the invitation.
 */
const CONTACT = process.env.NEXT_PUBLIC_PRIVACY_CONTACT;

export default function PrivacyPage() {
  return (
    <main className="map-chrome-hidden pointer-events-auto flex min-h-full justify-center p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)]">
      <article className="glass-itinerary is-opaque h-fit w-full max-w-2xl space-y-5 rounded-md p-5 text-sm leading-relaxed text-muted sm:p-7">
        <h1 className="text-xl font-medium text-foreground">How TripMate learns from testers</h1>
        <p>
          TripMate is being tested with a small group. If you say yes to &ldquo;Help improve TripMate?&rdquo;, we
          record how you use the app so we can see where it is confusing or slow. If you say no, nothing is sent.
        </p>

        <section className="space-y-1.5">
          <h2 className="font-medium text-foreground">What we collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>The screens you open and the buttons you press, and moments like starting a plan, keeping a trip or seeing an error.</li>
            <li>Screen recordings of what you do in TripMate. In them all text and everything you type is hidden, so a recording shows layout, taps and scrolling; the map is left out too.</li>
            <li>Your browser and device type, and roughly where in the world you are, from your connection.</li>
            <li>A random id for this browser. If you sign in, your name and email from your account as well, so we can follow up with you.</li>
          </ul>
        </section>

        <section className="space-y-1.5">
          <h2 className="font-medium text-foreground">What we never collect</h2>
          <p>
            What you type. Ideas, chat messages, dietary and access notes, saved places and names are hidden in recordings and are
            not sent with any event; we only see things like how long a message was. Page titles are not sent, and trip and share link
            codes are removed from page addresses in usage data.
          </p>
        </section>

        <section className="space-y-1.5">
          <h2 className="font-medium text-foreground">Why</h2>
          <p>Only to improve TripMate: to find what people get stuck on and to watch whether a change helped. It is not used for advertising and is not sold.</p>
        </section>

        <section className="space-y-1.5">
          <h2 className="font-medium text-foreground">Who handles it</h2>
          <p>
            PostHog stores it for us, on servers in the United States. It is a processor: it holds the data for TripMate and does
            nothing else with it. Anyone on the TripMate team can see it.
          </p>
        </section>

        <section className="space-y-1.5">
          <h2 className="font-medium text-foreground">Changing your mind</h2>
          <p>
            Turn it off any time under <Link href="/profile" className="underline underline-offset-2 hover:text-foreground">Profile</Link>,
            in &ldquo;Help improve TripMate&rdquo;. Turning it off stops everything straight away, and TripMate then asks PostHog to delete what it
            recorded about you. Deleting your account makes the same request.
          </p>
          <p>
            {CONTACT ? (
              <>To ask for your data to be deleted without an account, write to {CONTACT}.</>
            ) : (
              <>To ask for your data to be deleted without an account, ask the person who invited you to test TripMate.</>
            )}
          </p>
        </section>
      </article>
    </main>
  );
}
