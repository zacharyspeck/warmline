import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import {
  Category,
  dayKey,
  globalDailyCap,
  userDailyCap,
} from "./limits";

// Phase E metering. Every OpenAI/scrape spend is RESERVED here before the
// external call happens. Because a Convex mutation is one serializable
// transaction, two concurrent actions can never both pass on one remaining
// slot: the second reserve sees the first one's increment (or retries under
// OCC and then sees it). A reserved-but-failed external call burns its slot —
// that under-uses budget, never overspends it.

export const categoryValidator = v.union(
  v.literal("judge"),
  v.literal("embed"),
  v.literal("scrape"),
);

// Reserve up to `count` calls of `category` for `userId` today. Returns how
// many were actually granted: min(count, user's remaining, global remaining),
// floored at zero — callers degrade on a short grant, they don't throw.
// Fail-closed: unknown user, unknown tier, or a non-positive count → 0.
export const reserve = internalMutation({
  args: {
    userId: v.id("users"),
    category: categoryValidator,
    count: v.number(),
  },
  returns: v.object({ granted: v.number() }),
  handler: async (ctx, args) => {
    const requested = Math.floor(args.count);
    if (!Number.isFinite(requested) || requested <= 0) return { granted: 0 };
    const user = await ctx.db.get(args.userId);
    if (!user) return { granted: 0 };

    const category = args.category as Category;
    const day = dayKey(Date.now());
    const userCap = userDailyCap(user.tier, category);
    const globalCap = globalDailyCap(category);

    const userRow = await ctx.db
      .query("usage")
      .withIndex("by_user_and_day", (q) =>
        q.eq("userId", args.userId).eq("day", day),
      )
      .unique();
    const globalRow = await ctx.db
      .query("usageGlobal")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();

    const userUsed = userRow?.[category] ?? 0;
    const globalUsed = globalRow?.[category] ?? 0;
    const granted = Math.max(
      0,
      Math.min(requested, userCap - userUsed, globalCap - globalUsed),
    );
    if (granted === 0) return { granted: 0 };

    if (userRow) {
      await ctx.db.patch(userRow._id, {
        [category]: userUsed + granted,
      });
    } else {
      await ctx.db.insert("usage", {
        userId: args.userId,
        day,
        judge: 0,
        embed: 0,
        scrape: 0,
        [category]: granted,
      });
    }
    if (globalRow) {
      await ctx.db.patch(globalRow._id, {
        [category]: globalUsed + granted,
      });
    } else {
      await ctx.db.insert("usageGlobal", {
        day,
        judge: 0,
        embed: 0,
        scrape: 0,
        [category]: granted,
      });
    }
    return { granted };
  },
});
