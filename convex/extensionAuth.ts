import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUser } from "./authz";

// Scoped access tokens for the browser extension. A signed-in user mints one
// from Settings; the raw token is shown ONCE and only its SHA-256 hash is
// stored. The extension sends the raw token as a Bearer header; the HTTP layer
// hashes it and resolves the owning user (see convex/http.ts), so every capture
// is stamped with that user and there is no anonymous or demo write path.

// SHA-256 hex of a string, via Web Crypto (available in the Convex action/HTTP
// runtime). Shared by the mint action and the capture route.
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Mint a fresh extension token for the caller (an action, so it can use crypto).
// Replaces any prior token, so minting again revokes the old one.
export const generateToken = action({
  args: {},
  returns: v.object({ token: v.string() }),
  handler: async (ctx): Promise<{ token: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const token =
      "wl_" +
      Array.from(raw)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    const tokenHash = await sha256Hex(token);
    await ctx.runMutation(internal.extensionAuth.storeToken, {
      userId,
      tokenHash,
    });
    return { token };
  },
});

export const storeToken = internalMutation({
  args: { userId: v.id("users"), tokenHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // One live token per user: drop any prior ones first.
    const prior = await ctx.db
      .query("extensionTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(20);
    for (const t of prior) await ctx.db.delete(t._id);
    await ctx.db.insert("extensionTokens", {
      userId: args.userId,
      tokenHash: args.tokenHash,
    });
    return null;
  },
});

// Resolve a token hash to its owner. Internal: only the HTTP capture route calls
// it, after hashing the incoming Bearer token.
export const resolveToken = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("extensionTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    return row?.userId ?? null;
  },
});

// Whether the caller has a live extension token (for the Settings card state).
// Never returns the token or its hash.
export const status = query({
  args: {},
  returns: v.object({ connected: v.boolean(), since: v.union(v.number(), v.null()) }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { connected: false, since: null };
    const row = await ctx.db
      .query("extensionTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return { connected: row !== null, since: row?._creationTime ?? null };
  },
});

// Disconnect the extension: drop the caller's token so it stops working.
export const revokeToken = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("extensionTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(20);
    for (const r of rows) await ctx.db.delete(r._id);
    return null;
  },
});
