import { query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { DEMO_EMAIL } from "./devSeed";
import { feedForUser, feedRow } from "./feed";
import { pathForPersonOwned, pathResult } from "./graph";

// The logged-out demo surface: what a signed-out visitor on the landing page
// sees. Read-only by design — this file registers ONLY queries, and none of
// them accepts an owner or user id of any kind: the owner is always the demo
// account, resolved server-side by its email through the authTables `email`
// index. Demo content changes only through the daily cron (crons.dailyRefresh
// covers the demo account like any other user) and internal admin loaders
// (devSeed.seedNetwork, seedDemo.loadDemo) — never through this surface.

const DEMO_FEED_LIMIT = 40;

async function demoOwner(ctx: QueryCtx): Promise<Id<"users"> | null> {
  const demo = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", DEMO_EMAIL))
    .first();
  return demo?._id ?? null;
}

// The demo account's feed, exactly as feed.list would render it for the demo
// user. Empty when the demo account doesn't exist yet.
export const feed = query({
  args: {},
  returns: v.array(feedRow),
  handler: async (ctx) => {
    const demoId = await demoOwner(ctx);
    if (demoId === null) return [];
    return await feedForUser(ctx, demoId, DEMO_FEED_LIMIT);
  },
});

// Warm-path graph for one demo person. A personId outside the demo account's
// graph — e.g. a real user's person id — is denied exactly like a cross-user
// lookup on graph.pathForPerson.
export const pathForPerson = query({
  args: { personId: v.id("persons") },
  returns: pathResult,
  handler: async (ctx, args) => {
    const demoId = await demoOwner(ctx);
    if (demoId === null) throw new Error("Person not found");
    return await pathForPersonOwned(ctx, demoId, args.personId);
  },
});
