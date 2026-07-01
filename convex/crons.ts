import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// Daily proactive run: recompute bridges, re-rank the latest ICP, then refresh
// avatars for the top people. Avatar enrichment is best-effort — network hiccups
// or a missing FIBER_API_KEY must never fail the daily refresh.
export const dailyRefresh = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runAction(internal.edges.computeEdges, {});
    const icp = await ctx.runQuery(api.icp.latest, {});
    if (icp) await ctx.runAction(internal.rank.rebuild, { icpId: icp._id });
    try {
      await ctx.runAction(internal.avatars.enrichTop, { limit: 24 });
    } catch {
      /* avatars are cosmetic; never block the refresh */
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

export default crons;
