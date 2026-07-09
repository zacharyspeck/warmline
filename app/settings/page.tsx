"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExtensionSettingsCard } from "@/components/extension-settings-card";

// Mirrors convex/account.ts CONFIRM_PHRASE — the server checks it again, so
// a bypassed client still can't delete without the exact phrase.
const CONFIRM_PHRASE = "delete my data";

export default function Settings() {
  const me = useQuery(api.auth.currentUser);
  const deleteMyData = useMutation(api.account.deleteMyData);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <header className="mb-7">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 text-sm text-foreground/60">
          {me?.email ? `Signed in as ${me.email}` : "Your account"}
        </p>
      </header>

      <PlanCard />

      <ExtensionSettingsCard />

      <Card className="mt-6 border-destructive/40">
        <CardHeader>
          <CardTitle>Delete my data</CardTitle>
          <CardDescription>
            Permanently removes the personal data Warmline stores about you:
            imported contacts, connections, events, your goal, votes,
            recommendations, usage counts, and your account itself. There is
            no undo. It leaves one thing, a short signup rate-limit record
            keyed to an email, and that clears on its own soon after
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              deleteMyData({ confirm: phrase })
                .then(() => signOut())
                .then(() => {
                  router.push("/");
                  router.refresh();
                })
                .catch((err) => {
                  setError(
                    err instanceof Error ? err.message : "Could not delete",
                  );
                  setBusy(false);
                });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm">
                Type <span className="font-semibold">{CONFIRM_PHRASE}</span> to
                confirm
              </Label>
              <Input
                id="confirm"
                type="text"
                autoComplete="off"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={CONFIRM_PHRASE}
              />
            </div>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy || phrase !== CONFIRM_PHRASE}
            >
              {busy ? "Deleting…" : "Delete everything"}
            </Button>
            {error && (
              <p className="text-sm font-medium text-[oklch(0.78_0.14_22)]">
                {error}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// The Plan section (task S1.6): current tier, today's spend from the existing
// metering, a Request access button (writes upgradeRequests), and a link to
// the full pricing page. No payment processing here.
const USAGE_ROWS: { key: "judge" | "embed" | "scrape"; label: string }[] = [
  { key: "judge", label: "Ranking & opener drafts" },
  { key: "embed", label: "Goal-fit embeddings" },
  { key: "scrape", label: "Onboarding site scrapes" },
];

function PlanCard() {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(() => {
    const t = setInterval(
      () => setDay(new Date().toISOString().slice(0, 10)),
      60_000,
    );
    return () => clearInterval(t);
  }, []);
  const usage = useQuery(api.usage.myUsage, { day });
  const requestUpgrade = useMutation(api.upgrade.requestUpgrade);
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);

  const tierLabel = usage
    ? usage.tier.charAt(0).toUpperCase() + usage.tier.slice(1)
    : "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Plan</CardTitle>
          {usage && <Badge variant="secondary">{tierLabel}</Badge>}
        </div>
        <CardDescription>
          Your current tier and today&rsquo;s usage. Warmline is invite-only
          during the beta; no payment is collected
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
            Today&rsquo;s usage
          </p>
          {usage ? (
            <ul className="flex flex-col gap-1.5">
              {USAGE_ROWS.map(({ key, label }) => (
                <li
                  key={key}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="tabular-nums text-foreground">
                    {usage.used[key]}
                    <span className="text-muted-foreground">
                      {" "}
                      / {usage.caps[key]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Loading usage…</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={busy || requested}
            onClick={() => {
              setBusy(true);
              requestUpgrade({ plan: "pro" })
                .then(() => setRequested(true))
                .finally(() => setBusy(false));
            }}
          >
            {requested
              ? "Requested, we will reach out"
              : busy
                ? "Requesting…"
                : "Request access to Pro"}
          </Button>
          <Link
            href="/pricing"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            See all plans
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
