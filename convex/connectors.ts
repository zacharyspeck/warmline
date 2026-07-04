import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { connectorMethod, connectorProvider } from "./schema";

// All connectors the current user has linked. Empty when signed out.
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("connectors"),
      _creationTime: v.number(),
      userId: v.id("users"),
      provider: connectorProvider,
      method: connectorMethod,
      status: v.literal("active"),
      label: v.string(),
      accountEmail: v.optional(v.string()),
      fileName: v.optional(v.string()),
      storageId: v.optional(v.id("_storage")),
      contactCount: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("connectors")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

// Short-lived URL the client POSTs a manual export file to before recording it.
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// Record a manual / automatic data export. One source per provider, so a new
// upload replaces the previous one for that provider.
export const recordUpload = mutation({
  args: {
    provider: connectorProvider,
    method: connectorMethod,
    label: v.string(),
    fileName: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
  },
  returns: v.id("connectors"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("connectors")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", args.provider),
      )
      .collect();
    for (const c of existing) {
      if (c.storageId) await ctx.storage.delete(c.storageId);
      await ctx.db.delete(c._id);
    }
    return await ctx.db.insert("connectors", {
      userId,
      provider: args.provider,
      method: args.method,
      status: "active",
      label: args.label,
      fileName: args.fileName,
      storageId: args.storageId,
    });
  },
});

// Remove a linked connector (the user owns it, or the call is rejected).
export const disconnect = mutation({
  args: { id: v.id("connectors") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const doc = await ctx.db.get("connectors", args.id);
    if (doc === null || doc.userId !== userId) {
      throw new Error("Connector not found");
    }
    if (doc.storageId) await ctx.storage.delete(doc.storageId);
    await ctx.db.delete(args.id);
    return null;
  },
});

async function requireUser(ctx: MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not signed in");
  return userId;
}
