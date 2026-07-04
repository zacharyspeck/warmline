import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  initials,
  confLabel,
  reachability,
  introScore,
  feedScore,
} from "./lib";
import { dayKey, globalDailyCap, userDailyCap } from "./limits";

// Feed for the list UI. Prefers ranked `recommendations` (real goal-fit + LLM
// why/how); falls back to a reachability heuristic over `persons` so the list
// shows real people even before a rank run. Mutuals come from `edges`.
//
// Swap in app/page.tsx: `const rows = useQuery(api.feed.list, {}) ?? FEED`.

const confidence = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

export const feedRow = v.object({
  id: v.id("persons"),
  kind: v.union(v.literal("lead"), v.literal("connector")),
  gatekeeper: v.boolean(),
  name: v.string(),
  initials: v.string(),
  company: v.string(),
  role: v.string(),
  avatarUrl: v.optional(v.string()),
  linkedinUrl: v.optional(v.string()),
  xHandle: v.optional(v.string()),
  score: v.number(),
  tieStrength: v.number(),
  unlocks: v.optional(v.number()),
  why: v.array(v.object({ text: v.string(), confidence })),
  mutuals: v.array(v.object({ name: v.string(), initials: v.string() })),
  // Total warm-path people (bridging connectors for a lead, unlocked leads for a
  // connector). `mutuals` is capped for the avatar stack; this is the real count.
  mutualsTotal: v.number(),
  how: v.array(v.string()),
  opener: v.optional(v.string()),
});

const GATEKEEPER_MIN = 8;

// Warm-path people for a row: the avatar stack (capped at 3) plus the true total.
//   • lead      → connectors who bridge you to them, ranked by intro_score
//   • connector → the leads they unlock (their fan-out), ranked by edge confidence
// A connector's fan-out is why "No path yet" was wrong for gatekeepers: they ARE
// the warm path, so their row shows who they open up.
async function warmPathFor(
  ctx: QueryCtx,
  p: Doc<"persons">,
): Promise<{ people: { name: string; initials: string }[]; total: number }> {
  const best = new Map<string, { name: string; score: number }>();
  if (p.role === "lead") {
    const edges = await ctx.db
      .query("edges")
      .withIndex("by_to", (q) => q.eq("to", p._id))
      .take(50);
    for (const e of edges) {
      const c = await ctx.db.get(e.from);
      if (!c || c.isSelf) continue;
      const score = introScore(c.tieStrength ?? 0, e.confidence);
      const prev = best.get(e.from);
      if (!prev || score > prev.score)
        best.set(e.from, { name: c.name, score });
    }
  } else {
    const edges = await ctx.db
      .query("edges")
      .withIndex("by_from", (q) => q.eq("from", p._id))
      .take(50);
    for (const e of edges) {
      const lead = await ctx.db.get(e.to);
      if (!lead || lead.isSelf) continue;
      const prev = best.get(e.to);
      if (!prev || e.confidence > prev.score)
        best.set(e.to, { name: lead.name, score: e.confidence });
    }
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  return {
    people: ranked
      .slice(0, 3)
      .map((m) => ({ name: m.name, initials: initials(m.name) })),
    total: ranked.length,
  };
}

function heuristicRow(p: Doc<"persons">) {
  const reach = reachability(p.relationshipToYou, p.tieStrength ?? undefined);
  const score = Math.round(100 * (0.5 + 0.5 * reach));
  const tie = Math.round(100 * (p.tieStrength ?? 0));
  const company = p.company ?? "";
  const role = p.headline ?? "";
  const why: { text: string; confidence: "high" | "medium" | "low" }[] = [];
  if (role || company)
    why.push({
      text: [role, company].filter(Boolean).join(" · "),
      confidence: "high",
    });
  why.push({
    text:
      p.relationshipToYou === "connected"
        ? `In your network${p.tieStrength ? `, tie strength ${tie}` : ""}`
        : "Reachable via a connector",
    confidence: confLabel(reach),
  });
  if (p.role === "connector" && p.unlockValue)
    why.push({ text: `Unlocks ~${p.unlockValue} leads`, confidence: "medium" });
  return { score, tie, company, role, why };
}

type WhyBullet = { text: string; confidence: "high" | "medium" | "low" };
type Pre = {
  p: Doc<"persons">;
  score: number;
  why: WhyBullet[];
  how: string[];
  opener?: string;
};

function heuristicHow(p: Doc<"persons">): string[] {
  if (p.relationshipToYou === "connected")
    return ["Reach out directly via LinkedIn or email"];
  return ["Ask a mutual connection for a warm intro"];
}

async function connectorHow(
  ctx: QueryCtx,
  p: Doc<"persons">,
): Promise<string[]> {
  const first = p.name.split(" ")[0];
  const edges = await ctx.db
    .query("edges")
    .withIndex("by_from", (q) => q.eq("from", p._id))
    .take(5);
  const targets: string[] = [];
  for (const e of edges) {
    const lead = await ctx.db.get(e.to);
    if (lead) targets.push(lead.name.split(" ")[0]);
  }
  if (targets.length > 0) {
    return [
      `Ask ${first} for a warm intro to ${targets.slice(0, 2).join(" or ")}`,
      `Mention your ICP when you reconnect so they can think of others`,
    ];
  }
  const domain = p.company ? `in ${p.company}'s network` : "in their network";
  return [
    `Reconnect with ${first} and share who you're trying to reach`,
    `Ask if they know any founders or PMs ${domain} who fit your ICP`,
  ];
}

// The feed for one explicit owner. Shared by the public query (owner = caller),
// the internal per-user paths (cron avatar enrichment), and the logged-out demo
// (demo.feed, owner = the demo account resolved server-side).
export async function feedForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number,
) {
  const icp = await ctx.db
    .query("icp")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  const pre: Pre[] = [];

  // Zero leads (a connectors-only network, e.g. a fresh LinkedIn import):
  // the unlockValue gate would empty the feed forever, since unlock values
  // only exist where connectors bridge to leads. Sampled with isSelf excluded
  // because the self row is stored as a connector.
  const leadSample = await ctx.db
    .query("persons")
    .withIndex("by_user_and_role", (q) =>
      q.eq("userId", userId).eq("role", "lead"),
    )
    .take(5);
  const hasLeads = leadSample.some((p) => !p.isSelf);

  // Lead rows: prefer ranked recommendations; else a reachability heuristic.
  // Once the user HAS leads, connector-kind recommendations (a zero-lead
  // era's ranking, wiped by the next rank pass) are ignored here — otherwise
  // stale connector recs would keep newly added leads out of the feed until
  // the next cron.
  const allRecs = icp
    ? await ctx.db
        .query("recommendations")
        .withIndex("by_icp_and_score", (q) => q.eq("icpId", icp._id))
        .order("desc")
        .take(limit * 2)
    : [];
  const recs = hasLeads ? allRecs.filter((r) => r.kind === "lead") : allRecs;
  if (recs.length > 0) {
    for (const r of recs) {
      const p = await ctx.db.get(r.personId);
      if (!p || p.isSelf) continue;
      pre.push({
        p,
        score: Math.round(r.score),
        why: r.whyBullets.map((w) => ({
          text: w.text,
          confidence: confLabel(w.confidence),
        })),
        how: r.how.filter(Boolean),
        opener: r.opener,
      });
    }
  } else {
    const leads = await ctx.db
      .query("persons")
      .withIndex("by_user_and_role", (q) =>
        q.eq("userId", userId).eq("role", "lead"),
      )
      .take(400);
    for (const p of leads) {
      if (p.isSelf) continue;
      const h = heuristicRow(p);
      pre.push({ p, score: h.score, why: h.why, how: heuristicHow(p) });
    }
  }

  // Connector rows ALWAYS appear (the "befriend a connector" mode). Top by
  // unlockValue — except with zero leads, where nobody has an unlockValue:
  // then every connector qualifies, ordered by tieStrength.
  const seen = new Set(pre.map((x) => x.p._id));
  const connectorDocs = await ctx.db
    .query("persons")
    .withIndex("by_user_and_role", (q) =>
      q.eq("userId", userId).eq("role", "connector"),
    )
    .take(400);
  const topConnectors = connectorDocs
    .filter(
      (c) =>
        !c.isSelf &&
        !seen.has(c._id) &&
        (hasLeads ? (c.unlockValue ?? 0) > 0 : true),
    )
    .sort((a, b) =>
      hasLeads
        ? (b.unlockValue ?? 0) - (a.unlockValue ?? 0)
        : (b.tieStrength ?? 0) - (a.tieStrength ?? 0),
    )
    .slice(0, Math.max(5, Math.floor(limit / 3)));
  for (const c of topConnectors) {
    const h = heuristicRow(c);
    // With zero leads these rows are the goal-fit ranking's DEGRADED tail
    // (unembedded people): score them with a neutral goal fit, the same
    // convention a capped rank run uses, so ranked rows interleave honestly
    // and the unranked order follows tie strength.
    const score = hasLeads
      ? h.score
      : feedScore(
          0.5,
          reachability(c.relationshipToYou, c.tieStrength ?? undefined),
        );
    pre.push({
      p: c,
      score,
      why: h.why,
      how: await connectorHow(ctx, c),
    });
  }

  // Sort, slice, and compute mutuals ONLY for the returned rows (bounds reads).
  pre.sort((a, b) => b.score - a.score);
  const rows = [];
  for (const x of pre.slice(0, limit)) {
    const p = x.p;
    const warmPath = await warmPathFor(ctx, p);
    rows.push({
      id: p._id,
      kind: p.role,
      gatekeeper: (p.unlockValue ?? 0) >= GATEKEEPER_MIN,
      name: p.name,
      initials: initials(p.name),
      company: p.company ?? "",
      role: p.headline ?? "",
      avatarUrl: p.avatarUrl,
      linkedinUrl: p.linkedinUrl,
      xHandle: p.xHandle,
      score: x.score,
      tieStrength: Math.round(100 * (p.tieStrength ?? 0)),
      unlocks: p.role === "connector" ? p.unlockValue : undefined,
      why: x.why,
      mutuals: warmPath.people,
      mutualsTotal: warmPath.total,
      how: x.how,
      opener: x.opener,
    });
  }
  return rows;
}

export const list = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(feedRow),
  handler: async (ctx, args) => {
    // Per-user feed: signed-out callers get nothing (the logged-out demo reads
    // the demo account through api.demo.feed, never this one).
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await feedForUser(ctx, userId, args.limit ?? 25);
  },
});

export const listForUser = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  returns: v.array(feedRow),
  handler: async (ctx, args) =>
    await feedForUser(ctx, args.userId, args.limit ?? 25),
});

// The feed's lifecycle stage for the signed-in caller — powers the truthful
// staged empty states: has anything been connected, did an import land
// people, has a rank pass produced recommendations yet, and is today's embed
// budget already exhausted (ranking resumes with tomorrow's cron).
export const status = query({
  args: {},
  returns: v.union(
    v.object({
      hasSources: v.boolean(),
      hasPersons: v.boolean(),
      ranked: v.boolean(),
      embedCapped: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const source = await ctx.db
      .query("connectors")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    // take(2): the only self row a user has must not count as a network.
    const personSample = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(2);
    const hasPersons = personSample.some((p) => !p.isSelf);
    const icp = await ctx.db
      .query("icp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    const rec = icp
      ? await ctx.db
          .query("recommendations")
          .withIndex("by_icp_and_score", (q) => q.eq("icpId", icp._id))
          .first()
      : null;
    // Same remaining-budget math as usage.reserve, read-only.
    const day = dayKey(Date.now());
    const user = await ctx.db.get(userId);
    const userRow = await ctx.db
      .query("usage")
      .withIndex("by_user_and_day", (q) =>
        q.eq("userId", userId).eq("day", day),
      )
      .unique();
    const globalRow = await ctx.db
      .query("usageGlobal")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    const remaining = Math.min(
      userDailyCap(user?.tier, "embed") - (userRow?.embed ?? 0),
      globalDailyCap("embed") - (globalRow?.embed ?? 0),
    );
    return {
      hasSources: source !== null,
      hasPersons,
      ranked: rec !== null,
      embedCapped: remaining <= 0,
    };
  },
});
