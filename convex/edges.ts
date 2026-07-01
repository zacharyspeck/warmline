import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";

// Fiber kitchen-sink response: { output: { data: [{ experiences: [...], headline?: string }] } }
function extractCompanyFromFiber(raw: unknown): {
  company?: string;
  headline?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const output = r.output as Record<string, unknown> | undefined;
  const dataArr = output?.data;
  const person = Array.isArray(dataArr)
    ? (dataArr[0] as Record<string, unknown>)
    : undefined;
  if (!person) return {};

  const headline =
    typeof person.headline === "string" ? person.headline : undefined;

  const experiences = person.experiences;
  if (Array.isArray(experiences)) {
    for (const exp of experiences) {
      if (!exp || typeof exp !== "object") continue;
      const e = exp as Record<string, unknown>;
      if (!e.is_current) continue;
      const company =
        typeof e.company_name === "string" ? e.company_name : undefined;
      const title = typeof e.title === "string" ? e.title : undefined;
      if (company) return { company, headline: headline ?? title };
    }
  }

  return { headline };
}

// Backward-resolution: build connector→lead bridges from data we already have.
// v1 signal = shared_company (exact company match). X-mutual-follow / engagement
// edges come from Fiber actions later. Run via `computeEdges`.

// Only wipe ONE USER's shared_company edges — never the linkedin_mutual /
// x_mutual_follow / engagement edges (those come from the extension / Fiber and
// must survive recompute), and never another user's rows.
export const clearEdges = internalMutation({
  args: { userId: v.id("users") },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    let deleted = 0;
    const batch = await ctx.db
      .query("edges")
      .withIndex("by_user_and_type", (q) =>
        q.eq("userId", args.userId).eq("type", "shared_company"),
      )
      .take(500);
    for (const e of batch) {
      await ctx.db.delete(e._id);
      deleted++;
    }
    return { deleted };
  },
});

export const leadPage = internalQuery({
  args: { userId: v.id("users"), paginationOpts: paginationOptsValidator },
  returns: v.object({
    ids: v.array(v.id("persons")),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("persons")
      .withIndex("by_user_and_role", (q) =>
        q.eq("userId", args.userId).eq("role", "lead"),
      )
      .paginate(args.paginationOpts);
    return {
      ids: page.page.map((p) => p._id),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

// Link same-company connectors to one lead; returns the connector ids linked.
export const linkLeadEdges = internalMutation({
  args: { leadId: v.id("persons") },
  returns: v.array(v.id("persons")),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !lead.company || lead.userId === undefined) return [];
    if (/^stealth/i.test(lead.company)) return [];
    const owner = lead.userId;
    // Bridge only within the lead's owner's graph. Pull more than we need, since
    // leads/self at the same company would otherwise consume the cap before any
    // connector is reached.
    const sameCompany = await ctx.db
      .query("persons")
      .withIndex("by_user_and_company", (q) =>
        q.eq("userId", owner).eq("company", lead.company),
      )
      .take(200);
    const connectors = sameCompany
      .filter((c) => c.role === "connector" && !c.isSelf && c._id !== lead._id)
      .slice(0, 50);
    const linked: Id<"persons">[] = [];
    for (const c of connectors) {
      await ctx.db.insert("edges", {
        userId: owner,
        from: c._id,
        to: lead._id,
        type: "shared_company",
        confidence: 0.5,
        evidence: `${lead.company} colleague`,
      });
      linked.push(c._id);
    }
    return linked;
  },
});

export const setUnlockValues = internalMutation({
  args: {
    userId: v.id("users"),
    pairs: v.array(v.object({ id: v.id("persons"), count: v.number() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const { id, count } of args.pairs) {
      const p = await ctx.db.get(id);
      if (p && p.userId === args.userId)
        await ctx.db.patch(id, { unlockValue: count });
    }
    return null;
  },
});

// Fetch fresh company/headline for every connector of ONE user that has a
// LinkedIn slug, patch the DB, then recompute that user's shared_company edges.
export const refreshConnectorCompanies = internalAction({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  returns: v.object({ updated: v.number(), failed: v.number() }),
  handler: async (ctx, args) => {
    const apiKey = process.env.FIBER_API_KEY;
    if (!apiKey) throw new Error("FIBER_API_KEY not set");

    const connectors: { _id: Id<"persons">; linkedinUrl?: string }[] =
      await ctx.runQuery(internal.edges.connectorsWithSlug, {
        userId: args.userId,
        limit: 500,
      });

    let updated = 0;
    let failed = 0;

    for (const c of connectors) {
      if (!c.linkedinUrl) continue;
      try {
        const res = await fetch("https://api.fiber.ai/v1/kitchen-sink/person", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            profileIdentifier: {
              identifier: "linkedinSlug",
              value: c.linkedinUrl,
            },
          }),
        });
        if (!res.ok) {
          failed++;
          continue;
        }
        const { company, headline } = extractCompanyFromFiber(await res.json());
        if (company) {
          await ctx.runMutation(internal.edges.patchPerson, {
            id: c._id,
            userId: args.userId,
            company,
            headline,
          });
          updated++;
        }
      } catch {
        failed++;
      }
    }

    // recompute edges with fresh company data
    await ctx.runAction(internal.edges.computeEdges, { userId: args.userId });
    return { updated, failed };
  },
});

export const connectorsWithSlug = internalQuery({
  args: { userId: v.id("users"), limit: v.number() },
  returns: v.array(
    v.object({ _id: v.id("persons"), linkedinUrl: v.optional(v.string()) }),
  ),
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("persons")
      .withIndex("by_user_and_role", (q) =>
        q.eq("userId", args.userId).eq("role", "connector"),
      )
      .take(args.limit);
    return all
      .filter((p) => !!p.linkedinUrl)
      .map((p) => ({ _id: p._id, linkedinUrl: p.linkedinUrl }));
  },
});

export const patchPerson = internalMutation({
  args: {
    id: v.id("persons"),
    userId: v.id("users"),
    company: v.string(),
    headline: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.id);
    if (!p || p.userId !== args.userId) throw new Error("Person not found");
    const patch: Record<string, string> = { company: args.company };
    if (args.headline) patch.headline = args.headline;
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const computeEdges = internalAction({
  args: { userId: v.id("users") },
  returns: v.object({ leads: v.number(), edges: v.number() }),
  handler: async (ctx, args) => {
    // 1. wipe this user's existing edges (batched)
    for (;;) {
      const { deleted } = await ctx.runMutation(internal.edges.clearEdges, {
        userId: args.userId,
      });
      if (deleted === 0) break;
    }
    // 2. link same-company edges per lead, tallying connector unlock counts
    const unlock = new Map<Id<"persons">, number>();
    let leads = 0;
    let edges = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: {
        ids: Id<"persons">[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.edges.leadPage, {
        userId: args.userId,
        paginationOpts: { numItems: 100, cursor },
      });
      for (const leadId of page.ids) {
        const linked: Id<"persons">[] = await ctx.runMutation(
          internal.edges.linkLeadEdges,
          { leadId },
        );
        leads++;
        edges += linked.length;
        for (const id of linked) unlock.set(id, (unlock.get(id) ?? 0) + 1);
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    // 3. write unlock values in batches
    const entries = [...unlock.entries()].map(([id, count]) => ({ id, count }));
    for (let i = 0; i < entries.length; i += 200) {
      await ctx.runMutation(internal.edges.setUnlockValues, {
        userId: args.userId,
        pairs: entries.slice(i, i + 200),
      });
    }
    return { leads, edges };
  },
});
