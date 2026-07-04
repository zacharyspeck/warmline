"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WarmlineLockup } from "@/components/warmline-mark";

// S1: full-window, centered, nothing extraneous — the W lockup, one dark card,
// a single amber primary button, and a quiet toggle between the two states.
// Deliberate departures from the reference (design/screens/warmline-S1):
//   • no "Continue with Google" — email and password is the only login flow
//     until the OAuth phase (see the marker below)
//   • no "Forgot?" link — no reset flow exists yet (MANUAL_TODO)
//   • the invite-code field stays on Create account — signup is gated
export default function SignIn() {
  const { signIn } = useAuthActions();
  const recordSignupAttempt = useMutation(api.rateLimit.recordSignupAttempt);
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-card px-8 py-10 [box-shadow:var(--shadow-l,0_20px_50px_rgb(0_0_0/0.35))]">
          <div className="mb-8 flex flex-col items-center gap-5 text-center">
            <WarmlineLockup markClassName="size-6" />
            <div>
              <h1 className="font-display text-[26px] font-semibold tracking-tight text-foreground">
                {flow === "signIn" ? "Welcome back" : "Create your account"}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {flow === "signIn"
                  ? "Sign in to your warm network"
                  : "Start seeing who to reach out to"}
              </p>
            </div>
          </div>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setLoading(true);
              setError(null);
              const formData = new FormData(e.target as HTMLFormElement);
              formData.set("flow", flow);
              // Server-side signup rate limit (per email, fixed window) runs
              // before the account flow; on the sign-in flow it's a no-op.
              const gate =
                flow === "signUp"
                  ? recordSignupAttempt({
                      identifier: String(formData.get("email") ?? ""),
                    })
                  : Promise.resolve(null);
              void gate
                .then(() => signIn("password", formData))
                .then(() => {
                  router.push(flow === "signUp" ? "/onboarding" : "/");
                })
                .catch((error) => {
                  // ConvexError data survives prod redaction (e.g. the invite
                  // gate's or rate limit's message); else fall back to message.
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
                autoComplete={
                  flow === "signIn" ? "current-password" : "new-password"
                }
                minLength={8}
                required
              />
              {flow === "signUp" && (
                <p className="px-1 text-xs text-muted-foreground">
                  At least 8 characters
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

            {/* OAuth sign-in ("Continue with Google") returns HERE in the
                OAuth phase, as a divider + provider button above the submit.
                Email and password is the ONLY login flow until then. */}

            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className="mt-1 h-11 w-full text-[15px]"
            >
              {loading
                ? "Loading…"
                : flow === "signIn"
                  ? "Sign in"
                  : "Create account"}
            </Button>

            {flow === "signUp" && (
              <p className="text-center text-xs text-muted-foreground">
                By continuing you agree to our{" "}
                <Link
                  href="/terms"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Terms
                </Link>{" "}
                and{" "}
                <Link
                  href="/privacy"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Privacy Policy
                </Link>
              </p>
            )}

            <div className="mt-1 flex flex-row justify-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {flow === "signIn"
                  ? "New to Warmline?"
                  : "Already have an account?"}
              </span>
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
              >
                {flow === "signIn" ? "Create an account" : "Sign in"}
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
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
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
    </div>
  );
}
