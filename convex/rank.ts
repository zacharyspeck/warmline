import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { embed, judge } from "./openai";
import {
  cosine,
  reachability,
  feedScore,
  introScore,
  nudgeVector,
} from "./lib";

const CANDIDATE_LIMIT = 120;
const DEFAULT_JUDGE_TOP_N = 12;
// How hard thumbs bend the ICP vector on each rank run. Bounded step in [0,1];
// small so a few votes tilt the ranking without overwhelming the goal-fit.
const VOTE_NUDGE = 0.15;

// One read with everything the ranker needs: icp + candidate leads + their vectors.
export const rankData = internalQuery({
  args: { icpId: v.id("icp") },
  returns: v.union(
    v.object({
      icpText: v.string(),
      icpVector: v.union(v.array(v.number()), v.null()),
      leads: v.array(
        v.object({
          id: v.id("persons"),
          name: v.string(),
          headline: v.union(v.string(), v.null()),
          company: v.union(v.string(), v.null()),
          relationshipToYou: v.union(
            v.literal("connected"),
            v.literal("not_connected"),
          ),
          tieStrength: v.union(v.number(), v.null()),
          vector: v.union(v.array(v.number()), v.null()),
          bestIntro: v.number(), // max intro_score over this lead's connector edges
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const icp = await ctx.db.get(args.icpId);
    // The icp row carries the owner; candidates come only from that user's graph.
    if (!icp || icp.userId === undefined) return null;
    const owner = icp.userId;
    const leadDocs = await ctx.db
      .query("persons")
      .withIndex("by_user_and_role", (q) =>
        q.eq("userId", owner).eq("role", "lead"),
      )
      .take(CANDIDATE_LIMIT);
    const leads = [];
    for (const p of leadDocs) {
      const vec = await ctx.db
        .query("personVectors")
        .withIndex("by_person", (q) => q.eq("personId", p._id))
        .first();
      // best connector path into this lead → drives warm-reachability
      const edges = await ctx.db
        .query("edges")
        .withIndex("by_to", (q) => q.eq("to", p._id))
        .take(25);
      let bestIntro = 0;
      for (const e of edges) {
        if (e.userId !== owner) continue;
        const c = await ctx.db.get(e.from);
        if (!c || c.userId !== owner) continue;
        const s = introScore(c.tieStrength ?? 0, e.confidence);
        if (s > bestIntro) bestIntro = s;
      }
      leads.push({
        id: p._id,
        name: p.name,
        headline: p.headline ?? null,
        company: p.company ?? null,
        relationshipToYou: p.relationshipToYou,
        tieStrength: p.tieStrength ?? null,
        vector: vec?.embedding ?? null,
        bestIntro,
      });
    }
    return { icpText: icp.text, icpVector: icp.vector ?? null, leads };
  },
});

// The ICP's thumbs, joined to already-cached person embeddings. No OpenAI calls:
// people without a cached vector are skipped. Feeds the nudge in `rebuild`.
export const voteVectors = internalQuery({
  args: { icpId: v.id("icp") },
  returns: v.object({
    up: v.array(v.array(v.number())),
    down: v.array(v.array(v.number())),
  }),
  handler: async (ctx, args) => {
    const up: number[][] = [];
    const down: number[][] = [];
    const icp = await ctx.db.get(args.icpId);
    if (!icp || icp.userId === undefined) return { up, down };
    const owner = icp.userId;
    const votes = await ctx.db
      .query("feedback")
      .withIndex("by_icp", (q) => q.eq("icpId", args.icpId))
      .take(500);
    for (const f of votes) {
      // feedback is scoped through its icp; skip any row whose person the icp
      // owner doesn't own (defense against directly inserted rows).
      const person = await ctx.db.get(f.personId);
      if (!person || person.userId !== owner) continue;
      const vec = await ctx.db
        .query("personVectors")
        .withIndex("by_person", (q) => q.eq("personId", f.personId))
        .first();
      if (!vec) continue;
      (f.vote === "up" ? up : down).push(vec.embedding);
    }
    return { up, down };
  },
});

export const upsertVector = internalMutation({
  args: { personId: v.id("persons"), embedding: v.array(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("personVectors")
      .withIndex("by_person", (q) => q.eq("personId", args.personId))
      .first();
    if (existing)
      await ctx.db.patch(existing._id, { embedding: args.embedding });
    else
      await ctx.db.insert("personVectors", {
        personId: args.personId,
        embedding: args.embedding,
      });
    return null;
  },
});

// Top connectors that bridge to a lead, ranked by intro_score.
export const connectorsForLead = internalQuery({
  args: { leadId: v.id("persons") },
  returns: v.array(
    v.object({
      id: v.id("persons"),
      name: v.string(),
      tieStrength: v.union(v.number(), v.null()),
      confidence: v.number(),
      evidence: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId === undefined) return [];
    const owner = lead.userId;
    const edges = await ctx.db
      .query("edges")
      .withIndex("by_to", (q) => q.eq("to", args.leadId))
      .take(50);
    const out = [];
    for (const e of edges) {
      if (e.userId !== owner) continue;
      const c = await ctx.db.get(e.from);
      if (!c || c.userId !== owner) continue;
      out.push({
        id: c._id,
        name: c.name,
        tieStrength: c.tieStrength ?? null,
        confidence: e.confidence,
        evidence: e.evidence,
      });
    }
    out.sort(
      (a, b) =>
        introScore(b.tieStrength ?? 0, b.confidence) -
        introScore(a.tieStrength ?? 0, a.confidence),
    );
    return out.slice(0, 3);
  },
});

export const writeRecommendation = internalMutation({
  args: {
    icpId: v.id("icp"),
    personId: v.id("persons"),
    score: v.number(),
    whyBullets: v.array(
      v.object({
        text: v.string(),
        confidence: v.number(),
      }),
    ),
    how: v.array(v.string()),
    opener: v.string(),
    unlocksIds: v.array(v.id("persons")),
  },
  returns: v.id("recommendations"),
  handler: async (ctx, args) => {
    // Recommendations inherit the icp's owner; a person outside that owner's
    // graph can never be written into their feed.
    const icp = await ctx.db.get(args.icpId);
    if (!icp || icp.userId === undefined) throw new Error("icp not found");
    const person = await ctx.db.get(args.personId);
    if (!person || person.userId !== icp.userId)
      throw new Error("person not found");
    const existing = await ctx.db
      .query("recommendations")
      .withIndex("by_person", (q) => q.eq("personId", args.personId))
      .take(20);
    for (const r of existing) {
      if (r.icpId === args.icpId) await ctx.db.delete(r._id);
    }
    return await ctx.db.insert("recommendations", {
      userId: icp.userId,
      personId: args.personId,
      icpId: args.icpId,
      kind: "lead",
      score: args.score,
      whyBullets: args.whyBullets,
      how: args.how,
      opener: args.opener,
      unlocksIds: args.unlocksIds,
    });
  },
});

const confNum = (c: "high" | "medium" | "low") =>
  c === "high" ? 0.9 : c === "medium" ? 0.6 : 0.3;

// The ranking pipeline: embed → goal-fit × reachability → judge top N → write recs.
export const rebuild = internalAction({
  args: { icpId: v.id("icp"), judgeTopN: v.optional(v.number()) },
  returns: v.object({ scored: v.number(), judged: v.number() }),
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.rank.rankData, {
      icpId: args.icpId,
    });
    if (!data) throw new Error("icp not found");

    // ensure ICP vector
    let icpVector = data.icpVector;
    if (!icpVector) {
      icpVector = await embed(data.icpText);
      await ctx.runMutation(internal.icp.setVector, {
        icpId: args.icpId,
        vector: icpVector,
      });
    }

    // Bend the ICP vector by this ICP's thumbs (toward up-votes, away from
    // down-votes) using cached person vectors. This is a per-run scoring vector,
    // not persisted — icp.vector stays the derived baseline. The shift lands on
    // THIS run, which is why votes reshape the feed on the next rank, not on click.
    const { up, down } = await ctx.runQuery(internal.rank.voteVectors, {
      icpId: args.icpId,
    });
    const scoringVector =
      up.length || down.length
        ? nudgeVector(icpVector, up, down, VOTE_NUDGE)
        : icpVector;

    // score each candidate; embed leads missing a vector
    const scored: {
      id: Id<"persons">;
      name: string;
      headline: string | null;
      company: string | null;
      score: number;
    }[] = [];
    for (const lead of data.leads) {
      let vec = lead.vector;
      if (!vec) {
        const text = [lead.name, lead.headline, lead.company]
          .filter(Boolean)
          .join(" — ");
        vec = await embed(text);
        await ctx.runMutation(internal.rank.upsertVector, {
          personId: lead.id,
          embedding: vec,
        });
      }
      const goalFit = (cosine(vec, scoringVector) + 1) / 2; // [-1,1] → [0,1]
      // Warm-reachability = the best connector path into this lead (the whole
      // point), or directness if you happen to already know them.
      const reach = Math.max(
        reachability(lead.relationshipToYou, lead.tieStrength ?? undefined),
        lead.bestIntro,
      );
      scored.push({
        id: lead.id,
        name: lead.name,
        headline: lead.headline,
        company: lead.company,
        score: feedScore(goalFit, reach),
      });
    }
    scored.sort((a, b) => b.score - a.score);

    // judge the top N
    const topN = args.judgeTopN ?? DEFAULT_JUDGE_TOP_N;
    const top = scored.slice(0, topN);
    let judged = 0;
    for (const lead of top) {
      const connectors = await ctx.runQuery(internal.rank.connectorsForLead, {
        leadId: lead.id,
      });
      const j = await judge({
        icpText: data.icpText,
        person: {
          name: lead.name,
          headline: lead.headline ?? undefined,
          company: lead.company ?? undefined,
        },
        connectors: connectors.map((c) => ({
          name: c.name,
          evidence: c.evidence,
        })),
      });
      await ctx.runMutation(internal.rank.writeRecommendation, {
        icpId: args.icpId,
        personId: lead.id,
        score: lead.score,
        whyBullets: j.why.map((w) => ({
          text: w.text,
          confidence: confNum(w.confidence),
        })),
        how: j.how,
        opener: j.opener,
        unlocksIds: [],
      });
      judged++;
    }
    return { scored: scored.length, judged };
  },
});
