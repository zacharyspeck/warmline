import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { DataModel } from "./_generated/dataModel";
import { DEMO_EMAIL } from "./devSeed";

// ONE generic error for every signup-gate failure (wrong code, missing code,
// reserved email): a caller probing the backend directly can't tell which
// check tripped. ConvexError so the exact message survives prod redaction.
const INVITE_ERROR = "Invalid invite code";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      // Runs INSIDE the auth:signIn action for every password flow, before any
      // account is created — so the invite gate holds even when the client is
      // bypassed and the backend is called directly. This callback is consumed
      // synchronously by the Password provider, so it cannot touch the DB; the
      // signup rate limit lives in the DB-backed api.rateLimit.recordSignupAttempt,
      // enforced by the sign-up page before this runs.
      profile(params) {
        const email = typeof params.email === "string" ? params.email : "";
        if (params.flow === "signUp") {
          // Invite gate. Fail closed: with INVITE_CODE unset on the
          // deployment, every signup is rejected.
          const expected = process.env.INVITE_CODE;
          const supplied =
            typeof params.inviteCode === "string" ? params.inviteCode : "";
          if (!expected || supplied !== expected) {
            throw new ConvexError(INVITE_ERROR);
          }
          // The demo account is data-only: it has no password credential and
          // no signup may ever create one (its graph is the public demo).
          // Sign-IN with this email needs no special case — it fails like any
          // unknown account, which also avoids marking the address as special.
          if (email.trim().toLowerCase() === DEMO_EMAIL) {
            throw new ConvexError(INVITE_ERROR);
          }
        }
        if (!email) throw new ConvexError(INVITE_ERROR);
        return { email };
      },
    }),
  ],
});

// The signed-in user's stable id + email, exposed to the client. Null when
// signed out. getAuthUserId(ctx) is the canonical server-side stable user id
// (Id<"users">) that Phase B scopes every table by.
export const currentUser = query({
  args: {},
  returns: v.union(
    v.object({
      id: v.id("users"),
      email: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get("users", userId);
    return { id: userId, email: user?.email ?? null };
  },
});
