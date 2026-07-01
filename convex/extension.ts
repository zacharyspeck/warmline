import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";

// Receives mutual connections read off a Lead's LinkedIn profile by the browser
// extension, and stores them as linkedin_mutual edges (connector → lead) in ONE
// user's graph. The owner is resolved by the HTTP layer (convex/http.ts): the
// authenticated user when the extension sends a JWT, else the demo account.

async function findOrCreate(
  ctx: MutationCtx,
  userId: Id<"users">,
  slug: string,
  name: string,
  role: "lead" | "connector",
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
    role,
    relationshipToYou: role === "connector" ? "connected" : "not_connected",
  });
}

export const ingestMutuals = internalMutation({
  args: {
    userId: v.id("users"),
    leadSlug: v.string(),
    leadName: v.optional(v.string()),
    mutuals: v.array(v.object({ name: v.string(), slug: v.string() })),
  },
  returns: v.object({ edges: v.number() }),
  handler: async (ctx, args) => {
    const leadId = await findOrCreate(
      ctx,
      args.userId,
      args.leadSlug,
      args.leadName ?? args.leadSlug,
      "lead",
    );
    let edges = 0;
    for (const m of args.mutuals) {
      if (!m.slug) continue;
      const connectorId = await findOrCreate(
        ctx,
        args.userId,
        m.slug,
        m.name,
        "connector",
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
    return { edges };
  },
});

// One crawl batch of the owner's leads still missing mutuals. Iterates the
// index and skips "done" rows as it goes (a take-then-filter would stop seeing
// pending leads once the oldest rows are all done); the extension drains the
// batch, re-fetches, and eventually reaches every pending lead.
export const pendingLeads = internalQuery({
  args: { userId: v.id("users") },
  returns: v.array(v.object({ slug: v.string(), name: v.string() })),
  handler: async (ctx, args) => {
    const out: { slug: string; name: string }[] = [];
    const leads = ctx.db
      .query("persons")
      .withIndex("by_user_and_role", (q) =>
        q.eq("userId", args.userId).eq("role", "lead"),
      );
    for await (const p of leads) {
      if (p.mutualsStatus === "done" || !p.linkedinUrl) continue;
      out.push({ slug: p.linkedinUrl, name: p.name });
      if (out.length >= 200) break;
    }
    return out;
  },
});
