import { mutation, type MutationCtx } from "./_generated/server";
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

// Record one attempt for `identifier`; throw once the window's cap is hit.
// Fixed window: the first attempt opens a window, and the window resets once
// SIGNUP_WINDOW_MS has elapsed since it opened. Pure ctx helper so it is
// unit-testable and reusable.
export async function enforceSignupRateLimit(
  ctx: MutationCtx,
  identifier: string,
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
  if (now - existing.windowStart > SIGNUP_WINDOW_MS) {
    // The window elapsed → start a fresh one.
    await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
    return;
  }
  if (existing.count >= SIGNUP_MAX_ATTEMPTS) {
    // ConvexError so the message survives prod redaction (like the invite gate).
    throw new ConvexError(RATE_LIMIT_ERROR);
  }
  await ctx.db.patch(existing._id, { count: existing.count + 1 });
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
