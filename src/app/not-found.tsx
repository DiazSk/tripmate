import PageError from "@/components/PageError";

/** An address that matches no page (copy row G-17). Next serves it with a real 404. */
export default function NotFound() {
  return (
    <PageError
      title="There’s no page here."
      tone="muted"
      links={[
        { href: "/", label: "Plan a trip", primary: true },
        { href: "/trips", label: "See your memories" },
      ]}
    >
      The address may be mistyped, or the page has moved.
    </PageError>
  );
}
