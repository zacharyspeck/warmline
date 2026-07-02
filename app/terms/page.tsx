import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms · Warmline",
  description: "Minimal, honest terms for the Warmline gated beta",
};

// Minimal and honest for a gated beta. Same copy rules as /privacy.
export default function Terms() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Link
        href="/"
        className="text-sm font-semibold tracking-tight text-foreground/80 hover:text-foreground"
      >
        Warmline
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Terms</h1>
      <p className="mt-2 text-sm text-foreground/60">
        Last updated 1 July 2026. Short version: this is an invite-only beta,
        your data stays yours, and the service may change while we build.
      </p>

      <ul className="mt-6 list-disc space-y-2 pl-5 text-sm text-foreground/80">
        <li>
          Warmline is a gated beta. Accounts require an invite code and access
          can be revoked if the service is abused
        </li>
        <li>
          Your imported data stays yours. You can delete all of it at any time
          from Settings, including your account
        </li>
        <li>
          Warmline drafts outreach for you to review and send yourself. You are
          responsible for what you actually send
        </li>
        <li>
          The service is provided as is during the beta. Features may change,
          break, or be removed while we build
        </li>
        <li>
          Do only normal things: no attempts to access other accounts, no
          probing the API for data that is not yours, no scraping the service
        </li>
        <li>
          Import only contacts you may lawfully use. Warmline stores what you
          give it and nothing more
        </li>
      </ul>

      <p className="mt-10 text-xs text-foreground/50">
        Questions: reach the maintainer through your invite thread.{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>
      </p>
    </main>
  );
}
