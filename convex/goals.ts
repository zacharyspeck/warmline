import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

// The Goals editor's save path. icp is append-only, so a goal edit inserts a
// NEW icp row (carrying forward the source links + audience the goal was
// created with) and re-ranks. rank.rebuild embeds the composed goal ONCE
// under the embed reserve and swaps the recommendations, so this is the same
// "embed once + rec-swap" flow onboarding uses, minus the scrape.
const targetsValidator = v.object({
  companies: v.array(v.string()),
  roles: v.array(v.string()),
  locations: v.array(v.string()),
});

export const saveGoal = action({
  args: { text: v.string(), targets: targetsValidator },
  returns: v.object({ icpId: v.id("icp") }),
  handler: async (ctx, args): Promise<{ icpId: Id<"icp"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    if (!args.text.trim()) throw new Error("Goal cannot be empty");
    const prior = await ctx.runQuery(internal.icp.latestForEdit, { userId });
    const icpId: Id<"icp"> = await ctx.runMutation(api.icp.saveIcp, {
      text: args.text.trim(),
      source: prior?.source ?? {},
      ...(prior?.audience ? { audience: prior.audience } : {}),
      targets: args.targets,
    });
    await ctx.runAction(internal.rank.rebuild, { icpId });
    return { icpId };
  },
});
