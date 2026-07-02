"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Delete my data</CardTitle>
          <CardDescription>
            Permanently removes everything Warmline stores about you: imported
            contacts, connections, events, your goal, votes, recommendations,
            usage counts, and your account itself. There is no undo
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
