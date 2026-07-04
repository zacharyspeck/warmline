import {
  mutation,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";

// Server-side rate limit for signup / invite-code attempts. A fixed window per
// identifier (the lowercased email): generous enough that a real person
// retyping an invite code a handful of times is never blocked, tight enough
// that repeated signup attempts for one address are throttled.
//
// Enforcement point: the sign-up page calls api.rateLimit.recordSignupAttempt
// BEFORE calling signIn on the signUp flow. The counter and window live in
// Convex (this table), so the throttle itself is server-side. The invite gate
// in convex/auth.ts remains the unbypassable server-side guard on account
// CREATION: Convex Auth's Password provider consumes its profile() callback
// synchronously, so the invite check cannot itself touch the DB, and every
// DB-capable auth callback runs only after that gate — hence this dedicated
// pre-flow limiter. (Fully throttling direct api.auth.signIn calls that skip
// this step would require replacing the Password provider; see MANUAL_TODO.)

export const SIGNUP_MAX_ATTEMPTS = 10;
export const SIGNUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const RATE_LIMIT_ERROR =
  "Too many attempts. Please wait a few minutes and try again";

// Per-user extension capture limit (task: revive the extension). Generous for
// a human clicking Capture on profiles, tight enough that a leaked token can't
// hammer the graph. Keyed by `ext:<userId>` in the same table.
export const CAPTURE_MAX_PER_WINDOW = 60;
export const CAPTURE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// The generic fixed-window limiter over the signupAttempts table. The first
// attempt opens a window; it resets once windowMs has elapsed since it opened.
// Pure ctx helper so it is unit-testable and reusable across throttles.
export async function enforceRateLimit(
  ctx: MutationCtx,
  identifier: string,
  max: number,
  windowMs: number,
): Promise<void> {
  const id = identifier.trim().toLowerCase() || "unknown";
  const now = Date.now();
  const existing = await ctx.db
    .query("signupAttempts")
    .withIndex("by_identifier", (q) => q.eq("identifier", id))
    .unique();
  if (!existing) {
    await ctx.db.insert("signupAttempts", {
      identifier: id,
      windowStart: now,
      count: 1,
    });
    return;
  }
  if (now - existing.windowStart > windowMs) {
    // The window elapsed → start a fresh one.
    await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
    return;
  }
  if (existing.count >= max) {
    // ConvexError so the message survives prod redaction (like the invite gate).
    throw new ConvexError(RATE_LIMIT_ERROR);
  }
  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}

// Record one signup attempt for `identifier`; throw once the window's cap is hit.
export async function enforceSignupRateLimit(
  ctx: MutationCtx,
  identifier: string,
): Promise<void> {
  await enforceRateLimit(
    ctx,
    identifier,
    SIGNUP_MAX_ATTEMPTS,
    SIGNUP_WINDOW_MS,
  );
}

// Record one extension capture for `userId`; throw once the window's cap is hit.
export async function enforceCaptureRateLimit(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  await enforceRateLimit(
    ctx,
    `ext:${userId}`,
    CAPTURE_MAX_PER_WINDOW,
    CAPTURE_WINDOW_MS,
  );
}

// The sign-up page calls this before signIn("password", { flow: "signUp" }).
export const recordSignupAttempt = mutation({
  args: { identifier: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await enforceSignupRateLimit(ctx, args.identifier);
    return null;
  },
});

// A row is only meaningful for one window; once its window has elapsed the next
// attempt just resets it, so an old row is safely deletable. The daily cron
// drops rows well past their window (STALE_AFTER_MS) in bounded batches so the
// table stays bounded and no normalized email lingers indefinitely — including
// after a user deletes their account. Self-reschedules until drained.
const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour (6× the window, generous margin)

export const purgeStaleSignupAttempts = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_AFTER_MS;
    const stale = await ctx.db
      .query("signupAttempts")
      .withIndex("by_windowStart", (q) => q.lt("windowStart", cutoff))
      .take(500);
    for (const row of stale) await ctx.db.delete(row._id);
    if (stale.length === 500) {
      await ctx.scheduler.runAfter(
        0,
        internal.rateLimit.purgeStaleSignupAttempts,
        {},
      );
    }
    return null;
  },
});
