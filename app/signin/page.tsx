"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  return (
    <div className="mx-auto flex h-screen w-full max-w-md flex-col justify-center gap-8 px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-2xl font-semibold tracking-tight">Warmline</span>
        <p className="max-w-sm text-sm text-muted-foreground">
          Who to reach out to, and why. Sign in to see your feed
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{flow === "signIn" ? "Sign in" : "Create account"}</CardTitle>
          <CardDescription>
            {flow === "signIn"
              ? "Pick up where you left off"
              : "Surface warm intros for your goal"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setLoading(true);
              setError(null);
              const formData = new FormData(e.target as HTMLFormElement);
              formData.set("flow", flow);
              void signIn("password", formData)
                .then(() => {
                  router.push(flow === "signUp" ? "/onboarding" : "/");
                })
                .catch((error) => {
                  // ConvexError data survives prod redaction (e.g. the invite
                  // gate's message); anything else falls back to error.message.
                  setError(
                    error instanceof ConvexError &&
                      typeof error.data === "string"
                      ? error.data
                      : error.message,
                  );
                  setLoading(false);
                });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                name="email"
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                name="password"
                placeholder="••••••••"
                autoComplete={flow === "signIn" ? "current-password" : "new-password"}
                minLength={8}
                required
              />
              {flow === "signUp" && (
                <p className="px-1 text-xs text-muted-foreground">
                  Password must be at least 8 characters
                </p>
              )}
            </div>

            {flow === "signUp" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inviteCode">Invite code</Label>
                <Input
                  id="inviteCode"
                  type="text"
                  name="inviteCode"
                  placeholder="From your invite"
                  autoComplete="off"
                  required
                />
                <p className="px-1 text-xs text-muted-foreground">
                  Warmline is invite-only for now
                </p>
              </div>
            )}

            <Button type="submit" variant="primary" disabled={loading} className="mt-1">
              {loading ? "Loading…" : flow === "signIn" ? "Sign in" : "Sign up"}
            </Button>

            {/* OAuth sign-in ("Continue with Google") returns HERE in the
                OAuth phase, as a divider + provider button above this footer.
                Email and password is the ONLY login flow until then; the
                Google/Outlook OAuth under app/api/connectors is data-source
                permission, not login, and stays. */}
            <div className="flex flex-row justify-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {flow === "signIn" ? "Don't have an account?" : "Already have an account?"}
              </span>
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
              >
                {flow === "signIn" ? "Sign up" : "Sign in"}
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                <p className="break-words text-sm font-medium text-[oklch(0.78_0.14_22)]">
                  {error}
                </p>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        <Link href="/privacy" className="underline-offset-4 hover:underline">
          Privacy
        </Link>
        <span className="mx-2" aria-hidden>
          ·
        </span>
        <Link href="/terms" className="underline-offset-4 hover:underline">
          Terms
        </Link>
      </p>
    </div>
  );
}
