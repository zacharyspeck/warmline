"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The three plan cards. Request access is the ONLY action: signed-in users
// write an upgradeRequests row (idempotent per plan) and see the confirmed
// state; signed-out visitors are sent to sign in first.

type Plan = "pro" | "team";

const PLANS: {
  name: string;
  price: string;
  priceNote?: string;
  blurb: string;
  features: string[];
  plan?: Plan; // absent = the free tier, whose CTA is signup
  highlight?: boolean;
}[] = [
  {
    name: "Free",
    price: "$0",
    blurb: "Everything you need to see your warm network work",
    features: [
      "Weekly re-rank of your feed",
      "Capped network import",
      "A small monthly allowance of fully unlocked warm paths",
    ],
  },
  {
    name: "Pro",
    price: "$20",
    priceNote: "a month",
    blurb: "The daily habit for people actively reaching out",
    features: [
      "Daily proactive re-rank",
      "Unlimited warm paths and openers",
      "Multiple goals",
    ],
    plan: "pro",
    highlight: true,
  },
  {
    name: "Team",
    price: "Talk to us",
    blurb: "Pooled networks for a team that intros together",
    features: [
      "Pooled networks across your team",
      "Everything in Pro for every seat",
      "Shared goals and warm paths",
    ],
    plan: "team",
  },
];

export function PricingCards() {
  const me = useQuery(api.auth.currentUser);
  const requestUpgrade = useMutation(api.upgrade.requestUpgrade);
  const [requested, setRequested] = useState<Partial<Record<Plan, boolean>>>(
    {},
  );
  const [busy, setBusy] = useState<Plan | null>(null);

  return (
    <div className="mt-8 grid gap-4 md:grid-cols-3">
      {PLANS.map((p) => (
        <div
          key={p.name}
          className={cn(
            "flex flex-col rounded-2xl border bg-card p-6 [box-shadow:var(--shadow-s)]",
            p.highlight ? "border-primary/60" : "border-border",
          )}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {p.name}
            </h2>
            {p.highlight && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                Most useful
              </span>
            )}
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="font-display text-3xl font-semibold text-foreground">
              {p.price}
            </span>
            {p.priceNote && (
              <span className="text-sm text-muted-foreground">
                {p.priceNote}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{p.blurb}</p>
          <ul className="mt-5 flex-1 space-y-2.5">
            {p.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm">
                <CheckIcon
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden
                />
                <span className="text-secondary-foreground">{f}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            {!p.plan ? (
              <Button asChild variant="outline" className="w-full">
                <Link href="/signin">Start free</Link>
              </Button>
            ) : me ? (
              <Button
                variant={p.highlight ? "primary" : "outline"}
                className="w-full"
                disabled={busy === p.plan || requested[p.plan]}
                onClick={() => {
                  const plan = p.plan!;
                  setBusy(plan);
                  void requestUpgrade({ plan })
                    .then(() => setRequested((r) => ({ ...r, [plan]: true })))
                    .finally(() => setBusy(null));
                }}
              >
                {requested[p.plan]
                  ? "Requested, we will reach out"
                  : busy === p.plan
                    ? "Requesting…"
                    : "Request access"}
              </Button>
            ) : (
              <Button
                asChild
                variant={p.highlight ? "primary" : "outline"}
                className="w-full"
              >
                <Link href="/signin">Sign in to request access</Link>
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
