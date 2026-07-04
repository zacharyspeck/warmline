import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { promoteOrInsertLead } from "./ingest";
import { enforceCaptureRateLimit } from "./rateLimit";

// The browser extension captures one LinkedIn profile the signed-in user is
// viewing (a Lead) plus the mutual connections LinkedIn shows (the connectors
// on the warm path), and stores them in THAT user's graph. The owner is
// resolved by the HTTP layer from a scoped token (convex/http.ts,
// convex/extensionAuth.ts); there is no anonymous or demo write path.

// A mutual is a 1st-degree connection of the caller, so find them by slug or
// create them as a connector.
async function findOrCreateConnector(
  ctx: MutationCtx,
  userId: Id<"users">,
  slug: string,
  name: string,
): Promise<Id<"persons">> {
  const existing = await ctx.db
    .query("persons")
    .withIndex("by_user_and_linkedinUrl", (q) =>
      q.eq("userId", userId).eq("linkedinUrl", slug),
    )
    .first();
  if (existing) return existing._id;
  return await ctx.db.insert("persons", {
    userId,
    name,
    linkedinUrl: slug,
    isSelf: false,
    role: "connector",
    relationshipToYou: "connected",
  });
}

// Capture a profile + its mutuals for one owner. User-initiated only (the
// extension fires this on a click), server-side rate-limited per user, then
// schedules the same post-import pipeline (computeEdges + a rank pass under the
// existing reserves) that a LinkedIn import runs.
export const captureProfile = internalMutation({
  args: {
    userId: v.id("users"),
    leadSlug: v.string(),
    leadName: v.optional(v.string()),
    mutuals: v.array(v.object({ name: v.string(), slug: v.string() })),
  },
  returns: v.object({ edges: v.number(), leadSlug: v.string() }),
  handler: async (ctx, args) => {
    await enforceCaptureRateLimit(ctx, args.userId);

    // The profile person becomes a lead through the ingestLeads overlap rule:
    // promoted in place if the user already knows them, else inserted.
    const leadId = await promoteOrInsertLead(ctx, args.userId, {
      name: args.leadName ?? args.leadSlug,
      linkedinUrl: args.leadSlug,
    });

    let edges = 0;
    for (const m of args.mutuals) {
      if (!m.slug || m.slug === args.leadSlug) continue;
      const connectorId = await findOrCreateConnector(
        ctx,
        args.userId,
        m.slug,
        m.name || m.slug,
      );
      const fromEdges = await ctx.db
        .query("edges")
        .withIndex("by_from", (q) => q.eq("from", connectorId))
        .take(100);
      const dup = fromEdges.some(
        (e) => e.to === leadId && e.type === "linkedin_mutual",
      );
      if (dup) continue;
      await ctx.db.insert("edges", {
        userId: args.userId,
        from: connectorId,
        to: leadId,
        type: "linkedin_mutual",
        confidence: 0.9,
        evidence: "Mutual connection on LinkedIn",
      });
      edges++;
    }
    await ctx.db.patch(leadId, { mutualsStatus: "done" });

    // Recompute bridges + re-rank so the new lead and its warm paths appear.
    await ctx.scheduler.runAfter(0, internal.linkedinImport.afterImport, {
      userId: args.userId,
    });
    return { edges, leadSlug: args.leadSlug };
  },
});
