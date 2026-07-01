import {
  mutation,
  query,
  action,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { embed } from "./openai";

const sourceValidator = v.object({
  website: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  x: v.optional(v.string()),
});

// Onboarding: store the ICP text (derived from the product site) + the 3 links
// + who the feed is for (individual vs company).
export const saveIcp = mutation({
  args: {
    userId: v.optional(v.id("users")),
    text: v.string(),
    source: sourceValidator,
    audience: v.optional(
      v.union(v.literal("individual"), v.literal("company")),
    ),
  },
  returns: v.id("icp"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("icp", {
      userId: args.userId,
      text: args.text,
      source: args.source,
      ...(args.audience ? { audience: args.audience } : {}),
    });
  },
});

export const get = internalQuery({
  args: { icpId: v.id("icp") },
  returns: v.union(
    v.object({ text: v.string(), hasVector: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const icp = await ctx.db.get(args.icpId);
    if (!icp) return null;
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

// Embed the ICP text into a vector (OpenAI). Run once after saveIcp.
export const embedIcp = action({
  args: { icpId: v.id("icp") },
  returns: v.object({ dims: v.number() }),
  handler: async (ctx, args) => {
    const icp = await ctx.runQuery(internal.icp.get, { icpId: args.icpId });
    if (!icp) throw new Error("icp not found");
    const vector = await embed(icp.text);
    await ctx.runMutation(internal.icp.setVector, {
      icpId: args.icpId,
      vector,
    });
    return { dims: vector.length };
  },
});

export const latest = query({
  args: {},
  returns: v.union(
    v.object({ _id: v.id("icp"), text: v.string(), hasVector: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx) => {
    const icp = await ctx.db.query("icp").order("desc").first();
    if (!icp) return null;
    return { _id: icp._id, text: icp.text, hasVector: !!icp.vector };
  },
});
