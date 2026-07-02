import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy · Warmline",
  description: "What Warmline stores, what it never does, and how to delete everything",
};

// Static, public, and written in plain English. Follows the copy rules: no em
// dashes, no contrast constructions, bullets and labels carry no trailing
// period.
export default function Privacy() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Link
        href="/"
        className="text-sm font-semibold tracking-tight text-foreground/80 hover:text-foreground"
      >
        Warmline
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-2 text-sm text-foreground/60">
        Last updated 1 July 2026. Warmline is in a gated beta. This page says
        what we store and what we will never do with it.
      </p>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        What Warmline stores
      </h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/80">
        <li>
          Contacts you import yourself, with the fields in your export: names,
          headlines, companies, LinkedIn and X handles
        </li>
        <li>
          The raw export files you upload, exactly as you upload them. A
          LinkedIn export can include your contacts&apos; email addresses
        </li>
        <li>
          The email address of any account you connect, and cached profile
          photos for people in your feed
        </li>
        <li>The goal you type during onboarding and the links you provide</li>
        <li>Your thumbs votes on feed rows, used to tune your own ranking</li>
        <li>
          Daily usage counts per account that keep our AI spend capped
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        What Warmline never does
      </h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/80">
        <li>
          Send outreach for you. Warmline drafts openers and you send them
          yourself from your own accounts
        </li>
        <li>
          Scrape your accounts or read your messages. Warmline sees only what
          you choose to import or connect; its connector permissions are
          limited to contacts, calendar, and the connected account&apos;s
          basic identity, with no mail access of any kind
        </li>
        <li>Sell your data or share it with advertisers</li>
        <li>
          Show your network to anyone else. Every account sees only its own
          imported people
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        The public demo
      </h2>
      <p className="mt-3 text-sm text-foreground/80">
        The feed shown to signed-out visitors on the landing page belongs to a
        demo account we curate, seeded with synthetic people. It is not any
        user&apos;s network, and no user&apos;s data can appear in it.
      </p>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        Deleting your data
      </h2>
      <p className="mt-3 text-sm text-foreground/80">
        Settings has a Delete my data control. It permanently removes your
        imported contacts, connections, events, goal, votes, recommendations,
        usage counts, uploaded files, cached photos, and your account itself.
        There is no undo and nothing is retained.
      </p>

      <p className="mt-10 text-xs text-foreground/50">
        Questions: reach the maintainer through your invite thread.{" "}
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>
      </p>
    </main>
  );
}
