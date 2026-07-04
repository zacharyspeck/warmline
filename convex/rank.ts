import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { embed, judge, draftReconnectOpener } from "./openai";
import {
  EMBED_RESERVE_CHUNK,
  RANK_EMBEDS_PER_RUN,
  CONNECTOR_OPENERS_PER_RUN,
} from "./limits";
import {
  cosine,
  reachability,
  feedScore,
  introScore,
  nudgeVector,
  goalEmbedText,
} from "./lib";

const CANDIDATE_LIMIT = 120;
const DEFAULT_JUDGE_TOP_N = 12;
// How many connector recommendations a zero-lead rank keeps. Covers the home
// feed's read (limit 40 → take 80 recs) with headroom; the rest of the
// connectors stay on the feed's tieStrength fallback.
const CONNECTOR_REC_LIMIT = 100;
// How hard thumbs bend the ICP vector on each rank run. Bounded step in [0,1];
// small so a few votes tilt the ranking without overwhelming the goal-fit.
const VOTE_NUDGE = 0.15;
// Scores closer than this count as "unchanged" for skipUnchanged. Scoring is
// deterministic when nothing moved, so this only papers over float noise.
const SCORE_EPSILON = 0.5;

// One read with everything the ranker needs: icp + candidate leads + their vectors.
export const rankData = internalQuery({
  args: { icpId: v.id("icp") },
  returns: v.union(
    v.object({
      owner: v.id("users"),
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
    if (!icp) return null;
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
    return {
      owner,
      // The Goals editor's structured targets steer the vector and the judge;
      // the header still shows the bare statement (api.icp.latest.text).
      icpText: goalEmbedText(icp.text, icp.targets),
      icpVector: icp.vector ?? null,
      leads,
    };
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
    if (!icp) return { up, down };
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

// One page of a user's connectors, each scored against the caller-supplied
// scoring vector — the zero-lead rank walks EVERY connector this way
// (bounded reads per call), so large imports rank progressively instead of
// stopping at a candidate cap. The cosine happens HERE so the cached
// 1536-float vectors never leave the database (a 20k network would
// otherwise ship ~250 MB of embeddings to the action per run).
export const connectorPage = internalQuery({
  args: {
    userId: v.id("users"),
    scoringVector: v.union(v.array(v.number()), v.null()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    connectors: v.array(
      v.object({
        id: v.id("persons"),
        name: v.string(),
        headline: v.union(v.string(), v.null()),
        company: v.union(v.string(), v.null()),
        tieStrength: v.union(v.number(), v.null()),
        // null when unembedded OR no scoring vector was supplied.
        score: v.union(v.number(), v.null()),
        hasVector: v.boolean(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("persons")
      .withIndex("by_user_and_role", (q) =>
        q.eq("userId", args.userId).eq("role", "connector"),
      )
      .paginate(args.paginationOpts);
    const connectors = [];
    for (const p of page.page) {
      if (p.isSelf) continue;
      const vec = await ctx.db
        .query("personVectors")
        .withIndex("by_person", (q) => q.eq("personId", p._id))
        .first();
      const score =
        vec && args.scoringVector
          ? feedScore(
              (cosine(vec.embedding, args.scoringVector) + 1) / 2,
              reachability("connected", p.tieStrength ?? undefined),
            )
          : null;
      connectors.push({
        id: p._id,
        name: p.name,
        headline: p.headline ?? null,
        company: p.company ?? null,
        tieStrength: p.tieStrength ?? null,
        score,
        hasVector: vec !== null,
      });
    }
    return {
      connectors,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

// Swap this icp's connector recommendations in ONE transaction: wipe the old
// set, insert the new. The feed never observes a half-written mix. Every
// person is re-checked against the icp's owner, mirroring writeRecommendation.
export const replaceConnectorRecs = internalMutation({
  args: {
    icpId: v.id("icp"),
    recs: v.array(
      v.object({
        personId: v.id("persons"),
        score: v.number(),
        whyBullets: v.array(
          v.object({ text: v.string(), confidence: v.number() }),
        ),
        how: v.array(v.string()),
        opener: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const icp = await ctx.db.get(args.icpId);
    if (!icp) throw new Error("icp not found");
    for (;;) {
      const batch = await ctx.db
        .query("recommendations")
        .withIndex("by_icp_and_kind", (q) =>
          q.eq("icpId", args.icpId).eq("kind", "connector"),
        )
        .take(500);
      for (const r of batch) await ctx.db.delete(r._id);
      if (batch.length < 500) break;
    }
    // Re-check zero-leads INSIDE the transaction: the rank action decided on
    // a snapshot that can be minutes old (pagination + embeds), and leads
    // gained meanwhile must not end up drowned under connector recs.
    if (args.recs.length > 0) {
      const leadSample = await ctx.db
        .query("persons")
        .withIndex("by_user_and_role", (q) =>
          q.eq("userId", icp.userId).eq("role", "lead"),
        )
        .take(5);
      if (leadSample.some((p) => !p.isSelf)) return null;
    }
    for (const rec of args.recs) {
      const person = await ctx.db.get(rec.personId);
      if (
        !person ||
        person.userId !== icp.userId ||
        person.role !== "connector" ||
        person.isSelf
      )
        continue;
      await ctx.db.insert("recommendations", {
        userId: icp.userId,
        personId: rec.personId,
        icpId: args.icpId,
        kind: "connector",
        score: rec.score,
        whyBullets: rec.whyBullets,
        how: rec.how,
        opener: rec.opener,
        unlocksIds: [],
        judged: false,
      });
    }
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
    if (!lead) return [];
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

// This icp's current recommendations, keyed by person — lets the cron judge
// only NEW or CHANGED rows, and lets a capped run keep a row's existing copy.
export const existingRecs = internalQuery({
  args: { icpId: v.id("icp") },
  returns: v.array(
    v.object({
      personId: v.id("persons"),
      score: v.number(),
      judged: v.boolean(),
      whyBullets: v.array(
        v.object({ text: v.string(), confidence: v.number() }),
      ),
      how: v.array(v.string()),
      opener: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const recs = await ctx.db
      .query("recommendations")
      .withIndex("by_icp_and_score", (q) => q.eq("icpId", args.icpId))
      .take(200);
    return recs.map((r) => ({
      personId: r.personId,
      score: r.score,
      judged: r.judged ?? false,
      whyBullets: r.whyBullets,
      how: r.how,
      opener: r.opener,
    }));
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
    // True only when why/how/opener came from the judge AT this score; absent
    // or false marks heuristic/carried-over copy the cron may re-judge.
    judged: v.optional(v.boolean()),
  },
  returns: v.id("recommendations"),
  handler: async (ctx, args) => {
    // Recommendations inherit the icp's owner; a person outside that owner's
    // graph can never be written into their feed.
    const icp = await ctx.db.get(args.icpId);
    if (!icp) throw new Error("icp not found");
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
      judged: args.judged ?? false,
    });
  },
});

const confNum = (c: "high" | "medium" | "low") =>
  c === "high" ? 0.9 : c === "medium" ? 0.6 : 0.3;

// Degraded copy for a capped judge slot: plain heuristic why/how built from
// the lead's own fields, mirroring the feed's fallback style (no em dashes,
// no trailing periods).
function heuristicCopy(lead: {
  headline: string | null;
  company: string | null;
  relationshipToYou: "connected" | "not_connected";
}): { whyBullets: { text: string; confidence: number }[]; how: string[] } {
  const whyBullets: { text: string; confidence: number }[] = [];
  const facts = [lead.headline, lead.company].filter(Boolean).join(" · ");
  if (facts) whyBullets.push({ text: facts, confidence: 0.9 });
  whyBullets.push({
    text:
      lead.relationshipToYou === "connected"
        ? "Already in your network"
        : "Reachable through a warm intro",
    confidence: 0.6,
  });
  const how =
    lead.relationshipToYou === "connected"
      ? ["Reach out directly via LinkedIn or email"]
      : ["Ask a mutual connection for a warm intro"];
  return { whyBullets, how };
}

// Heuristic why/how for a connector recommendation (zero-lead mode never
// judges — connectors get the same degraded-copy style as a capped lead).
function connectorCopy(c: {
  name: string;
  headline: string | null;
  company: string | null;
}): { whyBullets: { text: string; confidence: number }[]; how: string[] } {
  const whyBullets: { text: string; confidence: number }[] = [];
  const facts = [c.headline, c.company].filter(Boolean).join(" · ");
  if (facts) whyBullets.push({ text: facts, confidence: 0.9 });
  whyBullets.push({ text: "Already in your network", confidence: 0.6 });
  const first = c.name.split(" ")[0];
  const domain = c.company ? `in ${c.company}'s network` : "in their network";
  return {
    whyBullets,
    how: [
      `Reconnect with ${first} and share who you're trying to reach`,
      `Ask if they know any founders or PMs ${domain} who fit your ICP`,
    ],
  };
}

type ScoredConnector = {
  id: Id<"persons">;
  name: string;
  headline: string | null;
  company: string | null;
  score: number;
};

// Zero-lead rank: score EVERY connector by goal fit against the ICP vector,
// embedding only the ones without a cached vector under ONE batched embed
// reserve (warmest ties first, so a short grant covers the most valuable
// people). Whoever stays unembedded keeps no recommendation and rides the
// feed's tieStrength fallback; the daily cron re-runs this with fresh budget
// and finishes the remainder. No judge calls — copy is heuristic.
async function rankConnectorsOnly(
  ctx: ActionCtx,
  input: {
    icpId: Id<"icp">;
    owner: Id<"users">;
    icpText: string;
    scoringVector: number[] | null;
    embedsSkipped: number;
  },
): Promise<{
  scored: number;
  judged: number;
  judgeDegraded: number;
  embedsSkipped: number;
}> {
  let embedsSkipped = input.embedsSkipped;
  let scoredCount = 0;
  const top: ScoredConnector[] = [];
  const keepTop = (item: ScoredConnector) => {
    top.push(item);
    if (top.length > CONNECTOR_REC_LIMIT * 2) {
      top.sort((a, b) => b.score - a.score);
      top.length = CONNECTOR_REC_LIMIT;
    }
  };
  const scoreOf = (vec: number[], tie: number | null) =>
    input.scoringVector
      ? feedScore(
          (cosine(vec, input.scoringVector) + 1) / 2,
          reachability("connected", tie ?? undefined),
        )
      : null;

  const missing: {
    id: Id<"persons">;
    name: string;
    headline: string | null;
    company: string | null;
    tie: number | null;
  }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: {
      connectors: {
        id: Id<"persons">;
        name: string;
        headline: string | null;
        company: string | null;
        tieStrength: number | null;
        score: number | null;
        hasVector: boolean;
      }[];
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(internal.rank.connectorPage, {
      userId: input.owner,
      scoringVector: input.scoringVector,
      paginationOpts: { numItems: 50, cursor },
    });
    for (const c of page.connectors) {
      if (c.score !== null) {
        keepTop({
          id: c.id,
          name: c.name,
          headline: c.headline,
          company: c.company,
          score: c.score,
        });
        scoredCount++;
      } else if (!c.hasVector) {
        missing.push({
          id: c.id,
          name: c.name,
          headline: c.headline,
          company: c.company,
          tie: c.tieStrength,
        });
      }
    }
    if (page.isDone) break;
    cursor = page.continueCursor;
  }

  // Embed the missing under CHUNKED reserves with a per-run ceiling
  // (limits.ts): the run stays far inside the action time limit, a mid-run
  // failure forfeits at most one chunk of reserved budget, and one flaky
  // embed degrades that person to the tieStrength fallback instead of
  // aborting the whole run. Whatever scored still gets written below.
  if (missing.length > 0) {
    missing.sort((a, b) => (b.tie ?? 0) - (a.tie ?? 0));
    let remaining = Math.min(missing.length, RANK_EMBEDS_PER_RUN);
    embedsSkipped += missing.length - remaining;
    let idx = 0;
    while (remaining > 0) {
      const want = Math.min(remaining, EMBED_RESERVE_CHUNK);
      const { granted } = await ctx.runMutation(internal.usage.reserve, {
        userId: input.owner,
        category: "embed",
        count: want,
      });
      for (const m of missing.slice(idx, idx + granted)) {
        try {
          const text = [m.name, m.headline, m.company]
            .filter(Boolean)
            .join(" — ");
          const vec = await embed(text);
          await ctx.runMutation(internal.rank.upsertVector, {
            personId: m.id,
            embedding: vec,
          });
          const score = scoreOf(vec, m.tie);
          if (score !== null) {
            keepTop({
              id: m.id,
              name: m.name,
              headline: m.headline,
              company: m.company,
              score,
            });
            scoredCount++;
          }
        } catch (err) {
          // The reserved slot is burnt (under-use, never overspend); the
          // person rides the tieStrength fallback until a later run.
          console.error(`rankConnectorsOnly: embed failed for ${m.id}`, err);
          embedsSkipped++;
        }
      }
      idx += granted;
      remaining -= granted;
      if (granted < want) {
        // Budget dried up (capped): everyone left is skipped this run.
        embedsSkipped += remaining;
        break;
      }
    }
  }

  top.sort((a, b) => b.score - a.score);
  const chosen = top.slice(0, CONNECTOR_REC_LIMIT);

  // Make the agent visible: draft a short reconnect opener for the top few
  // connectors (a judge-category spend, reserved first). A short grant or a
  // failed draft degrades SILENTLY to no opener, exactly like a capped judge
  // on the lead path — the row still ships with its heuristic why/how.
  const openers = new Map<Id<"persons">, string>();
  const wantOpeners = Math.min(CONNECTOR_OPENERS_PER_RUN, chosen.length);
  if (wantOpeners > 0) {
    const { granted } = await ctx.runMutation(internal.usage.reserve, {
      userId: input.owner,
      category: "judge",
      count: wantOpeners,
    });
    for (const c of chosen.slice(0, granted)) {
      try {
        const opener = await draftReconnectOpener({
          icpText: input.icpText,
          connector: {
            name: c.name,
            headline: c.headline ?? undefined,
            company: c.company ?? undefined,
          },
        });
        if (opener) openers.set(c.id, opener);
      } catch (err) {
        console.error(
          `rankConnectorsOnly: opener draft failed for ${c.id}`,
          err,
        );
      }
    }
  }

  const recs = chosen.map((c) => {
    const copy = connectorCopy(c);
    return {
      personId: c.id,
      score: c.score,
      whyBullets: copy.whyBullets,
      how: copy.how,
      opener: openers.get(c.id) ?? "",
    };
  });
  await ctx.runMutation(internal.rank.replaceConnectorRecs, {
    icpId: input.icpId,
    recs,
  });
  return {
    scored: scoredCount,
    judged: openers.size,
    judgeDegraded: 0,
    embedsSkipped,
  };
}

// The ranking pipeline: embed → goal-fit × reachability → judge top N → write
// recs. Every OpenAI call is RESERVED first (usage.reserve, convex/limits.ts);
// a cap hit DEGRADES instead of throwing:
//   • icp embed capped   → rank on reachability alone (neutral goal-fit)
//   • lead embeds capped → cached vectors keep their goal-fit, the uncached
//     score neutral; nothing is embedded past the grant
//   • judge capped       → the recommendation is still written, with its
//     existing copy (score refreshed) or plain heuristic why/how
// so a fully capped rebuild still completes and the cron never errors on caps.
export const rebuild = internalAction({
  args: {
    icpId: v.id("icp"),
    judgeTopN: v.optional(v.number()),
    // Per-RUN ceiling on judge reservations (the cron passes
    // limits.CRON_JUDGE_PER_RUN so one run can't drain a day's budget).
    maxJudge: v.optional(v.number()),
    // Skip judging leads whose existing rec is judged copy at an unchanged
    // score — the cron's "only new or changed" rule.
    skipUnchanged: v.optional(v.boolean()),
  },
  returns: v.object({
    scored: v.number(),
    judged: v.number(),
    judgeDegraded: v.number(), // capped judge slots that fell back to copy
    embedsSkipped: v.number(), // capped embeds that kept cache/neutral fit
  }),
  // Explicit return type: this handler calls same-file functions through
  // `internal.rank.*`, which is circular for TypeScript unless the return
  // type is pinned (see convex guidelines on function calling).
  handler: async (
    ctx,
    args,
  ): Promise<{
    scored: number;
    judged: number;
    judgeDegraded: number;
    embedsSkipped: number;
  }> => {
    const data = await ctx.runQuery(internal.rank.rankData, {
      icpId: args.icpId,
    });
    if (!data) throw new Error("icp not found");
    const owner = data.owner;
    let embedsSkipped = 0;

    // ensure ICP vector — one reserved embed
    let icpVector = data.icpVector;
    if (!icpVector) {
      const { granted } = await ctx.runMutation(internal.usage.reserve, {
        userId: owner,
        category: "embed",
        count: 1,
      });
      if (granted > 0) {
        icpVector = await embed(data.icpText);
        await ctx.runMutation(internal.icp.setVector, {
          icpId: args.icpId,
          vector: icpVector,
        });
      } else {
        embedsSkipped++;
      }
    }

    // Bend the ICP vector by this ICP's thumbs (toward up-votes, away from
    // down-votes) using cached person vectors. This is a per-run scoring vector,
    // not persisted — icp.vector stays the derived baseline. The shift lands on
    // THIS run, which is why votes reshape the feed on the next rank, not on click.
    let scoringVector: number[] | null = icpVector;
    if (icpVector) {
      const { up, down } = await ctx.runQuery(internal.rank.voteVectors, {
        icpId: args.icpId,
      });
      scoringVector =
        up.length || down.length
          ? nudgeVector(icpVector, up, down, VOTE_NUDGE)
          : icpVector;
    }

    // Zero leads (a fresh connectors-only import): rank the connectors by
    // goal fit instead — otherwise the feed would stay empty until a lead
    // ever appears. Same Phase E reserves, no judge spend.
    if (data.leads.length === 0) {
      return await rankConnectorsOnly(ctx, {
        icpId: args.icpId,
        owner,
        icpText: data.icpText,
        scoringVector,
        embedsSkipped,
      });
    }
    // Leads exist: any connector recommendations left over from a zero-lead
    // era would pollute the lead ranking — drop them (no-op when none).
    await ctx.runMutation(internal.rank.replaceConnectorRecs, {
      icpId: args.icpId,
      recs: [],
    });

    // Reserve embeds for the leads missing a vector in ONE batch; leads past
    // the grant keep no vector this run and score with a neutral goal-fit.
    const missingVectors = data.leads.filter((l) => !l.vector).length;
    let embedBudget = 0;
    if (missingVectors > 0) {
      const { granted } = await ctx.runMutation(internal.usage.reserve, {
        userId: owner,
        category: "embed",
        count: missingVectors,
      });
      embedBudget = granted;
      embedsSkipped += missingVectors - granted;
    }

    // score each candidate; embed leads missing a vector while budget lasts
    const scored: {
      id: Id<"persons">;
      name: string;
      headline: string | null;
      company: string | null;
      relationshipToYou: "connected" | "not_connected";
      score: number;
    }[] = [];
    for (const lead of data.leads) {
      let vec = lead.vector;
      if (!vec && embedBudget > 0) {
        embedBudget--;
        const text = [lead.name, lead.headline, lead.company]
          .filter(Boolean)
          .join(" — ");
        vec = await embed(text);
        await ctx.runMutation(internal.rank.upsertVector, {
          personId: lead.id,
          embedding: vec,
        });
      }
      // Neutral goal-fit when either vector is unavailable (capped): the lead
      // still ranks on reachability rather than dropping out of the feed.
      const goalFit =
        vec && scoringVector ? (cosine(vec, scoringVector) + 1) / 2 : 0.5;
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
        relationshipToYou: lead.relationshipToYou,
        score: feedScore(goalFit, reach),
      });
    }
    scored.sort((a, b) => b.score - a.score);

    // judge the top N — but only NEW or CHANGED rows when skipUnchanged, and
    // never more than maxJudge reservations this run
    const topN = args.judgeTopN ?? DEFAULT_JUDGE_TOP_N;
    const top = scored.slice(0, topN);
    const prior = new Map(
      (
        await ctx.runQuery(internal.rank.existingRecs, { icpId: args.icpId })
      ).map((r) => [r.personId, r]),
    );

    const candidates = [];
    for (const lead of top) {
      const ex = prior.get(lead.id);
      if (
        args.skipUnchanged &&
        ex &&
        ex.judged &&
        Math.abs(ex.score - lead.score) <= SCORE_EPSILON
      ) {
        // Judged copy at an unchanged score: leave the row entirely alone.
        continue;
      }
      candidates.push(lead);
    }

    let judgeBudget = 0;
    if (candidates.length > 0) {
      const want = Math.min(candidates.length, args.maxJudge ?? candidates.length);
      if (want > 0) {
        const { granted } = await ctx.runMutation(internal.usage.reserve, {
          userId: owner,
          category: "judge",
          count: want,
        });
        judgeBudget = granted;
      }
    }

    let judged = 0;
    let judgeDegraded = 0;
    for (const lead of candidates) {
      if (judgeBudget > 0) {
        judgeBudget--;
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
          judged: true,
        });
        judged++;
      } else {
        // Cap hit: keep the row in the feed. Existing copy if the rec already
        // exists, plain heuristic copy if it's new. judged:false marks it for
        // a re-judge when budget returns.
        const ex = prior.get(lead.id);
        const fallback = heuristicCopy(lead);
        await ctx.runMutation(internal.rank.writeRecommendation, {
          icpId: args.icpId,
          personId: lead.id,
          score: lead.score,
          whyBullets: ex ? ex.whyBullets : fallback.whyBullets,
          how: ex ? ex.how : fallback.how,
          opener: ex?.opener ?? "",
          unlocksIds: [],
          judged: false,
        });
        judgeDegraded++;
      }
    }
    return { scored: scored.length, judged, judgeDegraded, embedsSkipped };
  },
});
