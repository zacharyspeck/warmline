import { cronJobs, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { CRON_JUDGE_PER_RUN } from "./limits";

export const userIdPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    ids: v.array(v.id("users")),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("users").paginate(args.paginationOpts);
    return {
      ids: page.page.map((u) => u._id),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

// One user's daily refresh: recompute bridges, re-rank the latest ICP, refresh
// avatars for the top people. Each step is best-effort in its OWN try/catch —
// a missing OpenAI key or a bad rank must never take the (cosmetic but visible)
// avatar refresh down with it.
export const refreshOneUser = internalAction({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = args;
    try {
      await ctx.runAction(internal.edges.computeEdges, { userId });
    } catch (err) {
      console.error(`refreshOneUser: computeEdges failed for ${userId}`, err);
    }
    try {
      const icp = await ctx.runQuery(internal.icp.latestForUser, { userId });
      // Cost caps (Phase E): at most CRON_JUDGE_PER_RUN judge calls per user
      // per run, judging only new or changed recommendations. Once the daily
      // caps are hit, rebuild degrades to cached vectors and existing or
      // heuristic copy WITHOUT throwing — so the cycle always completes and
      // remaining users still get a refresh on cached data.
      if (icp)
        await ctx.runAction(internal.rank.rebuild, {
          icpId: icp._id,
          maxJudge: CRON_JUDGE_PER_RUN,
          skipUnchanged: true,
        });
    } catch (err) {
      console.error(`refreshOneUser: rank failed for ${userId}`, err);
    }
    try {
      await ctx.runAction(internal.avatars.enrichTop, { userId, limit: 24 });
    } catch {
      /* avatars are cosmetic; never block the refresh */
    }
    return null;
  },
});

// Daily proactive run: schedule an independent refresh per user. Fan-out keeps
// each user inside their own action time budget (a serial loop would hit the
// 10-minute action cap and silently starve everyone after the cutoff).
export const dailyRefresh = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    let cursor: string | null = null;
    for (;;) {
      const page: {
        ids: Id<"users">[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.crons.userIdPage, {
        paginationOpts: { numItems: 100, cursor },
      });
      for (const userId of page.ids) {
        await ctx.scheduler.runAfter(0, internal.crons.refreshOneUser, {
          userId,
        });
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return null;
  },
});

const crons = cronJobs();
// 13:00 UTC daily.
crons.cron(
  "warmline daily refresh",
  "0 13 * * *",
  internal.crons.dailyRefresh,
  {},
);
// One usage-summary line per cycle, an hour after the refresh fan-out — by
// then the per-user refreshes have run, so the totals reflect today's cycle.
crons.cron(
  "warmline usage summary",
  "0 14 * * *",
  internal.usage.logDailySummary,
  {},
);

export default crons;
