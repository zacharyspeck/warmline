import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Id, Doc } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { promoteOrInsertLead } from "./ingest";
import { enforceCaptureRateLimit } from "./rateLimit";

// The browser extension captures one LinkedIn profile the signed-in user is
// viewing (a Lead) plus the mutual connections LinkedIn shows (the connectors
// on the warm path), and stores them in THAT user's graph. The owner is
// resolved by the HTTP layer from a scoped token (convex/http.ts,
// convex/extensionAuth.ts); there is no anonymous or demo write path.

// A slug-bearing mutual is identified precisely: find them by slug or create
// them as a connector, filling a headline if the results page had one.
async function findOrCreateConnector(
  ctx: MutationCtx,
  userId: Id<"users">,
  slug: string,
  name: string,
  headline: string | undefined,
): Promise<Id<"persons">> {
  const existing = await ctx.db
    .query("persons")
    .withIndex("by_user_and_linkedinUrl", (q) =>
      q.eq("userId", userId).eq("linkedinUrl", slug),
    )
    .first();
  if (existing) {
    if (headline && !existing.headline) {
      await ctx.db.patch(existing._id, { headline });
    }
    return existing._id;
  }
  return await ctx.db.insert("persons", {
    userId,
    name,
    linkedinUrl: slug,
    headline,
    isSelf: false,
    role: "connector",
    relationshipToYou: "connected",
  });
}

// How many of the caller's connectors to load for name-only matching. A
// personal LinkedIn network fits well under this; a single capture builds the
// map once, so reads stay bounded.
const CONNECTOR_MATCH_CAP = 3000;

type NameMap = {
  full: Map<string, Id<"persons">[]>;
  first: Map<string, Id<"persons">[]>;
};

async function buildConnectorNameMap(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<NameMap> {
  const full = new Map<string, Id<"persons">[]>();
  const first = new Map<string, Id<"persons">[]>();
  const push = (m: Map<string, Id<"persons">[]>, k: string, id: Id<"persons">) => {
    const arr = m.get(k);
    if (arr) arr.push(id);
    else m.set(k, [id]);
  };
  const connectors = await ctx.db
    .query("persons")
    .withIndex("by_user_and_role", (q) =>
      q.eq("userId", userId).eq("role", "connector"),
    )
    .take(CONNECTOR_MATCH_CAP);
  for (const c of connectors) {
    if (c.isSelf) continue;
    const n = c.name.trim().toLowerCase();
    if (!n) continue;
    push(full, n, c._id);
    push(first, n.split(/\s+/)[0], c._id);
  }
  return { full, first };
}

// Resolve a name-only mutual against existing connectors: an exact full-name
// match when it is unique, else a first-name match only when exactly one
// connector matches. Ambiguous names resolve to null (skipped).
function resolveByName(map: NameMap, name: string): Id<"persons"> | null {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  const exact = map.full.get(target) ?? [];
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const byFirst = map.first.get(target.split(/\s+/)[0]) ?? [];
  return byFirst.length === 1 ? byFirst[0] : null;
}

// Capture a profile + its mutuals for one owner. User-initiated only (the
// extension fires this on a click), server-side rate-limited per user. Mutuals
// arrive slug-bearing (from /in/ links or the results page) or name-only (the
// named-inline "A and B are mutual connections" variant); name-only ones are
// matched against existing connectors. Then it schedules the same post-import
// pipeline (computeEdges + a rank pass under the existing reserves) an import
// runs. Returns shown/matched/skipped so the popup can never report a silent 0.
export const captureProfile = internalMutation({
  args: {
    userId: v.id("users"),
    leadSlug: v.string(),
    leadName: v.optional(v.string()),
    mutuals: v.array(
      v.object({
        name: v.string(),
        slug: v.optional(v.string()),
        headline: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    edges: v.number(),
    shown: v.number(),
    matched: v.number(),
    skipped: v.number(),
    leadSlug: v.string(),
  }),
  handler: async (ctx, args) => {
    await enforceCaptureRateLimit(ctx, args.userId);

    // The profile person becomes a lead through the ingestLeads overlap rule.
    const leadId = await promoteOrInsertLead(ctx, args.userId, {
      name: args.leadName ?? args.leadSlug,
      linkedinUrl: args.leadSlug,
    });

    const nameOnly = args.mutuals.some((m) => !m.slug && m.name);
    const nameMap = nameOnly
      ? await buildConnectorNameMap(ctx, args.userId)
      : null;

    let shown = 0;
    let matched = 0;
    let skipped = 0;
    let edges = 0;
    const linkedTo = new Set<Id<"persons">>();
    for (const m of args.mutuals) {
      if (!m.name && !m.slug) continue; // empty entry
      if (m.slug && m.slug === args.leadSlug) continue; // the lead itself
      shown++;

      let connectorId: Id<"persons"> | null = null;
      if (m.slug) {
        connectorId = await findOrCreateConnector(
          ctx,
          args.userId,
          m.slug,
          m.name || m.slug,
          m.headline,
        );
      } else if (nameMap) {
        connectorId = resolveByName(nameMap, m.name);
      }
      if (!connectorId) {
        skipped++;
        continue;
      }
      matched++;
      if (linkedTo.has(connectorId)) continue; // same connector twice in one payload
      linkedTo.add(connectorId);

      const fromEdges = await ctx.db
        .query("edges")
        .withIndex("by_from", (q) => q.eq("from", connectorId))
        .take(100);
      const dup = fromEdges.some(
        (e: Doc<"edges">) => e.to === leadId && e.type === "linkedin_mutual",
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
    return { edges, shown, matched, skipped, leadSlug: args.leadSlug };
  },
});
