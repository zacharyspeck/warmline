import {
  mutation,
  query,
  action,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { embed } from "./openai";
import { requireUser } from "./authz";

const sourceValidator = v.object({
  website: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  x: v.optional(v.string()),
});

// Onboarding: store the ICP text (derived from the product site) + the 3 links
// + who the feed is for (individual vs company).
export const saveIcp = mutation({
  args: {
    text: v.string(),
    source: sourceValidator,
    audience: v.optional(
      v.union(v.literal("individual"), v.literal("company")),
    ),
  },
  returns: v.id("icp"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return await ctx.db.insert("icp", {
      userId,
      text: args.text,
      source: args.source,
      ...(args.audience ? { audience: args.audience } : {}),
    });
  },
});

// Owner-scoped read for embedIcp: a missing icp and a foreign icp look the
// same (null), so the public action can't be used to probe other users' ids.
export const getOwned = internalQuery({
  args: { icpId: v.id("icp"), userId: v.id("users") },
  returns: v.union(
    v.object({ text: v.string(), hasVector: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const icp = await ctx.db.get(args.icpId);
    if (!icp || icp.userId !== args.userId) return null;
    return { text: icp.text, hasVector: !!icp.vector };
  },
});

export const setVector = internalMutation({
  args: { icpId: v.id("icp"), vector: v.array(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.icpId, { vector: args.vector });
    return null;
  },
});

// Embed the ICP text into a vector (OpenAI). Run once after saveIcp. Requires
// an authenticated caller who OWNS the icp: this is a public action that both
// spends OpenAI credits and rewrites the icp's ranking vector, so an anonymous
// or cross-user call is denied before any model call.
export const embedIcp = action({
  args: { icpId: v.id("icp") },
  returns: v.object({ dims: v.number() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const icp = await ctx.runQuery(internal.icp.getOwned, {
      icpId: args.icpId,
      userId,
    });
    if (!icp) throw new Error("icp not found");
    const vector = await embed(icp.text);
    await ctx.runMutation(internal.icp.setVector, {
      icpId: args.icpId,
      vector,
    });
    return { dims: vector.length };
  },
});

// The cron's per-user entry point: the newest icp for an explicit owner.
export const latestForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.object({ _id: v.id("icp") }), v.null()),
  handler: async (ctx, args) => {
    const icp = await ctx.db
      .query("icp")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();
    return icp ? { _id: icp._id } : null;
  },
});

export const latest = query({
  args: {},
  returns: v.union(
    v.object({ _id: v.id("icp"), text: v.string(), hasVector: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const icp = await ctx.db
      .query("icp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    if (!icp) return null;
    return { _id: icp._id, text: icp.text, hasVector: !!icp.vector };
  },
});
