import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  CATEGORIES,
  Category,
  DEFAULT_TIER,
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

// ── Observability (Phase E3) ──

const countsValidator = v.object({
  judge: v.number(),
  embed: v.number(),
  scrape: v.number(),
});

// Admin view of today's spend: every user who spent anything, plus the global
// totals and their caps. Internal — run it from the dashboard or CLI:
//   npx convex run usage:adminToday
export const adminToday = internalQuery({
  args: {},
  returns: v.object({
    day: v.string(),
    global: countsValidator,
    globalCaps: countsValidator,
    users: v.array(
      v.object({
        userId: v.id("users"),
        email: v.union(v.string(), v.null()),
        tier: v.string(),
        judge: v.number(),
        embed: v.number(),
        scrape: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const day = dayKey(Date.now());
    const globalRow = await ctx.db
      .query("usageGlobal")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    const rows = await ctx.db
      .query("usage")
      .withIndex("by_day", (q) => q.eq("day", day))
      .take(500);
    const users = [];
    for (const row of rows) {
      const user = await ctx.db.get(row.userId);
      users.push({
        userId: row.userId,
        email: user?.email ?? null,
        tier: user?.tier ?? DEFAULT_TIER,
        judge: row.judge,
        embed: row.embed,
        scrape: row.scrape,
      });
    }
    users.sort((a, b) => b.judge + b.embed + b.scrape - (a.judge + a.embed + a.scrape));
    return {
      day,
      global: {
        judge: globalRow?.judge ?? 0,
        embed: globalRow?.embed ?? 0,
        scrape: globalRow?.scrape ?? 0,
      },
      globalCaps: {
        judge: globalDailyCap("judge"),
        embed: globalDailyCap("embed"),
        scrape: globalDailyCap("scrape"),
      },
      users,
    };
  },
});

// The daily cycle's ONE summary line, visible in the Convex dashboard logs —
// a runaway shows up as a used/cap ratio no later than the next cycle.
// Scheduled in crons.ts an hour after the refresh fan-out, when the per-user
// refreshes have run. The line carries BOTH today's so-far totals and
// YESTERDAY's finals: spend that lands after today's line prints (the
// 14:00-UTC-to-midnight window) still surfaces as yesterday's final in
// tomorrow's line, so no window of the day goes unreported.
export const logDailySummary = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const summarize = async (day: string) => {
      const globalRow = await ctx.db
        .query("usageGlobal")
        .withIndex("by_day", (q) => q.eq("day", day))
        .unique();
      const rows = await ctx.db
        .query("usage")
        .withIndex("by_day", (q) => q.eq("day", day))
        .take(500);
      const parts = CATEGORIES.map((c: Category) => {
        const used = globalRow?.[c] ?? 0;
        return `${c}=${used}/${globalDailyCap(c)}`;
      });
      return `${parts.join(" ")} · ${rows.length} active user${rows.length === 1 ? "" : "s"}`;
    };
    const today = dayKey(now);
    const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
    console.log(
      `[usage] ${today} so far ${await summarize(today)} · final ${yesterday} ${await summarize(yesterday)}`,
    );
    return null;
  },
});
