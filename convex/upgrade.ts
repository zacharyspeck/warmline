import { internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./authz";

// The pricing page's Request access funnel. No payment processing anywhere:
// a signed-in user raises a hand, a row lands here, and the owner follows up
// by hand. Stripe wiring is a future supervised session (MANUAL_TODO.md).

export const planValidator = v.union(v.literal("pro"), v.literal("team"));

// Record that the signed-in caller wants a paid plan. Idempotent per
// (user, plan): asking again returns the existing request instead of piling
// up rows.
export const requestUpgrade = mutation({
  args: { plan: planValidator },
  returns: v.id("upgradeRequests"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("upgradeRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const match = existing.find((r) => r.plan === args.plan);
    if (match) return match._id;
    return await ctx.db.insert("upgradeRequests", {
      userId,
      plan: args.plan,
    });
  },
});

// Admin view: every open request with the requester's email and tier.
// Internal — run from the dashboard or `npx convex run upgrade:adminListRequests`.
export const adminListRequests = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      userId: v.id("users"),
      email: v.union(v.string(), v.null()),
      tier: v.string(),
      plan: planValidator,
      requestedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const requests = await ctx.db.query("upgradeRequests").take(500);
    const out = [];
    for (const r of requests) {
      const user = await ctx.db.get(r.userId);
      out.push({
        userId: r.userId,
        email: user?.email ?? null,
        tier: user?.tier ?? "free",
        plan: r.plan,
        requestedAt: r._creationTime,
      });
    }
    return out;
  },
});
