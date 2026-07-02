import type { Metadata } from "next";
import Link from "next/link";
import { PricingCards } from "./pricing-cards";

export const metadata: Metadata = {
  title: "Pricing · Warmline",
  description:
    "Warmline pricing during the gated beta: a capped free tier, Pro at $20 a month with daily proactive re-ranks, and pooled team networks.",
};

// Public pricing page. Every number here is provisional during the beta and
// nothing is a binding commitment; the only action is Request access, which
// writes an upgradeRequests row for a signed-in user. No payment processing
// exists anywhere in the app.
export default function Pricing() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <Link
        href="/"
        className="text-sm font-semibold tracking-tight text-foreground/80 hover:text-foreground"
      >
        Warmline
      </Link>
      <h1 className="mt-6 font-display text-[32px] font-semibold tracking-tight text-foreground">
        Pricing
      </h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Simple while we build. Every number on this page is provisional during
        the beta and can change before launch. No payment is collected today:
        requesting access adds you to the list and we reach out
      </p>

      <PricingCards />

      <p className="mt-10 text-xs text-muted-foreground">
        Questions about a plan: reach the maintainer through your invite
        thread.{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>
        <span className="mx-1.5" aria-hidden>
          ·
        </span>
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>
      </p>
    </main>
  );
}
