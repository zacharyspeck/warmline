import { query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { introScore } from "./lib";
import { requireUser } from "./authz";

// React-Flow-ready warm-path data for one person.
//
//  • LEAD      → paths-in:  You → top Connector(s) → Lead
//  • CONNECTOR → fan-out:   You → Connector → [Leads they unlock]
//
// Connectors for a Lead are the best 1–3 mutuals by intro_score
// (your tie strength × how well they know the Lead — see lib.introScore).
// Consumed by components/warm-graph.tsx.

const youValidator = v.object({
  id: v.optional(v.id("persons")),
  name: v.string(),
  avatarUrl: v.optional(v.string()),
});

const nodeRef = v.object({
  id: v.id("persons"),
  name: v.string(),
  avatarUrl: v.optional(v.string()),
});

const connectorRef = v.object({
  id: v.id("persons"),
  name: v.string(),
  avatarUrl: v.optional(v.string()),
  evidence: v.string(),
  confidence: v.number(),
});

// Shared with demo.pathForPerson, which returns the same shape for the demo graph.
export const pathResult = v.union(
  v.object({
    kind: v.literal("lead"),
    you: youValidator,
    connectors: v.array(connectorRef),
    target: nodeRef,
  }),
  v.object({
    kind: v.literal("connector"),
    you: youValidator,
    connector: nodeRef,
    unlocks: v.array(nodeRef),
  }),
);

type You = { id?: Id<"persons">; name: string; avatarUrl?: string };

type PathResult =
  | {
      kind: "lead";
      you: You;
      connectors: {
        id: Id<"persons">;
        name: string;
        avatarUrl?: string;
        evidence: string;
        confidence: number;
      }[];
      target: { id: Id<"persons">; name: string; avatarUrl?: string };
    }
  | {
      kind: "connector";
      you: You;
      connector: { id: Id<"persons">; name: string; avatarUrl?: string };
      unlocks: { id: Id<"persons">; name: string; avatarUrl?: string }[];
    };

// Best-effort lookup of "You" (the graph origin). Self is always created with
// role "connector" (ingest.ingestSelf) and there is no isSelf index, so scan a
// bounded slice of connectors. Falls back to a generic origin node.
async function findYou(ctx: QueryCtx, userId: Id<"users">): Promise<You> {
  const connectors = await ctx.db
    .query("persons")
    .withIndex("by_user_and_role", (q) =>
      q.eq("userId", userId).eq("role", "connector"),
    )
    .take(500);
  const self = connectors.find((p) => p.isSelf);
  return self
    ? { id: self._id, name: self.name, avatarUrl: self.avatarUrl }
    : { name: "You" };
}

// The warm path for one person inside ONE explicit owner's graph. Callers pin
// the owner: the public query passes the caller, demo.pathForPerson passes the
// demo account. A personId outside that owner's graph is denied outright.
export async function pathForPersonOwned(
  ctx: QueryCtx,
  userId: Id<"users">,
  personId: Id<"persons">,
): Promise<PathResult> {
  const person = await ctx.db.get(personId);
  // Deny a direct id lookup across users.
  if (!person || person.userId !== userId) throw new Error("Person not found");
  const you = await findYou(ctx, userId);

  if (person.role === "lead") {
    // Top connectors bridging You → Lead, ranked by intro_score.
    const edges = await ctx.db
      .query("edges")
      .withIndex("by_to", (q) => q.eq("to", person._id))
      .take(50);
    const scored: {
      id: Id<"persons">;
      name: string;
      avatarUrl?: string;
      evidence: string;
      confidence: number;
      score: number;
    }[] = [];
    for (const e of edges) {
      const c = await ctx.db.get(e.from);
      if (!c || c.userId !== userId) continue;
      scored.push({
        id: c._id,
        name: c.name,
        avatarUrl: c.avatarUrl,
        evidence: e.evidence,
        confidence: e.confidence,
        score: introScore(c.tieStrength, e.confidence),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    // Dedup by connector, keeping the highest-scoring edge; take top 3.
    const seen = new Set<Id<"persons">>();
    const connectors: {
      id: Id<"persons">;
      name: string;
      avatarUrl?: string;
      evidence: string;
      confidence: number;
    }[] = [];
    for (const s of scored) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      connectors.push({
        id: s.id,
        name: s.name,
        avatarUrl: s.avatarUrl,
        evidence: s.evidence,
        confidence: s.confidence,
      });
      if (connectors.length === 3) break;
    }
    return {
      kind: "lead" as const,
      you,
      connectors,
      target: { id: person._id, name: person.name, avatarUrl: person.avatarUrl },
    };
  }

  // Connector: fan-out to the Leads they unlock (up to 12 nodes).
  const edges = await ctx.db
    .query("edges")
    .withIndex("by_from", (q) => q.eq("from", person._id))
    .take(50);
  const seen = new Set<Id<"persons">>();
  const unlocks: { id: Id<"persons">; name: string; avatarUrl?: string }[] = [];
  for (const e of edges) {
    if (seen.has(e.to)) continue;
    seen.add(e.to);
    const lead = await ctx.db.get(e.to);
    if (!lead || lead.userId !== userId || lead.role !== "lead") continue;
    unlocks.push({ id: lead._id, name: lead.name, avatarUrl: lead.avatarUrl });
    if (unlocks.length === 12) break;
  }
  return {
    kind: "connector" as const,
    you,
    connector: { id: person._id, name: person.name, avatarUrl: person.avatarUrl },
    unlocks,
  };
}

export const pathForPerson = query({
  args: { personId: v.id("persons") },
  returns: pathResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return await pathForPersonOwned(ctx, userId, args.personId);
  },
});
